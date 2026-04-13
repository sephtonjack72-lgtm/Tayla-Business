/* ══════════════════════════════════════════════════════
   Tayla Business — Data Layer
   db.js

   All reads/writes go through this file.
   - Source of truth: Supabase
   - Offline fallback: localStorage
   - On first login: migrates existing localStorage data up to Supabase
══════════════════════════════════════════════════════ */

// ── Current business context (set after login)
let _businessId = null;

function setBusinessId(id) {
  _businessId = id;
}

function getBusinessId() {
  return _businessId;
}

// ══════════════════════════════════════════════════════
//  CACHE HELPERS (localStorage)
// ══════════════════════════════════════════════════════

const CACHE_KEYS = {
  transactions: 'txns',
  journals:     'journals',
  assets:       'assets',
  liabilities:  'liabilities',
  softwareList: 'softwareList',
};

function cacheGet(key) {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEYS[key]) || 'null');
  } catch { return null; }
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_KEYS[key], JSON.stringify(data));
  } catch (e) {
    console.warn('localStorage write failed:', e);
  }
}

// ══════════════════════════════════════════════════════
//  LOAD ALL DATA
//  Called after login. Returns {transactions, journals,
//  assets, liabilities, softwareList}
// ══════════════════════════════════════════════════════

async function dbLoadAll() {
  if (!_businessId) {
    console.warn('dbLoadAll called before businessId set — using cache');
    return loadAllFromCache();
  }

  try {
    const [txRes, jRes, aRes, lRes, swRes, tierRes, muRes] = await Promise.all([
      _supabase.from('transactions').select('*').eq('business_id', _businessId).order('date', { ascending: false }),
      _supabase.from('journals').select('*, journal_lines(*)').eq('business_id', _businessId).order('date', { ascending: false }),
      _supabase.from('assets').select('*').eq('business_id', _businessId),
      _supabase.from('liabilities').select('*').eq('business_id', _businessId),
      _supabase.from('software_products').select('*').eq('business_id', _businessId),
      _supabase.from('software_tiers').select('*'),
      _supabase.from('software_monthly_users').select('*'),
    ]);

    const errors = [txRes, jRes, aRes, lRes, swRes, tierRes, muRes]
      .map(r => r.error).filter(Boolean);
    if (errors.length) throw errors[0];

    // Remap description → desc for app compatibility, parse debits/credits
    const txData = (txRes.data || []).map(({ description, debits, credits, ...rest }) => ({
      ...rest,
      desc: description,
      debits:  typeof debits  === 'string' ? JSON.parse(debits)  : (debits  || []),
      credits: typeof credits === 'string' ? JSON.parse(credits) : (credits || []),
    }));

    const journalsData = (jRes.data || []).map(j => ({
      ...j,
      lines: (j.journal_lines || []).map(l => ({
        ...l,
        // Normalise snake_case columns from Edge Function inserts to camelCase
        accountId:   l.accountId   || l.account_id   || '',
        accountName: l.accountName || l.account_name || '',
      })),
    }));

    const softwareData = (swRes.data || []).map(sw => {
      const tiers = (tierRes.data || []).filter(t => t.software_id === sw.id);
      const allMU = (muRes.data || []).filter(m => m.software_id === sw.id);
      const monthlyUsers = {};
      allMU.forEach(m => {
        if (!monthlyUsers[m.month_key]) monthlyUsers[m.month_key] = {};
        monthlyUsers[m.month_key]['free']  = m.free_count  || 0;
        monthlyUsers[m.month_key]['staff'] = m.staff_count || 0;
        try {
          const tc = typeof m.tier_counts === 'string' ? JSON.parse(m.tier_counts) : (m.tier_counts || {});
          Object.assign(monthlyUsers[m.month_key], tc);
        } catch {}
      });
      return { id: sw.id, name: sw.name, tiers, monthlyUsers };
    });

    cacheSet('transactions', txData);
    cacheSet('journals',     journalsData);
    cacheSet('assets',       aRes.data || []);
    cacheSet('liabilities',  lRes.data || []);
    cacheSet('softwareList', softwareData);

    return {
      transactions: txData,
      journals:     journalsData,
      assets:       aRes.data  || [],
      liabilities:  lRes.data  || [],
      softwareList: softwareData,
    };

  } catch (err) {
    console.error('Supabase load failed, falling back to cache:', err);
    toast('⚠ Offline — showing cached data');
    return loadAllFromCache();
  }
}

function loadAllFromCache() {
  return {
    transactions: cacheGet('transactions') || [],
    journals:     cacheGet('journals')     || [],
    assets:       cacheGet('assets')       || [],
    liabilities:  cacheGet('liabilities')  || [],
    softwareList: cacheGet('softwareList') || [],
  };
}

// ══════════════════════════════════════════════════════
//  TRANSACTIONS
// ══════════════════════════════════════════════════════

async function dbSaveTransaction(tx) {
  const idx = transactions.findIndex(t => t.id === tx.id);
  if (idx >= 0) transactions[idx] = tx; else transactions.unshift(tx);
  cacheSet('transactions', transactions);

  if (!_businessId) return;
  const { desc, ...rest } = tx;
  const row = {
    ...rest,
    description:  desc,
    business_id:  _businessId,
    debits:       tx.debits  ? JSON.stringify(tx.debits)  : null,
    credits:      tx.credits ? JSON.stringify(tx.credits) : null,
  };
  const { error } = await _supabase.from('transactions').upsert(row, { onConflict: 'id' });
  if (error) console.error('Transaction save failed:', error);
}

async function dbDeleteTransaction(id) {
  transactions = transactions.filter(t => t.id !== id);
  cacheSet('transactions', transactions);

  if (!_businessId) return;
  const { error } = await _supabase.from('transactions').delete().eq('id', id).eq('business_id', _businessId);
  if (error) console.error('Transaction delete failed:', error);
}

// ══════════════════════════════════════════════════════
//  JOURNALS
// ══════════════════════════════════════════════════════

async function dbSaveJournal(journal) {
  const idx = journals.findIndex(j => j.id === journal.id);
  if (idx >= 0) journals[idx] = journal; else journals.unshift(journal);
  cacheSet('journals', journals);

  if (!_businessId) return;

  // Upsert journal header
  const { lines, ...header } = journal;
  const { error: jErr } = await _supabase
    .from('journals')
    .upsert({ ...header, business_id: _businessId }, { onConflict: 'id' });
  if (jErr) { console.error('Journal save failed:', jErr); return; }

  // Replace all lines for this journal
  await _supabase.from('journal_lines').delete().eq('journal_id', journal.id);
  if (lines && lines.length) {
    const lineRows = lines.map((l, i) => ({
      ...l,
      id: l.id || uid(),
      journal_id: journal.id,
      sort_order: i,
    }));
    const { error: lErr } = await _supabase.from('journal_lines').insert(lineRows);
    if (lErr) console.error('Journal lines save failed:', lErr);
  }
}

async function dbDeleteJournal(id) {
  journals = journals.filter(j => j.id !== id);
  cacheSet('journals', journals);

  if (!_businessId) return;
  await _supabase.from('journal_lines').delete().eq('journal_id', id);
  const { error } = await _supabase.from('journals').delete().eq('id', id).eq('business_id', _businessId);
  if (error) console.error('Journal delete failed:', error);
}

// ══════════════════════════════════════════════════════
//  ASSETS
// ══════════════════════════════════════════════════════

async function dbSaveAsset(asset) {
  const idx = assets.findIndex(a => a.id === asset.id);
  if (idx >= 0) assets[idx] = asset; else assets.push(asset);
  cacheSet('assets', assets);

  if (!_businessId) return;
  const { error } = await _supabase.from('assets').upsert({ ...asset, business_id: _businessId }, { onConflict: 'id' });
  if (error) console.error('Asset save failed:', error);
}

async function dbDeleteAsset(id) {
  assets = assets.filter(a => a.id !== id);
  cacheSet('assets', assets);

  if (!_businessId) return;
  const { error } = await _supabase.from('assets').delete().eq('id', id).eq('business_id', _businessId);
  if (error) console.error('Asset delete failed:', error);
}

// ══════════════════════════════════════════════════════
//  LIABILITIES
// ══════════════════════════════════════════════════════

async function dbSaveLiability(liability) {
  const idx = liabilities.findIndex(l => l.id === liability.id);
  if (idx >= 0) liabilities[idx] = liability; else liabilities.push(liability);
  cacheSet('liabilities', liabilities);

  if (!_businessId) return;
  const { error } = await _supabase.from('liabilities').upsert({ ...liability, business_id: _businessId }, { onConflict: 'id' });
  if (error) console.error('Liability save failed:', error);
}

async function dbDeleteLiability(id) {
  liabilities = liabilities.filter(l => l.id !== id);
  cacheSet('liabilities', liabilities);

  if (!_businessId) return;
  const { error } = await _supabase.from('liabilities').delete().eq('id', id).eq('business_id', _businessId);
  if (error) console.error('Liability delete failed:', error);
}

// ══════════════════════════════════════════════════════
//  SOFTWARE LIST
//  softwareList is complex — products + tiers + monthly users
//  We save the whole thing on any change
// ══════════════════════════════════════════════════════

async function dbSaveSoftwareList() {
  cacheSet('softwareList', softwareList);
  if (!_businessId) return;

  for (const sw of softwareList) {
    // Upsert product
    const { error: swErr } = await _supabase
      .from('software_products')
      .upsert({ id: sw.id, name: sw.name, business_id: _businessId }, { onConflict: 'id' });
    if (swErr) { console.error('Software product save failed:', swErr); continue; }

    // Upsert tiers
    for (const tier of (sw.tiers || [])) {
      const { error: tErr } = await _supabase
        .from('software_tiers')
        .upsert({ id: tier.id, software_id: sw.id, name: tier.name, price: tier.price }, { onConflict: 'id' });
      if (tErr) console.error('Tier save failed:', tErr);
    }

    // Upsert monthly user counts
    const monthlyRows = [];
    Object.entries(sw.monthlyUsers || {}).forEach(([monthKey, counts]) => {
      monthlyRows.push({
        id: `${sw.id}_${monthKey}`,
        software_id: sw.id,
        month_key: monthKey,
        free_count:  counts.free  || 0,
        staff_count: counts.staff || 0,
        tier_counts: JSON.stringify(
          Object.fromEntries(
            Object.entries(counts).filter(([k]) => k !== 'free' && k !== 'staff')
          )
        ),
      });
    });
    if (monthlyRows.length) {
      const { error: muErr } = await _supabase
        .from('software_monthly_users')
        .upsert(monthlyRows, { onConflict: 'id' });
      if (muErr) console.error('Monthly users save failed:', muErr);
    }
  }
}

// ══════════════════════════════════════════════════════
//  MIGRATION
//  Runs once on first login if Supabase tables are empty
//  but localStorage has data
// ══════════════════════════════════════════════════════

async function dbMigrateFromLocalStorage() {
  if (!_businessId) return;

  const localTxns  = JSON.parse(localStorage.getItem('txns')         || '[]');
  const localJrnls = JSON.parse(localStorage.getItem('journals')     || '[]');
  const localAssets = JSON.parse(localStorage.getItem('assets')      || '[]');
  const localLibs  = JSON.parse(localStorage.getItem('liabilities')  || '[]');
  const localSW    = JSON.parse(localStorage.getItem('softwareList') || '[]');

  const hasLocalData = localTxns.length || localJrnls.length ||
                       localAssets.length || localLibs.length;
  if (!hasLocalData) return;

  // Check if Supabase already has data for this business
  const { count } = await _supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', _businessId);

  if (count > 0) return; // Already migrated

  toast('Migrating your existing data to Supabase…');

  try {
    // Transactions
    if (localTxns.length) {
      const rows = localTxns.map(({ desc, ...rest }) => ({ ...rest, description: desc, business_id: _businessId }));
      await _supabase.from('transactions').insert(rows);
    }

    // Journals + lines
    for (const j of localJrnls) {
      const { lines, ...header } = j;
      await _supabase.from('journals').insert({ ...header, business_id: _businessId });
      if (lines?.length) {
        const lineRows = lines.map((l, i) => ({
          ...l,
          id: l.id || uid(),
          journal_id: j.id,
          sort_order: i,
        }));
        await _supabase.from('journal_lines').insert(lineRows);
      }
    }

    // Assets
    if (localAssets.length) {
      const rows = localAssets.map(a => ({ ...a, business_id: _businessId }));
      await _supabase.from('assets').insert(rows);
    }

    // Liabilities
    if (localLibs.length) {
      const rows = localLibs.map(l => ({ ...l, business_id: _businessId }));
      await _supabase.from('liabilities').insert(rows);
    }

    // Software list
    for (const sw of localSW) {
      await _supabase.from('software_products').insert({ id: sw.id, name: sw.name, business_id: _businessId });
      for (const tier of (sw.tiers || [])) {
        await _supabase.from('software_tiers').insert({ id: tier.id, software_id: sw.id, name: tier.name, price: tier.price });
      }
      const monthlyRows = [];
      Object.entries(sw.monthlyUsers || {}).forEach(([monthKey, counts]) => {
        monthlyRows.push({
          id: `${sw.id}_${monthKey}`,
          software_id: sw.id,
          month_key: monthKey,
          free_count:  counts.free  || 0,
          staff_count: counts.staff || 0,
          tier_counts: JSON.stringify(
            Object.fromEntries(
              Object.entries(counts).filter(([k]) => k !== 'free' && k !== 'staff')
            )
          ),
        });
      });
      if (monthlyRows.length) {
        await _supabase.from('software_monthly_users').upsert(monthlyRows, { onConflict: 'id' });
      }
    }

    toast('✓ Data migrated to Supabase successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    toast('⚠ Migration partially failed — check console');
  }
}

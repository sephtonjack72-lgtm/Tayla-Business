/* ══════════════════════════════════════════════════════
   Tayla Business — Data Layer
   db.js

   All reads/writes go through this file.
   - Source of truth: Supabase
   - Offline fallback: localStorage
   - On first login: migrates existing localStorage data up to Supabase

   Performance patches:
   - Cache-first on login: render from localStorage instantly,
     then refresh from Supabase in background
   - In-memory guard: dbLoadAll only fetches once per session
   - Fixed software_tiers/monthly_users to filter by business_id
   - dbSaveSoftwareList parallelised
   - Selected columns only — no SELECT * on large tables
══════════════════════════════════════════════════════ */

// ── Current business context (set after login)
let _businessId = null;
let _dbLoaded   = false; // guard — only fetch once per session

function setBusinessId(id) {
  _businessId = id;
  _dbLoaded   = false; // reset on business switch
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
//  Cache-first: returns localStorage data immediately,
//  then fetches fresh data from Supabase in the background
//  and calls renderAll() when done.
// ══════════════════════════════════════════════════════

async function dbLoadAll() {
  if (!_businessId) {
    console.warn('dbLoadAll called before businessId set — using cache');
    return loadAllFromCache();
  }

  // Return cache immediately for instant render
  const cached = loadAllFromCache();
  const hasCachedData = cached.transactions.length || cached.journals.length ||
                        cached.assets.length || cached.liabilities.length;

  if (hasCachedData && !_dbLoaded) {
    // Render immediately from cache, refresh in background
    _dbLoaded = true;
    _refreshFromSupabase(); // fire and forget
    return cached;
  }

  // No cache or already loaded — fetch synchronously
  return await _fetchFromSupabase();
}

async function _refreshFromSupabase() {
  try {
    const fresh = await _fetchFromSupabase();
    if (fresh && typeof renderAll === 'function') {
      // Update in-memory arrays then re-render
      transactions = fresh.transactions;
      journals     = fresh.journals;
      assets       = fresh.assets;
      liabilities  = fresh.liabilities;
      softwareList = fresh.softwareList;
      renderAll();
    }
  } catch (err) {
    console.warn('Background refresh failed:', err);
  }
}

async function _fetchFromSupabase() {
  try {
    // Run all queries in parallel
    // Fix: filter software_tiers and monthly_users by business via join
    const [txRes, jRes, aRes, lRes, swRes] = await Promise.all([
      _supabase
        .from('transactions')
        .select('id,date,description,amount,type,account,gst,debits,credits,notes,created_at,source')
        .eq('business_id', _businessId)
        .order('date', { ascending: false })
        .limit(500),

      _supabase
        .from('journals')
        .select('id,date,memo,type,gst_on,source,created_at,journal_lines(id,account_id,account_name,debit,credit,description,sort_order)')
        .eq('business_id', _businessId)
        .order('date', { ascending: false })
        .limit(500),

      _supabase
        .from('assets')
        .select('*')
        .eq('business_id', _businessId),

      _supabase
        .from('liabilities')
        .select('*')
        .eq('business_id', _businessId),

      _supabase
        .from('software_products')
        .select('id,name,software_tiers(id,name,price),software_monthly_users(id,month_key,free_count,staff_count,tier_counts)')
        .eq('business_id', _businessId),
    ]);

    const errors = [txRes, jRes, aRes, lRes, swRes].map(r => r.error).filter(Boolean);
    if (errors.length) throw errors[0];

    // Remap description → desc for app compatibility, parse debits/credits
    const txData = (txRes.data || []).map(({ description, debits, credits, ...rest }) => ({
      ...rest,
      desc: description,
      debits:  typeof debits  === 'string' ? JSON.parse(debits)  : (debits  || []),
      credits: typeof credits === 'string' ? JSON.parse(credits) : (credits || []),
    }));

    // Normalise journals — camelCase journal_lines columns
    const journalsData = (jRes.data || []).map(j => ({
      ...j,
      lines: (j.journal_lines || []).map(l => ({
        ...l,
        accountId:   l.accountId   || l.account_id   || '',
        accountName: l.accountName || l.account_name || '',
      })),
    }));

    // Build software list from nested selects (no extra round trips)
    const softwareData = (swRes.data || []).map(sw => {
      const allMU = sw.software_monthly_users || [];
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
      return {
        id:           sw.id,
        name:         sw.name,
        tiers:        sw.software_tiers || [],
        monthlyUsers,
      };
    });

    // Write to cache
    cacheSet('transactions', txData);
    cacheSet('journals',     journalsData);
    cacheSet('assets',       aRes.data || []);
    cacheSet('liabilities',  lRes.data || []);
    cacheSet('softwareList', softwareData);

    _dbLoaded = true;

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

  const { lines, ...header } = journal;
  const { error: jErr } = await _supabase
    .from('journals')
    .upsert({ ...header, business_id: _businessId }, { onConflict: 'id' });
  if (jErr) { console.error('Journal save failed:', jErr); return; }

  // Replace lines in parallel — delete then insert
  await _supabase.from('journal_lines').delete().eq('journal_id', journal.id);
  if (lines && lines.length) {
    const lineRows = lines.map((l, i) => ({
      ...l,
      id:         l.id || uid(),
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
  // Run delete in parallel
  await Promise.all([
    _supabase.from('journal_lines').delete().eq('journal_id', id),
    _supabase.from('journals').delete().eq('id', id).eq('business_id', _businessId),
  ]);
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
//  Parallelised saves — all upserts run concurrently
// ══════════════════════════════════════════════════════

async function dbSaveSoftwareList() {
  cacheSet('softwareList', softwareList);
  if (!_businessId) return;

  // Run all software product saves in parallel
  await Promise.all(softwareList.map(async sw => {
    const { error: swErr } = await _supabase
      .from('software_products')
      .upsert({ id: sw.id, name: sw.name, business_id: _businessId }, { onConflict: 'id' });
    if (swErr) { console.error('Software product save failed:', swErr); return; }

    // Tiers and monthly users in parallel
    const tierPromises = (sw.tiers || []).map(tier =>
      _supabase.from('software_tiers').upsert(
        { id: tier.id, software_id: sw.id, name: tier.name, price: tier.price },
        { onConflict: 'id' }
      )
    );

    const monthlyRows = [];
    Object.entries(sw.monthlyUsers || {}).forEach(([monthKey, counts]) => {
      monthlyRows.push({
        id:          `${sw.id}_${monthKey}`,
        software_id: sw.id,
        month_key:   monthKey,
        free_count:  counts.free  || 0,
        staff_count: counts.staff || 0,
        tier_counts: JSON.stringify(
          Object.fromEntries(
            Object.entries(counts).filter(([k]) => k !== 'free' && k !== 'staff')
          )
        ),
      });
    });

    const monthlyPromise = monthlyRows.length
      ? _supabase.from('software_monthly_users').upsert(monthlyRows, { onConflict: 'id' })
      : Promise.resolve();

    await Promise.all([...tierPromises, monthlyPromise]);
  }));
}

// ══════════════════════════════════════════════════════
//  MIGRATION
//  Runs once on first login if Supabase tables are empty
//  but localStorage has data
// ══════════════════════════════════════════════════════

async function dbMigrateFromLocalStorage() {
  if (!_businessId) return;

  const localTxns   = JSON.parse(localStorage.getItem('txns')         || '[]');
  const localJrnls  = JSON.parse(localStorage.getItem('journals')     || '[]');
  const localAssets = JSON.parse(localStorage.getItem('assets')       || '[]');
  const localLibs   = JSON.parse(localStorage.getItem('liabilities')  || '[]');
  const localSW     = JSON.parse(localStorage.getItem('softwareList') || '[]');

  const hasLocalData = localTxns.length || localJrnls.length ||
                       localAssets.length || localLibs.length;
  if (!hasLocalData) return;

  const { count } = await _supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', _businessId);

  if (count > 0) return; // Already migrated

  toast('Migrating your existing data to Supabase…');

  try {
    const migrationJobs = [];

    if (localTxns.length) {
      const rows = localTxns.map(({ desc, ...rest }) => ({ ...rest, description: desc, business_id: _businessId }));
      migrationJobs.push(_supabase.from('transactions').insert(rows));
    }

    if (localAssets.length) {
      migrationJobs.push(_supabase.from('assets').insert(localAssets.map(a => ({ ...a, business_id: _businessId }))));
    }

    if (localLibs.length) {
      migrationJobs.push(_supabase.from('liabilities').insert(localLibs.map(l => ({ ...l, business_id: _businessId }))));
    }

    await Promise.all(migrationJobs);

    // Journals must be sequential (header before lines)
    for (const j of localJrnls) {
      const { lines, ...header } = j;
      await _supabase.from('journals').insert({ ...header, business_id: _businessId });
      if (lines?.length) {
        const lineRows = lines.map((l, i) => ({
          ...l,
          id:         l.id || uid(),
          journal_id: j.id,
          sort_order: i,
        }));
        await _supabase.from('journal_lines').insert(lineRows);
      }
    }

    // Software list
    for (const sw of localSW) {
      await _supabase.from('software_products').insert({ id: sw.id, name: sw.name, business_id: _businessId });
      const tierPromises = (sw.tiers || []).map(tier =>
        _supabase.from('software_tiers').insert({ id: tier.id, software_id: sw.id, name: tier.name, price: tier.price })
      );
      const monthlyRows = [];
      Object.entries(sw.monthlyUsers || {}).forEach(([monthKey, counts]) => {
        monthlyRows.push({
          id: `${sw.id}_${monthKey}`,
          software_id: sw.id,
          month_key: monthKey,
          free_count:  counts.free  || 0,
          staff_count: counts.staff || 0,
          tier_counts: JSON.stringify(
            Object.fromEntries(Object.entries(counts).filter(([k]) => k !== 'free' && k !== 'staff'))
          ),
        });
      });
      await Promise.all([
        ...tierPromises,
        monthlyRows.length
          ? _supabase.from('software_monthly_users').upsert(monthlyRows, { onConflict: 'id' })
          : Promise.resolve(),
      ]);
    }

    toast('✓ Data migrated to Supabase successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    toast('⚠ Migration partially failed — check console');
  }
}

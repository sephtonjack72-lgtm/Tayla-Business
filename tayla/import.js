/* ══════════════════════════════════════════════════════
   Tayla Business — CSV Import
   import.js
══════════════════════════════════════════════════════ */

// ── State
const _importData = {
  contacts:     { rows: [], headers: [], mapped: {} },
  accounts:     { rows: [], headers: [], mapped: {} },
  balances:     { rows: [], headers: [], mapped: {} },
  transactions: { rows: [], headers: [], mapped: {} },
};

// ── Expected fields per import type
const IMPORT_FIELDS = {
  contacts: [
    { key: 'name',    label: 'Name / Business Name', required: true },
    { key: 'type',    label: 'Type (customer/supplier)', required: false },
    { key: 'abn',     label: 'ABN', required: false },
    { key: 'email',   label: 'Email', required: false },
    { key: 'phone',   label: 'Phone', required: false },
    { key: 'address', label: 'Address', required: false },
  ],
  accounts: [
    { key: 'code',    label: 'Account Code', required: true },
    { key: 'name',    label: 'Account Name', required: true },
    { key: 'type',    label: 'Type (asset/liability/revenue/expense/equity)', required: true },
    { key: 'gst',     label: 'GST Applicable (yes/no)', required: false },
  ],
  balances: [
    { key: 'account', label: 'Account Code or Name', required: true },
    { key: 'debit',   label: 'Debit (DR) Amount', required: false },
    { key: 'credit',  label: 'Credit (CR) Amount', required: false },
  ],
  transactions: [
    { key: 'date',        label: 'Date', required: true },
    { key: 'description', label: 'Description / Narration', required: true },
    { key: 'amount',      label: 'Amount', required: true },
    { key: 'debit_account',  label: 'Debit Account', required: false },
    { key: 'credit_account', label: 'Credit Account', required: false },
    { key: 'reference',   label: 'Reference', required: false },
    { key: 'gst',         label: 'GST Amount', required: false },
  ],
};

// ── Auto-detect common column name variations
const FIELD_ALIASES = {
  contacts: {
    name:    ['name', 'contact name', 'business name', 'company', 'display name', 'full name', 'supplier name', 'customer name'],
    type:    ['type', 'contact type', 'category', 'role'],
    abn:     ['abn', 'tax number', 'business number', 'gst number'],
    email:   ['email', 'email address', 'e-mail'],
    phone:   ['phone', 'phone number', 'mobile', 'telephone', 'fax'],
    address: ['address', 'street address', 'billing address', 'postal address'],
  },
  accounts: {
    code:    ['code', 'account code', 'account number', 'number', 'no.', 'id'],
    name:    ['name', 'account name', 'description', 'account'],
    type:    ['type', 'account type', 'class', 'category'],
    gst:     ['gst', 'tax', 'gst applicable', 'taxable'],
  },
  balances: {
    account: ['account', 'account code', 'account name', 'code', 'name'],
    debit:   ['debit', 'dr', 'debit amount', 'opening debit'],
    credit:  ['credit', 'cr', 'credit amount', 'opening credit'],
  },
  transactions: {
    date:           ['date', 'transaction date', 'entry date', 'posted date'],
    description:    ['description', 'narration', 'details', 'memo', 'particulars', 'notes'],
    amount:         ['amount', 'total', 'value', 'net amount', 'gross amount'],
    debit_account:  ['debit account', 'dr account', 'account dr', 'debit'],
    credit_account: ['credit account', 'cr account', 'account cr', 'credit'],
    reference:      ['reference', 'ref', 'invoice number', 'transaction id', 'cheque number'],
    gst:            ['gst', 'tax amount', 'gst amount'],
  },
};

// ══════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════

function showImportTab(tab) {
  ['contacts','accounts','balances','transactions'].forEach(t => {
    const el  = document.getElementById(`import-${t}`);
    const btn = document.getElementById(`itab-${t}`);
    if (el)  el.style.display  = t === tab ? 'block' : 'none';
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--text2)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
    }
  });
}

// ══════════════════════════════════════════════════════
//  CSV PARSING
// ══════════════════════════════════════════════════════

function parseImportCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return { headers: [], rows: [] };

  function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim()); current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim());
  const rows    = lines.slice(1).filter(l => l.trim()).map(l => {
    const vals = parseLine(l);
    const row  = {};
    headers.forEach((h, i) => row[h] = vals[i] || '');
    return row;
  });

  return { headers, rows };
}

function autoDetectMapping(type, headers) {
  const aliases = FIELD_ALIASES[type] || {};
  const mapped  = {};
  IMPORT_FIELDS[type].forEach(field => {
    const fieldAliases = aliases[field.key] || [field.key];
    const match = headers.find(h => fieldAliases.some(alias => h === alias || h.includes(alias)));
    if (match) mapped[field.key] = match;
  });
  return mapped;
}

// ══════════════════════════════════════════════════════
//  FILE UPLOAD HANDLER
// ══════════════════════════════════════════════════════

function handleImportCSV(type, input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const { headers, rows } = parseImportCSV(e.target.result);
    if (!headers.length || !rows.length) {
      showImportStatus('Could not read CSV file — check the format and try again.', 'error');
      return;
    }
    _importData[type].headers = headers;
    _importData[type].rows    = rows;
    _importData[type].mapped  = autoDetectMapping(type, headers);
    renderMappingScreen(type);
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════════
//  MAPPING SCREEN
// ══════════════════════════════════════════════════════

function renderMappingScreen(type) {
  const { headers, rows, mapped } = _importData[type];
  const fields  = IMPORT_FIELDS[type];
  const uploadEl  = document.getElementById(`import-${type}-upload`);
  const mappingEl = document.getElementById(`import-${type}-mapping`);
  if (uploadEl)  uploadEl.style.display  = 'none';
  if (!mappingEl) return;
  mappingEl.style.display = 'block';

  const previewRows = rows.slice(0, 3);

  mappingEl.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:12px;">
      ✓ ${rows.length} rows detected — map your columns below
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
      ${fields.map(f => `
        <div class="form-group" style="margin:0;">
          <label>${f.label}${f.required ? ' <span style="color:var(--danger);">*</span>' : ''}</label>
          <select id="map-${type}-${f.key}" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);width:100%;">
            <option value="">— skip this field —</option>
            ${headers.map(h => `<option value="${h}" ${mapped[f.key] === h ? 'selected' : ''}>${h}</option>`).join('')}
          </select>
        </div>
      `).join('')}
    </div>

    <!-- Preview -->
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:8px;">Preview (first 3 rows)</div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr>${headers.map(h => `<th style="padding:8px 12px;background:var(--surface2);text-align:left;font-weight:600;border-bottom:1px solid var(--border);">${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${previewRows.map(row => `
              <tr>${headers.map(h => `<td style="padding:8px 12px;border-bottom:1px solid var(--border);color:var(--text2);">${row[h] || ''}</td>`).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div style="display:flex;gap:10px;">
      <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="resetImport('${type}')">← Re-upload</button>
      <button class="btn btn-primary btn-sm" style="flex:1;" onclick="confirmImport('${type}')">Import ${rows.length} rows →</button>
    </div>
  `;
}

function resetImport(type) {
  const uploadEl  = document.getElementById(`import-${type}-upload`);
  const mappingEl = document.getElementById(`import-${type}-mapping`);
  if (uploadEl)  { uploadEl.style.display = 'block'; uploadEl.querySelector('input[type=file]').value = ''; }
  if (mappingEl) mappingEl.style.display = 'none';
  _importData[type] = { rows: [], headers: [], mapped: {} };
}

// ══════════════════════════════════════════════════════
//  CONFIRM & PROCESS IMPORT
// ══════════════════════════════════════════════════════

function getMapping(type) {
  const mapping = {};
  IMPORT_FIELDS[type].forEach(f => {
    const sel = document.getElementById(`map-${type}-${f.key}`);
    if (sel?.value) mapping[f.key] = sel.value;
  });
  return mapping;
}

async function confirmImport(type) {
  const mapping = getMapping(type);
  const rows    = _importData[type].rows;

  // Check required fields
  const requiredMissing = IMPORT_FIELDS[type].filter(f => f.required && !mapping[f.key]).map(f => f.label);
  if (requiredMissing.length) {
    showImportStatus(`Please map required fields: ${requiredMissing.join(', ')}`, 'error');
    return;
  }

  showImportStatus(`Importing ${rows.length} rows…`, 'loading');

  try {
    let imported = 0, skipped = 0;

    if (type === 'contacts') {
      const toInsert = [];
      rows.forEach(row => {
        const name = row[mapping.name]?.trim();
        if (!name) { skipped++; return; }
        const type_val = (row[mapping.type] || 'customer').toLowerCase();
        toInsert.push({
          id:          uid(),
          business_id: _businessId,
          name,
          type:    type_val.includes('sup') ? 'supplier' : type_val.includes('both') ? 'both' : 'customer',
          abn:     row[mapping.abn]     || '',
          email:   row[mapping.email]   || '',
          phone:   row[mapping.phone]   || '',
          address: row[mapping.address] || '',
          created_at: new Date().toISOString(),
        });
        imported++;
      });
      if (toInsert.length) {
        // Save to local state and Supabase in batches of 50
        for (let i = 0; i < toInsert.length; i += 50) {
          const batch = toInsert.slice(i, i + 50);
          contacts.push(...batch);
          if (_businessId) await _supabase.from('contacts').insert(batch);
        }
        localStorage.setItem('contacts', JSON.stringify(contacts));
      }

    } else if (type === 'accounts') {
      rows.forEach(row => {
        const code = row[mapping.code]?.trim();
        const name = row[mapping.name]?.trim();
        if (!code || !name) { skipped++; return; }
        const typeRaw = (row[mapping.type] || '').toLowerCase();
        const acType  = typeRaw.includes('asset') ? 'asset'
          : typeRaw.includes('liab') ? 'liability'
          : typeRaw.includes('rev') || typeRaw.includes('income') ? 'revenue'
          : typeRaw.includes('exp') ? 'expense'
          : typeRaw.includes('eq') ? 'equity' : 'expense';
        const gstApplicable = (row[mapping.gst] || '').toLowerCase().includes('y');
        // Add to ALL_ACCOUNTS if not already present
        if (!ALL_ACCOUNTS.find(a => a.id === code)) {
          ALL_ACCOUNTS.push({ id: code, name, type: acType, gst: gstApplicable });
          imported++;
        } else skipped++;
      });

    } else if (type === 'balances') {
      const lines = [];
      rows.forEach(row => {
        const accountRaw = row[mapping.account]?.trim();
        if (!accountRaw) { skipped++; return; }
        const debit  = parseFloat(row[mapping.debit]  || '0') || 0;
        const credit = parseFloat(row[mapping.credit] || '0') || 0;
        if (!debit && !credit) { skipped++; return; }
        // Try to find account by code or name
        const acc = ALL_ACCOUNTS.find(a => a.id === accountRaw || a.name.toLowerCase() === accountRaw.toLowerCase());
        const accountId = acc?.id || accountRaw;
        lines.push({ accountId, accountName: acc?.name || accountRaw, debit, credit });
        imported++;
      });
      if (lines.length) {
        const fyStart = `${parseInt(appSettings.defaultFY || '2026') - 1}-07-01`;
        const journal = {
          id: uid(),
          date: fyStart,
          ref: 'OB-' + new Date().getFullYear(),
          narration: 'Opening Balances — imported from previous system',
          lines,
          total: lines.reduce((s, l) => s + l.debit, 0),
          gst: 'no',
          createdAt: new Date().toISOString(),
        };
        journals.unshift(journal);
        await dbSaveJournal(journal);
      }

    } else if (type === 'transactions') {
      for (const row of rows) {
        const date = normaliseDate(row[mapping.date]);
        const desc = row[mapping.description]?.trim();
        const amount = parseFloat(row[mapping.amount]?.replace(/[^0-9.-]/g, '') || '0') || 0;
        if (!date || !desc || !amount) { skipped++; continue; }

        const ref = row[mapping.reference]?.trim() || 'IMP-' + uid().slice(0,6).toUpperCase();
        const gst = parseFloat(row[mapping.gst] || '0') || 0;
        const debitAcc  = findAccount(row[mapping.debit_account]) || '5010';
        const creditAcc = findAccount(row[mapping.credit_account]) || '1010';

        const tx = {
          id: uid(), date, ref, desc,
          type: 'journal',
          debits:  [{ account: debitAcc,  amount: +(amount - gst).toFixed(2) }],
          credits: [{ account: creditAcc, amount }],
          amount, gst: gst > 0 ? 'yes' : 'no',
          method: 'Import', reconciled: false,
        };
        if (gst > 0) tx.debits.push({ account: '1030', amount: gst });

        transactions.unshift(tx);
        await dbSaveTransaction(tx);
        imported++;
      }
    }

    localStorage.setItem('contacts',     JSON.stringify(contacts));
    localStorage.setItem('transactions', JSON.stringify(transactions));
    localStorage.setItem('journals',     JSON.stringify(journals));

    const msg = `✓ Imported ${imported} ${type}${skipped ? ` · ${skipped} rows skipped` : ''}`;
    showImportStatus(msg, 'success');

    // Update badge on tab
    const btn = document.getElementById(`itab-${type}`);
    if (btn) btn.textContent = btn.textContent.split(' ')[0] + ` ✓ ${imported}`;

  } catch (err) {
    console.error('Import failed:', err);
    showImportStatus('Import failed: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════

function showImportStatus(msg, type) {
  const el = document.getElementById('import-status');
  if (!el) return;
  el.style.display = 'block';
  el.style.background = type === 'error' ? '#fde2e2' : type === 'success' ? '#d4edda' : 'var(--surface2)';
  el.style.color = type === 'error' ? 'var(--danger)' : type === 'success' ? '#155724' : 'var(--text2)';
  el.textContent = msg;
}

function normaliseDate(raw) {
  if (!raw) return null;
  // Handle DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, D MMM YYYY
  const s = raw.trim();
  // YYYY-MM-DD already fine
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // Try native parse
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return null;
}

function findAccount(raw) {
  if (!raw) return null;
  const clean = raw.trim();
  // Exact code match
  const byCode = ALL_ACCOUNTS.find(a => a.id === clean);
  if (byCode) return byCode.id;
  // Name match
  const byName = ALL_ACCOUNTS.find(a => a.name.toLowerCase() === clean.toLowerCase());
  if (byName) return byName.id;
  // Partial match
  const partial = ALL_ACCOUNTS.find(a => a.name.toLowerCase().includes(clean.toLowerCase()));
  if (partial) return partial.id;
  return null;
}

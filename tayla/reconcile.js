/* ══════════════════════════════════════════════════════
   Tayla Business — Bank Reconciliation
   reconcile.js
══════════════════════════════════════════════════════ */

// ── State
let bankAccounts    = JSON.parse(localStorage.getItem('bankAccounts')    || '[]');
let statementLines  = JSON.parse(localStorage.getItem('statementLines')  || '[]');
let parsedCsvRows   = []; // staging area before confirm import
let activeImportAccountId = null;

// ══════════════════════════════════════════════════════
//  SUPABASE — BANK ACCOUNTS
// ══════════════════════════════════════════════════════

async function dbLoadBankAccounts() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('bank_accounts').select('*').eq('business_id', _businessId);
  if (error) { console.error('Load bank accounts failed:', error); return; }
  bankAccounts = data || [];
  localStorage.setItem('bankAccounts', JSON.stringify(bankAccounts));
}

async function dbSaveBankAccount(account) {
  const idx = bankAccounts.findIndex(a => a.id === account.id);
  if (idx >= 0) bankAccounts[idx] = account; else bankAccounts.push(account);
  localStorage.setItem('bankAccounts', JSON.stringify(bankAccounts));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('bank_accounts').upsert({ ...account, business_id: _businessId }, { onConflict: 'id' });
  if (error) console.error('Save bank account failed:', error);
}

async function dbDeleteBankAccount(id) {
  bankAccounts = bankAccounts.filter(a => a.id !== id);
  localStorage.setItem('bankAccounts', JSON.stringify(bankAccounts));
  if (!_businessId) return;
  await _supabase.from('bank_accounts').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  SUPABASE — STATEMENT LINES
// ══════════════════════════════════════════════════════

async function dbLoadStatementLines(accountId) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('bank_statement_lines').select('*')
    .eq('bank_account_id', accountId)
    .order('date', { ascending: false });
  if (error) { console.error('Load statement lines failed:', error); return; }
  // Merge into local state
  const others = statementLines.filter(l => l.bank_account_id !== accountId);
  statementLines = [...others, ...(data || [])];
  localStorage.setItem('statementLines', JSON.stringify(statementLines));
}

async function dbSaveStatementLines(lines) {
  // Update local state
  lines.forEach(l => {
    const idx = statementLines.findIndex(s => s.id === l.id);
    if (idx >= 0) statementLines[idx] = l; else statementLines.push(l);
  });
  localStorage.setItem('statementLines', JSON.stringify(statementLines));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('bank_statement_lines').upsert(lines, { onConflict: 'id' });
  if (error) {
    console.error('Save statement lines failed:', error);
    toast('⚠ Imported locally but failed to sync: ' + error.message);
  }
}

async function dbUpdateStatementLine(id, updates) {
  const idx = statementLines.findIndex(l => l.id === id);
  if (idx >= 0) statementLines[idx] = { ...statementLines[idx], ...updates };
  localStorage.setItem('statementLines', JSON.stringify(statementLines));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('bank_statement_lines').update(updates).eq('id', id);
  if (error) console.error('Update statement line failed:', error);
}

// ══════════════════════════════════════════════════════
//  RECONCILE TAB NAVIGATION
// ══════════════════════════════════════════════════════

function showReconTab(tab) {
  ['accounts', 'import', 'match'].forEach(t => {
    document.getElementById(`recon-${t}`).style.display      = t === tab ? 'block' : 'none';
    document.getElementById(`rtab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`rtab-${t}`).style.color         = t === tab ? 'var(--accent)' : 'var(--text2)';
    document.getElementById(`rtab-${t}`).style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
  });
  if (tab === 'accounts') renderBankAccountsList();
  if (tab === 'import')   renderImportAccountSelect();
  if (tab === 'match')    { renderMatchAccountSelect(); renderMatchView(); }
}

// ══════════════════════════════════════════════════════
//  BANK ACCOUNTS UI
// ══════════════════════════════════════════════════════

function renderBankAccountsList() {
  const el = document.getElementById('bank-accounts-list');
  if (!el) return;
  if (!bankAccounts.length) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">No bank accounts yet — add one to get started.</div>`;
    return;
  }
  el.innerHTML = bankAccounts.map(a => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:600;font-size:14px;">${a.name}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">${a.bank || ''} ${a.bsb ? '· BSB ' + a.bsb : ''} ${a.account_number ? '· ' + a.account_number : ''}</div>
        <div style="font-size:12px;color:var(--text3);">Linked: ${getAccount(a.ledger_account)?.name || a.ledger_account} · Opening: ${fmt(a.opening_balance || 0)}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <div style="font-size:12px;color:var(--text3);">${a.last_reconciled ? 'Last reconciled ' + fmtDate(a.last_reconciled) : 'Never reconciled'}</div>
        <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="deleteBankAccountConfirm('${a.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}

async function saveBankAccount() {
  const name    = document.getElementById('ba-name').value.trim();
  const bank    = document.getElementById('ba-bank').value;
  const bsb     = document.getElementById('ba-bsb').value.trim();
  const num     = document.getElementById('ba-number').value.trim();
  const ledger  = document.getElementById('ba-ledger').value;
  const opening = parseFloat(document.getElementById('ba-opening').value) || 0;
  if (!name) { toast('Please enter an account name'); return; }
  const account = { id: uid(), name, bank, bsb, account_number: num, ledger_account: ledger, opening_balance: opening, last_reconciled: null };
  await dbSaveBankAccount(account);
  renderBankAccountsList();
  renderImportAccountSelect();
  renderMatchAccountSelect();
  document.getElementById('ba-name').value = '';
  document.getElementById('ba-bsb').value  = '';
  document.getElementById('ba-number').value = '';
  document.getElementById('ba-opening').value = '';
  toast(`"${name}" added ✓`);
}

async function deleteBankAccountConfirm(id) {
  if (!confirm('Remove this bank account and all its imported statement lines?')) return;
  statementLines = statementLines.filter(l => l.bank_account_id !== id);
  localStorage.setItem('statementLines', JSON.stringify(statementLines));
  if (_businessId) await _supabase.from('bank_statement_lines').delete().eq('bank_account_id', id);
  await dbDeleteBankAccount(id);
  renderBankAccountsList();
  renderImportAccountSelect();
  renderMatchAccountSelect();
  toast('Bank account removed');
}

// ══════════════════════════════════════════════════════
//  CSV PARSING
// ══════════════════════════════════════════════════════

const CSV_FORMATS = {
  commbank: { dateFormat: 'dd/mm/yyyy', note: 'Date,Amount,Description,Balance' },
  anz:      { dateFormat: 'dd/mm/yyyy', note: 'Date,Description,Amount,Balance' },
  nab:      { dateFormat: 'dd-mmm-yy',  note: 'Date,Amount,Description,Balance' },
  westpac:  { dateFormat: 'dd/mm/yyyy', note: 'Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance' },
  generic:  { dateFormat: 'auto',       note: 'Date,Description,Amount' },
};

const HEADER_ALIASES = {
  date:    ['date', 'transaction date', 'posted date', 'entry date', 'value date', 'settlement date'],
  desc:    ['description', 'narrative', 'details', 'memo', 'particulars', 'transaction details', 'narration', 'reference'],
  amount:  ['amount', 'transaction amount', 'net amount', 'value', 'net'],
  debit:   ['debit', 'debit amount', 'withdrawals', 'withdrawal amount', 'dr amount', 'dr'],
  credit:  ['credit', 'credit amount', 'deposits', 'deposit amount', 'cr amount', 'cr'],
  balance: ['balance', 'running balance', 'closing balance', 'available balance'],
};

function findColByAliases(header, aliases) {
  for (const alias of aliases) {
    const idx = header.findIndex(h => h === alias || h.startsWith(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

function detectColsFromHeader(header) {
  return {
    dateCol:    findColByAliases(header, HEADER_ALIASES.date),
    descCol:    findColByAliases(header, HEADER_ALIASES.desc),
    amountCol:  findColByAliases(header, HEADER_ALIASES.amount),
    debitCol:   findColByAliases(header, HEADER_ALIASES.debit),
    creditCol:  findColByAliases(header, HEADER_ALIASES.credit),
    balanceCol: findColByAliases(header, HEADER_ALIASES.balance),
  };
}

function parseDate(str, format) {
  if (!str) return null;
  str = str.trim().replace(/"/g, '');
  // Try various formats
  const parts = str.split(/[\/\-\s]/);
  if (format === 'dd/mm/yyyy' || format === 'auto') {
    if (parts.length === 3) {
      const [d, m, y] = parts;
      const year = y.length === 2 ? '20' + y : y;
      const date = new Date(`${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
      if (!isNaN(date)) return date.toISOString().split('T')[0];
    }
  }
  if (format === 'dd-mmm-yy') {
    const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    if (parts.length === 3) {
      const d = parts[0].padStart(2,'0');
      const m = months[parts[1].toLowerCase().slice(0,3)] || '01';
      const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
      return `${y}-${m}-${d}`;
    }
  }
  // Fallback: try native Date parse
  const d = new Date(str);
  return isNaN(d) ? null : d.toISOString().split('T')[0];
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines.map(line => {
    // Handle quoted fields
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; }
      else if (line[i] === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += line[i]; }
    }
    cols.push(cur.trim());
    return cols;
  });
}

function detectFormat(rows) {
  if (!rows.length) return 'generic';
  const header = rows[0].map(h => h.toLowerCase().replace(/"/g, '').trim());
  if (header.some(h => h.includes('narrative')) || header.some(h => h === 'debit amount')) return 'westpac';
  if (header.some(h => h.includes('bsb'))) return 'commbank';
  if (header.some(h => h.includes('transaction date'))) return 'nab';
  if (header.some(h => h === 'date') && header.some(h => h === 'amount')) return 'anz';
  return 'generic';
}

function handleCsvDrop(e) {
  const file = e.dataTransfer.files[0];
  if (file) processCSVFile(file);
}

function handleCsvFile(input) {
  const file = input.files[0];
  if (file) processCSVFile(file);
}

function processCSVFile(file) {
  if (!file.name.endsWith('.csv')) {
    showImportError('Please upload a CSV file exported from your bank.');
    return;
  }
  const accountId = document.getElementById('import-account-select').value;
  if (!accountId) { showImportError('Please select a bank account first.'); return; }
  activeImportAccountId = accountId;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result;
      const rows = parseCSV(text);
      if (rows.length < 2) { showImportError('File appears empty or invalid.'); return; }

      let formatKey = document.getElementById('import-format').value;
      if (formatKey === 'auto') formatKey = detectFormat(rows);
      const fmt2 = CSV_FORMATS[formatKey] || CSV_FORMATS.generic;

      // Smart column detection from header row
      const header = rows[0].map(h => h.toLowerCase().replace(/"/g, '').trim());
      const cols_idx = detectColsFromHeader(header);

      const dataRows = rows.slice(1); // always skip header row
      parsedCsvRows = [];

      dataRows.forEach((cols, i) => {
        if (cols.length < 2) return;
        const clean = s => (s || '').replace(/"/g, '').trim();

        const dateStr = clean(cols[cols_idx.dateCol]);
        const descStr = clean(cols[cols_idx.descCol]);
        const balStr  = cols_idx.balanceCol >= 0 ? clean(cols[cols_idx.balanceCol]).replace(/[^0-9.\-]/g, '') : null;

        // Handle both single amount column and split debit/credit columns
        let amount;
        if (cols_idx.debitCol >= 0 || cols_idx.creditCol >= 0) {
          const debitStr  = cols_idx.debitCol  >= 0 ? clean(cols[cols_idx.debitCol]).replace(/[^0-9.]/g, '')  : '';
          const creditStr = cols_idx.creditCol >= 0 ? clean(cols[cols_idx.creditCol]).replace(/[^0-9.]/g, '') : '';
          const debit     = parseFloat(debitStr)  || 0;
          const credit    = parseFloat(creditStr) || 0;
          // Debits = money out (negative), Credits = money in (positive)
          amount = credit > 0 ? credit : -debit;
        } else {
          const amountStr = clean(cols[cols_idx.amountCol]).replace(/[^0-9.\-]/g, '');
          amount = parseFloat(amountStr);
        }

        const date = parseDate(dateStr, fmt2.dateFormat);
        if (!date || isNaN(amount) || amount === 0) return;

        parsedCsvRows.push({
          id:              uid(),
          bank_account_id: accountId,
          date,
          description:     descStr || '',
          amount,
          balance:         balStr ? parseFloat(balStr) : null,
          status:          'unmatched',
          transaction_id:  null,
          imported_at:     new Date().toISOString(),
        });
      });

      if (!parsedCsvRows.length) { showImportError('No valid rows found. Try selecting your bank format manually.'); return; }
      showImportPreview(parsedCsvRows);
    } catch (err) {
      showImportError('Could not parse file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function showImportError(msg) {
  const el = document.getElementById('import-error');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('import-preview-wrap').style.display = 'none';
}

function showImportPreview(rows) {
  document.getElementById('import-error').style.display = 'none';
  document.getElementById('import-preview-label').textContent = `${rows.length} transactions found — review before importing`;

  const head = document.getElementById('import-preview-head');
  head.innerHTML = '<th>Date</th><th>Description</th><th>Amount</th><th>Balance</th>';

  const body = document.getElementById('import-preview-body');
  body.innerHTML = rows.slice(0, 20).map(r => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${r.description}</td>
      <td class="mono" style="color:${r.amount < 0 ? 'var(--danger)' : 'var(--success)'};">${fmt(r.amount)}</td>
      <td class="mono" style="color:var(--text3);">${r.balance != null ? fmt(r.balance) : '—'}</td>
    </tr>
  `).join('') + (rows.length > 20 ? `<tr><td colspan="4" style="text-align:center;color:var(--text3);font-size:12px;">... and ${rows.length - 20} more rows</td></tr>` : '');

  document.getElementById('import-preview-wrap').style.display = 'block';
}

async function confirmImport() {
  if (!parsedCsvRows.length) return;

  const btn = document.querySelector('#import-preview-wrap .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }

  // Deduplicate against already imported lines (same date + amount + description)
  const existing = statementLines.filter(l => l.bank_account_id === activeImportAccountId);
  const newRows = parsedCsvRows.filter(r => !existing.some(e =>
    e.date === r.date && Math.abs(e.amount - r.amount) < 0.01 && e.description === r.description
  ));

  if (!newRows.length) {
    if (btn) { btn.disabled = false; btn.textContent = 'Import These Transactions →'; }
    toast('All rows already imported — no duplicates added');
    return;
  }

  await dbSaveStatementLines(newRows);

  // Reset UI
  document.getElementById('import-preview-wrap').style.display = 'none';
  document.getElementById('csv-file-input').value = '';
  parsedCsvRows = [];
  if (btn) { btn.disabled = false; btn.textContent = 'Import These Transactions →'; }

  toast(`✓ Imported ${newRows.length} bank transactions`);

  // Switch to match tab and pre-select the right account
  const matchSel = document.getElementById('match-account-select');
  if (matchSel && activeImportAccountId) {
    // Ensure options are populated first
    renderMatchAccountSelect();
    matchSel.value = activeImportAccountId;
  }
  showReconTab('match');
}

// ══════════════════════════════════════════════════════
//  MATCH & RECONCILE VIEW
// ══════════════════════════════════════════════════════

function renderImportAccountSelect() {
  const sel = document.getElementById('import-account-select');
  if (!sel) return;
  sel.innerHTML = bankAccounts.length
    ? bankAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')
    : '<option value="">No bank accounts yet</option>';
}

function renderMatchAccountSelect() {
  const sel = document.getElementById('match-account-select');
  if (!sel) return;
  sel.innerHTML = bankAccounts.length
    ? bankAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('')
    : '<option value="">No bank accounts yet</option>';
}

function renderMatchView() {
  const accountId = document.getElementById('match-account-select')?.value;
  const filter    = document.getElementById('match-filter')?.value || 'unmatched';
  const listEl    = document.getElementById('match-list');
  const emptyEl   = document.getElementById('match-empty');
  const summaryEl = document.getElementById('recon-summary');
  if (!listEl || !accountId) return;

  const accountLines = statementLines.filter(l => l.bank_account_id === accountId);
  const filtered = filter === 'all' ? accountLines : accountLines.filter(l => l.status === filter);

  // Summary counts
  const unmatched = accountLines.filter(l => l.status === 'unmatched').length;
  const matched   = accountLines.filter(l => l.status === 'matched' || l.status === 'created').length;
  const ignored   = accountLines.filter(l => l.status === 'ignored').length;
  if (summaryEl) summaryEl.innerHTML = `<span style="color:var(--danger);">${unmatched} unmatched</span> &nbsp;·&nbsp; <span style="color:var(--success);">${matched} matched</span> &nbsp;·&nbsp; ${ignored} ignored`;

  if (!filtered.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = filtered.map(line => renderBankRow(line)).join('');
}

function renderBankRow(line) {
  const statusBadge = {
    unmatched: '<span class="match-badge unmatched">Unmatched</span>',
    matched:   '<span class="match-badge matched">✓ Matched</span>',
    created:   '<span class="match-badge created">✓ Created</span>',
    ignored:   '<span class="match-badge ignored">Ignored</span>',
  }[line.status] || '';

  const amountColor = line.amount < 0 ? 'var(--danger)' : 'var(--success)';
  const suggestions = line.status === 'unmatched' ? getSuggestions(line) : [];

  const suggestionsHtml = suggestions.length ? `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:8px;">Suggested matches</div>
      ${suggestions.map(s => `
        <div class="suggestion-row ${s.exact ? 'exact' : ''}" onclick="matchLine('${line.id}','${s.id}')">
          <span style="color:var(--text3);">${fmtDate(s.date)}</span>
          <span>${s.desc || s.narration || ''}</span>
          <span class="mono" style="color:${s.amount < 0 ? 'var(--danger)' : 'var(--success)'};">${fmt(s.displayAmount)}</span>
          <span class="btn btn-primary btn-sm">Match</span>
        </div>
      `).join('')}
    </div>
  ` : `<div style="font-size:12px;color:var(--text3);margin-bottom:12px;">No matching transactions found.</div>`;

  const matchedTx = line.transaction_id ? transactions.find(t => t.id === line.transaction_id) || journals.find(j => j.id === line.transaction_id) : null;
  const matchedHtml = matchedTx ? `
    <div style="padding:10px 14px;background:#d4edda;border-radius:8px;font-size:13px;margin-bottom:12px;">
      ✓ Matched to: <strong>${matchedTx.desc || matchedTx.narration || matchedTx.ref}</strong> — ${fmt(matchedTx.amount || matchedTx.total)} on ${fmtDate(matchedTx.date)}
      <button class="btn btn-ghost btn-sm" style="margin-left:12px;color:var(--danger);" onclick="unmatchLine('${line.id}')">Unmatch</button>
    </div>
  ` : '';

  return `
    <div class="bank-row" id="bankrow-${line.id}">
      <div class="bank-row-header" onclick="toggleBankRow('${line.id}')">
        <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text3);">${fmtDate(line.date)}</span>
        <span style="font-size:13px;font-weight:500;">${line.description}</span>
        <span class="mono" style="font-size:14px;font-weight:600;color:${amountColor};">${fmt(line.amount)}</span>
        <span>${statusBadge}</span>
      </div>
      <div class="bank-row-detail" id="bankrow-detail-${line.id}">
        <div style="padding-top:14px;">
          ${matchedHtml}
          ${line.status === 'unmatched' ? suggestionsHtml : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${line.status === 'unmatched' ? `
              <button class="btn btn-primary btn-sm" onclick="openCreateFromBank('${line.id}')">+ Create Transaction</button>
              <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="ignoreStatementLine('${line.id}')">Ignore</button>
            ` : ''}
            ${line.status === 'ignored' ? `
              <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="unignoreStatementLine('${line.id}')">Unignore</button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function toggleBankRow(id) {
  const detail = document.getElementById(`bankrow-detail-${id}`);
  if (detail) detail.classList.toggle('open');
}

// ── Fuzzy matching
function getSuggestions(line) {
  const DATE_WINDOW_DAYS = 5;
  const lineDate = new Date(line.date);
  const results = [];

  // Search transactions
  transactions.forEach(t => {
    const tDate = new Date(t.date);
    const daysDiff = Math.abs((lineDate - tDate) / 86400000);
    if (daysDiff > DATE_WINDOW_DAYS) return;

    // For transactions, amount in bank is negative for expenses (money out)
    const tAmount = t.debits ? -t.amount : t.amount;
    const amountMatch = Math.abs(Math.abs(line.amount) - Math.abs(t.amount)) < 0.02;
    const exact = amountMatch && daysDiff === 0;

    if (amountMatch || daysDiff <= 1) {
      results.push({ id: t.id, date: t.date, desc: t.desc, displayAmount: t.amount, amount: t.amount, exact, source: 'tx' });
    }
  });

  // Search journals
  journals.forEach(j => {
    const jDate = new Date(j.date);
    const daysDiff = Math.abs((lineDate - jDate) / 86400000);
    if (daysDiff > DATE_WINDOW_DAYS) return;
    const amountMatch = Math.abs(Math.abs(line.amount) - Math.abs(j.total)) < 0.02;
    const exact = amountMatch && daysDiff === 0;
    if (amountMatch || daysDiff <= 1) {
      results.push({ id: j.id, date: j.date, narration: j.narration, ref: j.ref, displayAmount: j.total, amount: j.total, exact, source: 'journal' });
    }
  });

  // Sort: exact matches first, then by closeness
  return results.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0)).slice(0, 5);
}

// ── Actions
async function matchLine(statementLineId, transactionId) {
  await dbUpdateStatementLine(statementLineId, { status: 'matched', transaction_id: transactionId });

  // Mark the transaction as reconciled
  const tx = transactions.find(t => t.id === transactionId);
  if (tx) { tx.reconciled = true; dbSaveTransaction(tx); }
  const j = journals.find(j => j.id === transactionId);
  if (j) { j.reconciled = true; dbSaveJournal(j); }

  renderMatchView();
  toast('✓ Matched');
}

async function unmatchLine(statementLineId) {
  const line = statementLines.find(l => l.id === statementLineId);
  if (!line) return;
  // Unmark reconciled on the transaction
  const tx = transactions.find(t => t.id === line.transaction_id);
  if (tx) { tx.reconciled = false; dbSaveTransaction(tx); }
  const j = journals.find(j => j.id === line.transaction_id);
  if (j) { j.reconciled = false; dbSaveJournal(j); }
  await dbUpdateStatementLine(statementLineId, { status: 'unmatched', transaction_id: null });
  renderMatchView();
  toast('Unmatched');
}

async function ignoreStatementLine(id) {
  await dbUpdateStatementLine(id, { status: 'ignored' });
  renderMatchView();
  toast('Ignored');
}

async function unignoreStatementLine(id) {
  await dbUpdateStatementLine(id, { status: 'unmatched' });
  renderMatchView();
}

// ── Create transaction from bank line
let activeCreateLineId = null;

function openCreateFromBank(statementLineId) {
  const line = statementLines.find(l => l.id === statementLineId);
  if (!line) return;
  activeCreateLineId = statementLineId;

  // Pre-fill the main transaction form and switch to it
  document.getElementById('tx-date').value = line.date;
  document.getElementById('tx-desc').value = line.description;
  document.getElementById('tx-ref').value  = '';

  // Reset debit/credit lines
  document.getElementById('tx-debit-lines').innerHTML = `
    <div class="tx-line" style="display:grid;grid-template-columns:2fr 1fr 40px;gap:8px;margin-bottom:8px;">
      <select id="tx-debit-account-0" class="tx-account" onchange="validateTx();updateGstPreview()" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);">
        <option value="">Select Account...</option>
      </select>
      <input type="number" id="tx-debit-amount-0" value="${Math.abs(line.amount)}" step="0.01" min="0" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);" oninput="validateTx();updateGstPreview()">
      <button class="btn btn-ghost btn-sm" onclick="addTxLine('debit')" style="padding:4px 8px;">+</button>
    </div>`;

  document.getElementById('tx-credit-lines').innerHTML = `
    <div class="tx-line" style="display:grid;grid-template-columns:2fr 1fr 40px;gap:8px;margin-bottom:8px;">
      <select id="tx-credit-account-0" class="tx-account" onchange="validateTx();updateGstPreview()" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);">
        <option value="">Select Account...</option>
      </select>
      <input type="number" id="tx-credit-amount-0" value="${Math.abs(line.amount)}" step="0.01" min="0" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);" oninput="validateTx();updateGstPreview()">
      <button class="btn btn-ghost btn-sm" onclick="addTxLine('credit')" style="padding:4px 8px;">+</button>
    </div>`;

  initTxLines();

  // Show a banner in the transaction form
  const banner = document.createElement('div');
  banner.id = 'recon-banner';
  banner.style.cssText = 'padding:10px 14px;background:rgba(79,142,247,.12);border:1px solid var(--accent3);border-radius:8px;font-size:12px;color:var(--accent3);margin-bottom:12px;';
  banner.innerHTML = `Creating transaction for bank line: <strong>${line.description}</strong> ${fmt(line.amount)} on ${fmtDate(line.date)} — complete the entry and save.`;
  const txForm = document.querySelector('#dashboard .card-body');
  if (txForm) { const existing = document.getElementById('recon-banner'); if (existing) existing.remove(); txForm.prepend(banner); }

  showPage('dashboard');
  toast('Fill in the accounts and save to create this transaction');
}

// Hook into the normal save to auto-match if we came from reconcile
const _origSaveTransaction = window.dbSaveTransaction;

// After a transaction is created from a bank line, auto-match it
function afterTransactionSave(tx) {
  if (!activeCreateLineId) return;
  matchLine(activeCreateLineId, tx.id).then(() => {
    activeCreateLineId = null;
    const banner = document.getElementById('recon-banner');
    if (banner) banner.remove();
  });
}

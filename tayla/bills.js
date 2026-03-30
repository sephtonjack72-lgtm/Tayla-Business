/* ══════════════════════════════════════════════════════
   Tayla Business — Bills / Accounts Payable
   bills.js
══════════════════════════════════════════════════════ */

let bills = JSON.parse(localStorage.getItem('bills') || '[]');
let billLineCount = 0;

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadBills() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('bills').select('*, bill_lines(*)')
    .eq('business_id', _businessId)
    .order('bill_date', { ascending: false });
  if (error) { console.error('Load bills failed:', error); return; }
  bills = (data || []).map(b => ({ ...b, lines: b.bill_lines || [] }));
  localStorage.setItem('bills', JSON.stringify(bills));
}

async function dbSaveBill(bill) {
  const { lines, ...header } = bill;
  const idx = bills.findIndex(b => b.id === bill.id);
  if (idx >= 0) bills[idx] = bill; else bills.unshift(bill);
  localStorage.setItem('bills', JSON.stringify(bills));
  if (!_businessId) return;
  const { error: hErr } = await _supabase
    .from('bills').upsert({ ...header, business_id: _businessId }, { onConflict: 'id' });
  if (hErr) { console.error('Save bill failed:', hErr); return; }
  await _supabase.from('bill_lines').delete().eq('bill_id', bill.id);
  if (lines?.length) {
    const rows = lines.map((l, i) => ({ ...l, id: l.id || uid(), bill_id: bill.id, sort_order: i }));
    await _supabase.from('bill_lines').insert(rows);
  }
}

async function dbDeleteBill(id) {
  bills = bills.filter(b => b.id !== id);
  localStorage.setItem('bills', JSON.stringify(bills));
  if (!_businessId) return;
  await _supabase.from('bill_lines').delete().eq('bill_id', id);
  await _supabase.from('bills').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════

function showBillTab(tab) {
  ['list','editor'].forEach(t => {
    const el = document.getElementById(`bill-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`btab-${t}`);
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--text2)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
    }
  });
  if (tab === 'list')   { renderBillList(); renderBillKpis(); }
  if (tab === 'editor') { renderBillContactSelect(); renderBillSummary(); }
}

// ══════════════════════════════════════════════════════
//  BILL LIST
// ══════════════════════════════════════════════════════

function getBillStatus(bill) {
  if (bill.status === 'paid') return 'paid';
  if (bill.status === 'draft') return 'draft';
  if (bill.due_date && new Date(bill.due_date) < new Date() && bill.status !== 'paid') return 'overdue';
  return bill.status;
}

function renderBillKpis() {
  const el = document.getElementById('bill-kpis');
  if (!el) return;
  const all = bills.map(b => ({ ...b, effectiveStatus: getBillStatus(b) }));
  const totalOwing   = all.filter(b => ['received','approved','overdue'].includes(b.effectiveStatus)).reduce((s,b) => s+b.total, 0);
  const totalOverdue = all.filter(b => b.effectiveStatus === 'overdue').reduce((s,b) => s+b.total, 0);
  const totalPaid    = all.filter(b => b.effectiveStatus === 'paid').reduce((s,b) => s+b.total, 0);
  const countDraft   = all.filter(b => b.effectiveStatus === 'draft').length;
  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Total Owing</div><div class="kpi-value negative">${fmt(totalOwing)}</div></div>
    <div class="kpi"><div class="kpi-label">Overdue</div><div class="kpi-value negative">${fmt(totalOverdue)}</div></div>
    <div class="kpi"><div class="kpi-label">Paid This Year</div><div class="kpi-value positive">${fmt(totalPaid)}</div></div>
    <div class="kpi"><div class="kpi-label">Drafts</div><div class="kpi-value">${countDraft}</div></div>
  `;
}

function renderBillList() {
  const search = document.getElementById('bill-search')?.value.toLowerCase() || '';
  const filterStatus = document.getElementById('bill-filter-status')?.value || '';
  const tbody = document.getElementById('bill-tbody');
  const empty = document.getElementById('bill-empty');
  if (!tbody) return;

  let filtered = bills.map(b => ({ ...b, effectiveStatus: getBillStatus(b) }));
  if (search) filtered = filtered.filter(b =>
    b.number?.toLowerCase().includes(search) ||
    contacts.find(c => c.id === b.contact_id)?.name?.toLowerCase().includes(search)
  );
  if (filterStatus) filtered = filtered.filter(b => b.effectiveStatus === filterStatus);

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const statusBadge = s => `<span class="badge bill-status-${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</span>`;

  tbody.innerHTML = filtered.map(bill => {
    const contact = contacts.find(c => c.id === bill.contact_id);
    const status  = bill.effectiveStatus;
    return `
      <tr>
        <td class="mono" style="font-weight:600;">${bill.number || '—'}</td>
        <td>${contact?.name || '<span style="color:var(--text3);">—</span>'}</td>
        <td>${fmtDate(bill.bill_date)}</td>
        <td>${bill.due_date ? fmtDate(bill.due_date) : '—'}</td>
        <td class="mono" style="font-weight:600;">${fmt(bill.total)}</td>
        <td>${statusBadge(status)}</td>
        <td>
          <div class="flex-gap">
            <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="editBill('${bill.id}')">Edit</button>
            ${status !== 'paid' ? `<button class="btn btn-accent btn-sm" onclick="openMarkBillPaid('${bill.id}')">Pay</button>` : ''}
            <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteBillConfirm('${bill.id}')">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function deleteBillConfirm(id) {
  const bill = bills.find(b => b.id === id);
  if (!confirm(`Delete ${bill?.number || 'this bill'}?`)) return;
  await dbDeleteBill(id);
  renderBillList();
  renderBillKpis();
  toast('Bill deleted');
}

// ══════════════════════════════════════════════════════
//  BILL EDITOR
// ══════════════════════════════════════════════════════

function renderBillContactSelect() {
  const sel = document.getElementById('bill-contact');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select supplier…</option>' +
    contacts.filter(c => c.type !== 'customer').map(c =>
      `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${c.name}</option>`
    ).join('');
  // If no suppliers, show all contacts
  if (sel.options.length === 1) {
    sel.innerHTML = '<option value="">Select supplier…</option>' +
      contacts.map(c => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${c.name}</option>`).join('');
  }
}

function newBill() {
  document.getElementById('bill-edit-id').value    = '';
  document.getElementById('bill-number').value     = nextBillNumber();
  document.getElementById('bill-status').value     = 'received';
  document.getElementById('bill-date').valueAsDate  = new Date();
  document.getElementById('bill-notes').value      = '';
  document.getElementById('bill-contact').value    = '';
  document.getElementById('bill-editor-title').textContent = 'New Bill';
  // Set due date 30 days out
  const due = new Date(); due.setDate(due.getDate() + 30);
  document.getElementById('bill-due-date').value = due.toISOString().split('T')[0];
  resetBillLines();
  showBillTab('editor');
}

function editBill(id) {
  const bill = bills.find(b => b.id === id);
  if (!bill) return;
  document.getElementById('bill-edit-id').value      = bill.id;
  document.getElementById('bill-number').value       = bill.number || '';
  document.getElementById('bill-status').value       = bill.status;
  document.getElementById('bill-date').value         = bill.bill_date;
  document.getElementById('bill-due-date').value     = bill.due_date || '';
  document.getElementById('bill-notes').value        = bill.notes || '';
  document.getElementById('bill-contact').value      = bill.contact_id || '';
  document.getElementById('bill-editor-title').textContent = `Edit ${bill.number || 'Bill'}`;
  loadBillLines(bill.lines || []);
  showBillTab('editor');
}

function nextBillNumber() {
  if (!bills.length) return 'BILL-001';
  const nums = bills.map(b => b.number?.match(/(\d+)$/)?.[1]).filter(Boolean).map(Number);
  return 'BILL-' + String(nums.length ? Math.max(...nums) + 1 : 1).padStart(3, '0');
}

function resetBillLines() {
  billLineCount = 0;
  document.getElementById('bill-lines').innerHTML = '';
  addBillLine();
}

function loadBillLines(lines) {
  billLineCount = 0;
  document.getElementById('bill-lines').innerHTML = '';
  lines.length ? lines.forEach(l => addBillLine(l)) : addBillLine();
}

function addBillLine(data = {}) {
  const id = billLineCount++;
  const div = document.createElement('div');
  div.className = 'inv-line-row';
  div.innerHTML = `
    <input type="text" value="${data.description || ''}" placeholder="Description"
      style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);"
      oninput="renderBillSummary()">
    <input type="number" value="${data.qty ?? 1}" min="0" step="0.01"
      style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;"
      oninput="renderBillSummary()">
    <input type="number" value="${data.unit_price ?? ''}" min="0" step="0.01" placeholder="0.00"
      style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;"
      oninput="renderBillSummary()">
    <select style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);" onchange="renderBillSummary()">
      <option value="yes" ${(data.gst ?? 'yes') === 'yes' ? 'selected' : ''}>GST</option>
      <option value="no"  ${data.gst === 'no' ? 'selected' : ''}>Ex-GST</option>
    </select>
    <div style="padding:8px 12px;background:var(--surface2);border-radius:8px;font-size:13px;font-family:'DM Mono',monospace;text-align:right;" class="bill-line-total">$0.00</div>
    <button onclick="removeBillLine(this)" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:4px;">✕</button>
  `;
  document.getElementById('bill-lines').appendChild(div);
  renderBillSummary();
}

function removeBillLine(btn) {
  if (document.querySelectorAll('#bill-lines .inv-line-row').length <= 1) { toast('At least one line required'); return; }
  btn.closest('.inv-line-row').remove();
  renderBillSummary();
}

function getBillLines() {
  return Array.from(document.querySelectorAll('#bill-lines .inv-line-row')).map(row => {
    const inputs = row.querySelectorAll('input');
    const select = row.querySelector('select');
    const qty        = parseFloat(inputs[1].value) || 0;
    const unit_price = parseFloat(inputs[2].value) || 0;
    const gst        = select?.value || 'yes';
    const subtotal   = +(qty * unit_price).toFixed(2);
    const gst_amount = gst === 'yes' ? +(subtotal / 9).toFixed(2) : 0;
    return { id: uid(), description: inputs[0].value.trim(), qty, unit_price, gst, subtotal, gst_amount, total: +(subtotal + gst_amount).toFixed(2) };
  }).filter(l => l.description || l.unit_price > 0);
}

function renderBillSummary() {
  document.querySelectorAll('#bill-lines .inv-line-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const gst    = row.querySelector('select')?.value || 'yes';
    const sub    = (parseFloat(inputs[1]?.value)||0) * (parseFloat(inputs[2]?.value)||0);
    const total  = sub + (gst === 'yes' ? sub / 9 : 0);
    const el = row.querySelector('.bill-line-total');
    if (el) el.textContent = fmt(total);
  });
  const lines    = getBillLines();
  const subtotal = lines.reduce((s,l) => s+l.subtotal, 0);
  const gstTotal = lines.reduce((s,l) => s+l.gst_amount, 0);
  const total    = subtotal + gstTotal;
  const el = document.getElementById('bill-summary');
  if (!el) return;
  const contact = contacts.find(c => c.id === document.getElementById('bill-contact')?.value);
  el.innerHTML = `
    ${contact ? `<div style="margin-bottom:14px;padding:10px 14px;background:var(--surface2);border-radius:8px;"><div style="font-weight:600;">${contact.name}</div>${contact.abn ? `<div style="font-size:12px;color:var(--text3);">ABN ${contact.abn}</div>` : ''}</div>` : ''}
    <div style="border-top:1px solid var(--border);padding-top:12px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;"><span style="color:var(--text2);">Subtotal</span><span class="mono">${fmt(subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;"><span style="color:var(--text2);">GST (10%)</span><span class="mono">${fmt(gstTotal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:2px solid var(--text);padding-top:10px;margin-top:6px;"><span>Total</span><span class="mono">${fmt(total)}</span></div>
    </div>
  `;
}

async function saveBillAs(status) {
  const id        = document.getElementById('bill-edit-id').value || uid();
  const number    = document.getElementById('bill-number').value.trim();
  const contactId = document.getElementById('bill-contact').value;
  const billDate  = document.getElementById('bill-date').value;
  const dueDate   = document.getElementById('bill-due-date').value;
  const notes     = document.getElementById('bill-notes').value.trim();
  const lines     = getBillLines();
  if (!billDate)    { toast('Bill date is required'); return; }
  if (!lines.length){ toast('Add at least one line item'); return; }
  const subtotal  = lines.reduce((s,l) => s+l.subtotal, 0);
  const gst_total = lines.reduce((s,l) => s+l.gst_amount, 0);
  const total     = +(subtotal + gst_total).toFixed(2);
  const bill = {
    id, number: number || nextBillNumber(), contact_id: contactId || null,
    bill_date: billDate, due_date: dueDate || null, status,
    notes, subtotal: +subtotal.toFixed(2), gst_total, total, lines,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await dbSaveBill(bill);
  renderBillList();
  renderBillKpis();
  showBillTab('list');
  toast(`Bill saved ✓`);
}

// ══════════════════════════════════════════════════════
//  MARK AS PAID
// ══════════════════════════════════════════════════════

function openMarkBillPaid(billId) {
  const bill    = bills.find(b => b.id === billId);
  const contact = contacts.find(c => c.id === bill?.contact_id);
  if (!bill) return;
  document.getElementById('bill-paid-id').value      = billId;
  document.getElementById('bill-paid-date').valueAsDate = new Date();
  document.getElementById('bill-paid-amount').value  = bill.total;
  document.getElementById('bill-paid-ref').value     = bill.number || '';
  document.getElementById('bill-paid-desc').value    = `Payment — ${bill.number || 'Bill'}${contact ? ' · ' + contact.name : ''}`;
  document.getElementById('mark-bill-paid-modal').classList.add('show');
}

async function confirmBillPaid() {
  const btn = document.querySelector('#mark-bill-paid-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const billId  = document.getElementById('bill-paid-id').value;
  const date    = document.getElementById('bill-paid-date').value;
  const amount  = parseFloat(document.getElementById('bill-paid-amount').value);
  const debit   = document.getElementById('bill-paid-debit').value;
  const credit  = document.getElementById('bill-paid-credit').value;
  const ref     = document.getElementById('bill-paid-ref').value.trim();
  const desc    = document.getElementById('bill-paid-desc').value.trim();

  if (!date || isNaN(amount)) {
    toast('Please fill in date and amount');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Mark Paid & Save Transaction'; }
    return;
  }

  const tx = {
    id: uid(), date, ref, desc,
    type: 'journal',
    debits:  [{ account: debit,  amount }],
    credits: [{ account: credit, amount }],
    amount, gst: 'no', method: 'Bank', reconciled: false,
  };

  // Prevent duplicate — check if this bill already has a transaction
  const existingBill = bills.find(b => b.id === billId);
  if (existingBill?.transaction_id) {
    toast('This bill has already been marked as paid');
    closeModal('mark-bill-paid-modal');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Mark Paid & Save Transaction'; }
    return;
  }

  transactions.unshift(tx);
  await dbSaveTransaction(tx);

  if (existingBill) {
    existingBill.status = 'paid';
    existingBill.paid_date = date;
    existingBill.transaction_id = tx.id;
    await dbSaveBill(existingBill);
  }

  if (btn) { btn.disabled = false; btn.textContent = '✓ Mark Paid & Save Transaction'; }
  closeModal('mark-bill-paid-modal');
  renderBillList();
  renderBillKpis();
  renderAll();
  toast('✓ Bill marked paid — transaction created');
}

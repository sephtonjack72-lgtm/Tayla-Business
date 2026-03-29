/* ══════════════════════════════════════════════════════
   Tayla Business — Invoices & Contacts
   invoices.js
══════════════════════════════════════════════════════ */

// ── State
let contacts = JSON.parse(localStorage.getItem('contacts') || '[]');
let invoices = JSON.parse(localStorage.getItem('invoices') || '[]');

// ══════════════════════════════════════════════════════
//  SUPABASE — CONTACTS
// ══════════════════════════════════════════════════════

async function dbLoadContacts() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('contacts').select('*').eq('business_id', _businessId).order('name');
  if (error) { console.error('Load contacts failed:', error); return; }
  contacts = data || [];
  localStorage.setItem('contacts', JSON.stringify(contacts));
}

async function dbSaveContact(contact) {
  const idx = contacts.findIndex(c => c.id === contact.id);
  if (idx >= 0) contacts[idx] = contact; else contacts.push(contact);
  localStorage.setItem('contacts', JSON.stringify(contacts));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('contacts').upsert({ ...contact, business_id: _businessId }, { onConflict: 'id' });
  if (error) console.error('Save contact failed:', error);
}

async function dbDeleteContact(id) {
  contacts = contacts.filter(c => c.id !== id);
  localStorage.setItem('contacts', JSON.stringify(contacts));
  if (!_businessId) return;
  await _supabase.from('contacts').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  SUPABASE — INVOICES
// ══════════════════════════════════════════════════════

async function dbLoadInvoices() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('invoices').select('*, invoice_lines(*)')
    .eq('business_id', _businessId)
    .order('issue_date', { ascending: false });
  if (error) { console.error('Load invoices failed:', error); return; }
  invoices = (data || []).map(inv => ({ ...inv, lines: inv.invoice_lines || [] }));
  localStorage.setItem('invoices', JSON.stringify(invoices));
}

async function dbSaveInvoice(invoice) {
  const { lines, ...header } = invoice;
  const idx = invoices.findIndex(i => i.id === invoice.id);
  if (idx >= 0) invoices[idx] = invoice; else invoices.unshift(invoice);
  localStorage.setItem('invoices', JSON.stringify(invoices));
  if (!_businessId) return;

  // Upsert header
  const { error: hErr } = await _supabase
    .from('invoices').upsert({ ...header, business_id: _businessId }, { onConflict: 'id' });
  if (hErr) { console.error('Save invoice failed:', hErr); return; }

  // Replace lines
  await _supabase.from('invoice_lines').delete().eq('invoice_id', invoice.id);
  if (lines?.length) {
    const rows = lines.map((l, i) => ({ ...l, id: l.id || uid(), invoice_id: invoice.id, sort_order: i }));
    const { error: lErr } = await _supabase.from('invoice_lines').insert(rows);
    if (lErr) console.error('Save invoice lines failed:', lErr);
  }
}

async function dbDeleteInvoice(id) {
  invoices = invoices.filter(i => i.id !== id);
  localStorage.setItem('invoices', JSON.stringify(invoices));
  if (!_businessId) return;
  await _supabase.from('invoice_lines').delete().eq('invoice_id', id);
  await _supabase.from('invoices').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  INVOICE NUMBER AUTO-INCREMENT
// ══════════════════════════════════════════════════════

function nextInvoiceNumber() {
  if (!invoices.length) return 'INV-001';
  const nums = invoices
    .map(i => i.number?.match(/(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return 'INV-' + String(next).padStart(3, '0');
}

// ══════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════

function showInvTab(tab) {
  ['list', 'contacts', 'editor'].forEach(t => {
    const el = document.getElementById(`inv-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`itab-${t}`);
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--text2)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
    }
  });
  if (tab === 'list')     { renderInvoiceList(); renderInvKpis(); }
  if (tab === 'contacts') { renderContactsList(); }
  if (tab === 'editor')   { renderInvContactSelect(); renderInvLines(); renderInvSummary(); }
}

// ══════════════════════════════════════════════════════
//  CONTACTS UI
// ══════════════════════════════════════════════════════

function renderContactsList() {
  const search = document.getElementById('contact-search')?.value.toLowerCase() || '';
  const el = document.getElementById('contacts-list');
  if (!el) return;
  const filtered = contacts.filter(c =>
    !search || c.name?.toLowerCase().includes(search) || c.email?.toLowerCase().includes(search)
  );
  if (!filtered.length) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">No contacts found.</div>`;
    return;
  }
  el.innerHTML = filtered.map(c => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:600;font-size:14px;">${c.name}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">
          ${c.email || ''} ${c.phone ? '· ' + c.phone : ''} ${c.abn ? '· ABN ' + c.abn : ''}
        </div>
        ${c.address ? `<div style="font-size:12px;color:var(--text3);">${c.address}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;">
        <span class="badge ${c.type === 'customer' ? 'badge-income' : c.type === 'supplier' ? 'badge-software' : 'badge-operating'}">${c.type || 'customer'}</span>
        <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="editContact('${c.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteContactConfirm('${c.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}

async function saveContact() {
  const name    = document.getElementById('contact-name').value.trim();
  const type    = document.getElementById('contact-type').value;
  const abn     = document.getElementById('contact-abn').value.trim();
  const email   = document.getElementById('contact-email').value.trim();
  const phone   = document.getElementById('contact-phone').value.trim();
  const address = document.getElementById('contact-address').value.trim();
  if (!name) { toast('Contact name is required'); return; }

  const editId = document.getElementById('contact-edit-id').value;
  const contact = {
    id: editId || uid(), name, type, abn, email, phone, address,
    created_at: editId ? undefined : new Date().toISOString(),
  };
  if (!editId) delete contact.created_at;

  await dbSaveContact(contact);
  cancelContactEdit();
  renderContactsList();
  renderInvContactSelect();
  toast(`${editId ? 'Updated' : 'Added'} "${name}" ✓`);
}

function editContact(id) {
  const c = contacts.find(c => c.id === id);
  if (!c) return;
  document.getElementById('contact-edit-id').value  = c.id;
  document.getElementById('contact-name').value     = c.name || '';
  document.getElementById('contact-type').value     = c.type || 'customer';
  document.getElementById('contact-abn').value      = c.abn || '';
  document.getElementById('contact-email').value    = c.email || '';
  document.getElementById('contact-phone').value    = c.phone || '';
  document.getElementById('contact-address').value  = c.address || '';
  document.getElementById('contact-form-title').textContent = 'Edit Contact';
  document.getElementById('contact-cancel-btn').style.display = 'inline-flex';
  document.getElementById('contact-name').focus();
}

function cancelContactEdit() {
  ['contact-edit-id','contact-name','contact-abn','contact-email','contact-phone','contact-address'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('contact-type').value = 'customer';
  document.getElementById('contact-form-title').textContent = 'Add Contact';
  document.getElementById('contact-cancel-btn').style.display = 'none';
}

async function deleteContactConfirm(id) {
  const c = contacts.find(c => c.id === id);
  if (!confirm(`Remove "${c?.name}"? This won't delete their invoices.`)) return;
  await dbDeleteContact(id);
  renderContactsList();
  renderInvContactSelect();
  toast('Contact removed');
}

// ══════════════════════════════════════════════════════
//  INVOICE EDITOR
// ══════════════════════════════════════════════════════

function renderInvContactSelect() {
  const sel = document.getElementById('inv-contact');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">Select client…</option>' +
    contacts.filter(c => c.type !== 'supplier').map(c =>
      `<option value="${c.id}" ${c.id === currentVal ? 'selected' : ''}>${c.name}</option>`
    ).join('');
}

function newInvoice() {
  // Reset form
  document.getElementById('inv-edit-id').value     = '';
  document.getElementById('inv-number').value      = nextInvoiceNumber();
  document.getElementById('inv-status').value      = 'draft';
  document.getElementById('inv-issue-date').valueAsDate = new Date();
  document.getElementById('inv-payment-terms').value = '30';
  document.getElementById('inv-notes').value       = '';
  document.getElementById('inv-contact').value     = '';
  document.getElementById('editor-title').textContent = 'New Invoice';
  updateDueDate();
  resetInvLines();
  showInvTab('editor');
}

function editInvoice(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  document.getElementById('inv-edit-id').value        = inv.id;
  document.getElementById('inv-number').value         = inv.number;
  document.getElementById('inv-status').value         = inv.status;
  document.getElementById('inv-issue-date').value     = inv.issue_date;
  document.getElementById('inv-due-date').value       = inv.due_date;
  document.getElementById('inv-payment-terms').value  = inv.payment_terms || '30';
  document.getElementById('inv-notes').value          = inv.notes || '';
  document.getElementById('inv-contact').value        = inv.contact_id || '';
  document.getElementById('editor-title').textContent = `Edit ${inv.number}`;
  loadInvLines(inv.lines || []);
  showInvTab('editor');
}

function updateDueDate() {
  const terms = document.getElementById('inv-payment-terms')?.value;
  const issueVal = document.getElementById('inv-issue-date')?.value;
  if (!issueVal || terms === 'custom') return;
  const issue = new Date(issueVal);
  issue.setDate(issue.getDate() + parseInt(terms));
  document.getElementById('inv-due-date').value = issue.toISOString().split('T')[0];
}

function onInvContactChange() {
  renderInvSummary();
}

// ── Line items
let invLineCount = 0;

function resetInvLines() {
  invLineCount = 0;
  document.getElementById('inv-lines').innerHTML = '';
  addInvLine();
}

function loadInvLines(lines) {
  invLineCount = 0;
  document.getElementById('inv-lines').innerHTML = '';
  if (lines.length) {
    lines.forEach(l => addInvLine(l));
  } else {
    addInvLine();
  }
}

function addInvLine(data = {}) {
  const id = invLineCount++;
  const div = document.createElement('div');
  div.className = 'inv-line-row';
  div.dataset.lineId = id;
  div.innerHTML = `
    <input type="text" value="${data.description || ''}" placeholder="Description"
      style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);"
      oninput="renderInvSummary()">
    <input type="number" value="${data.qty ?? 1}" min="0" step="0.01" placeholder="1"
      style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;"
      oninput="renderInvSummary()">
    <input type="number" value="${data.unit_price ?? ''}" min="0" step="0.01" placeholder="0.00"
      style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;"
      oninput="renderInvSummary()">
    <select style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);" onchange="renderInvSummary()">
      <option value="yes" ${(data.gst ?? 'yes') === 'yes' ? 'selected' : ''}>GST</option>
      <option value="no"  ${data.gst === 'no'  ? 'selected' : ''}>Ex-GST</option>
    </select>
    <div style="padding:8px 12px;background:var(--surface2);border-radius:8px;font-size:13px;font-family:'DM Mono',monospace;text-align:right;" class="inv-line-total">$0.00</div>
    <button onclick="removeInvLine(this)" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:4px;" title="Remove line">✕</button>
  `;
  document.getElementById('inv-lines').appendChild(div);
  renderInvSummary();
}

function removeInvLine(btn) {
  const lines = document.querySelectorAll('.inv-line-row');
  if (lines.length <= 1) { toast('At least one line item required'); return; }
  btn.closest('.inv-line-row').remove();
  renderInvSummary();
}

function getInvLines() {
  const rows = document.querySelectorAll('.inv-line-row');
  return Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    const select = row.querySelector('select');
    const desc       = inputs[0].value.trim();
    const qty        = parseFloat(inputs[1].value) || 0;
    const unit_price = parseFloat(inputs[2].value) || 0;
    const gst        = select?.value || 'yes';
    const subtotal   = +(qty * unit_price).toFixed(2);
    const gst_amount = gst === 'yes' ? +(subtotal / 9).toFixed(2) : 0;
    const total      = +(subtotal + gst_amount).toFixed(2);
    return { id: uid(), description: desc, qty, unit_price, gst, subtotal, gst_amount, total };
  }).filter(l => l.description || l.unit_price > 0);
}

function renderInvSummary() {
  // Update line totals in the form
  const rows = document.querySelectorAll('.inv-line-row');
  rows.forEach(row => {
    const inputs  = row.querySelectorAll('input');
    const select  = row.querySelector('select');
    const qty     = parseFloat(inputs[1]?.value) || 0;
    const price   = parseFloat(inputs[2]?.value) || 0;
    const gst     = select?.value || 'yes';
    const sub     = qty * price;
    const gstAmt  = gst === 'yes' ? sub / 9 : 0;
    const total   = sub + gstAmt;
    const totalEl = row.querySelector('.inv-line-total');
    if (totalEl) totalEl.textContent = fmt(total);
  });

  // Summary panel
  const lines = getInvLines();
  const subtotal  = lines.reduce((s, l) => s + l.subtotal, 0);
  const gstTotal  = lines.reduce((s, l) => s + l.gst_amount, 0);
  const grandTotal = subtotal + gstTotal;

  const contactId = document.getElementById('inv-contact')?.value;
  const contact = contacts.find(c => c.id === contactId);
  const issueDate = document.getElementById('inv-issue-date')?.value;
  const dueDate   = document.getElementById('inv-due-date')?.value;
  const invNum    = document.getElementById('inv-number')?.value;

  const el = document.getElementById('inv-summary');
  if (!el) return;
  el.innerHTML = `
    ${contact ? `
      <div style="margin-bottom:16px;padding:12px 14px;background:var(--surface2);border-radius:8px;">
        <div style="font-weight:600;font-size:14px;">${contact.name}</div>
        ${contact.email ? `<div style="font-size:12px;color:var(--text3);">${contact.email}</div>` : ''}
        ${contact.address ? `<div style="font-size:12px;color:var(--text3);">${contact.address}</div>` : ''}
        ${contact.abn ? `<div style="font-size:12px;color:var(--text3);">ABN ${contact.abn}</div>` : ''}
      </div>` : ''}
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px;">
      ${invNum ? `<strong>${invNum}</strong> · ` : ''}
      ${issueDate ? `Issued ${fmtDate(issueDate)}` : ''}
      ${dueDate ? ` · Due ${fmtDate(dueDate)}` : ''}
    </div>
    <div style="border-top:1px solid var(--border);padding-top:12px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
        <span style="color:var(--text2);">Subtotal</span>
        <span class="mono">${fmt(subtotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
        <span style="color:var(--text2);">GST (10%)</span>
        <span class="mono">${fmt(gstTotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:2px solid var(--text);padding-top:10px;margin-top:6px;">
        <span>Total</span>
        <span class="mono">${fmt(grandTotal)}</span>
      </div>
    </div>
  `;
}

// ── Save invoice
async function saveInvoiceAs(status) {
  const id        = document.getElementById('inv-edit-id').value || uid();
  const number    = document.getElementById('inv-number').value.trim();
  const contactId = document.getElementById('inv-contact').value;
  const issueDate = document.getElementById('inv-issue-date').value;
  const dueDate   = document.getElementById('inv-due-date').value;
  const notes     = document.getElementById('inv-notes').value.trim();
  const terms     = document.getElementById('inv-payment-terms').value;
  const lines     = getInvLines();

  if (!number)    { toast('Invoice number is required'); return; }
  if (!issueDate) { toast('Issue date is required'); return; }
  if (!lines.length) { toast('Add at least one line item'); return; }

  const subtotal   = lines.reduce((s, l) => s + l.subtotal, 0);
  const gst_total  = lines.reduce((s, l) => s + l.gst_amount, 0);
  const total      = +(subtotal + gst_total).toFixed(2);

  // Check for overdue
  const effectiveStatus = status === 'sent' && dueDate && new Date(dueDate) < new Date()
    ? 'overdue' : status;

  const invoice = {
    id, number, contact_id: contactId || null, issue_date: issueDate,
    due_date: dueDate || null, status: effectiveStatus, notes,
    payment_terms: terms, subtotal: +subtotal.toFixed(2), gst_total, total,
    lines, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };

  await dbSaveInvoice(invoice);
  renderInvoiceList();
  renderInvKpis();
  showInvTab('list');
  toast(`${number} saved as ${effectiveStatus} ✓`);
}

function saveInvoiceDraft() { saveInvoiceAs('draft'); }
function saveInvoiceSend()  { saveInvoiceAs('sent'); }

// ══════════════════════════════════════════════════════
//  INVOICE LIST
// ══════════════════════════════════════════════════════

function getInvoiceStatus(inv) {
  if (inv.status === 'paid') return 'paid';
  if (inv.status === 'draft') return 'draft';
  if (inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid') return 'overdue';
  return inv.status;
}

function renderInvoiceList() {
  const search = document.getElementById('inv-search')?.value.toLowerCase() || '';
  const filterStatus = document.getElementById('inv-filter-status')?.value || '';
  const tbody = document.getElementById('inv-tbody');
  const empty = document.getElementById('inv-empty');
  if (!tbody) return;

  let filtered = invoices.map(i => ({ ...i, effectiveStatus: getInvoiceStatus(i) }));
  if (search) filtered = filtered.filter(i =>
    i.number?.toLowerCase().includes(search) ||
    contacts.find(c => c.id === i.contact_id)?.name?.toLowerCase().includes(search)
  );
  if (filterStatus) filtered = filtered.filter(i => i.effectiveStatus === filterStatus);

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const statusBadge = s => `<span class="badge inv-status-${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</span>`;

  tbody.innerHTML = filtered.map(inv => {
    const contact = contacts.find(c => c.id === inv.contact_id);
    const status  = inv.effectiveStatus;
    return `
      <tr>
        <td class="mono" style="font-weight:600;">${inv.number}</td>
        <td>${contact?.name || '<span style="color:var(--text3);">—</span>'}</td>
        <td>${fmtDate(inv.issue_date)}</td>
        <td>${inv.due_date ? fmtDate(inv.due_date) : '—'}</td>
        <td class="mono" style="font-weight:600;">${fmt(inv.total)}</td>
        <td>${statusBadge(status)}</td>
        <td>
          <div class="flex-gap">
            <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="editInvoice('${inv.id}')">Edit</button>
            ${status !== 'paid' ? `<button class="btn btn-accent btn-sm" onclick="openMarkPaid('${inv.id}')">Mark Paid</button>` : ''}
            <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="printInvoiceById('${inv.id}')">🖨</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteInvoiceConfirm('${inv.id}')">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderInvKpis() {
  const el = document.getElementById('inv-kpis');
  if (!el) return;
  const all = invoices.map(i => ({ ...i, effectiveStatus: getInvoiceStatus(i) }));
  const totalOutstanding = all.filter(i => ['sent','overdue'].includes(i.effectiveStatus)).reduce((s,i) => s+i.total, 0);
  const totalOverdue     = all.filter(i => i.effectiveStatus === 'overdue').reduce((s,i) => s+i.total, 0);
  const totalPaid        = all.filter(i => i.effectiveStatus === 'paid').reduce((s,i) => s+i.total, 0);
  const countDraft       = all.filter(i => i.effectiveStatus === 'draft').length;
  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">${fmt(totalOutstanding)}</div></div>
    <div class="kpi"><div class="kpi-label">Overdue</div><div class="kpi-value negative">${fmt(totalOverdue)}</div></div>
    <div class="kpi"><div class="kpi-label">Paid This Year</div><div class="kpi-value positive">${fmt(totalPaid)}</div></div>
    <div class="kpi"><div class="kpi-label">Drafts</div><div class="kpi-value">${countDraft}</div></div>
  `;
}

async function deleteInvoiceConfirm(id) {
  const inv = invoices.find(i => i.id === id);
  if (!confirm(`Delete ${inv?.number}? This cannot be undone.`)) return;
  await dbDeleteInvoice(id);
  renderInvoiceList();
  renderInvKpis();
  toast('Invoice deleted');
}

// ══════════════════════════════════════════════════════
//  MARK AS PAID
// ══════════════════════════════════════════════════════

function openMarkPaid(invoiceId) {
  const inv     = invoices.find(i => i.id === invoiceId);
  const contact = contacts.find(c => c.id === inv?.contact_id);
  if (!inv) return;
  document.getElementById('paid-invoice-id').value  = invoiceId;
  document.getElementById('paid-date').valueAsDate   = new Date();
  document.getElementById('paid-amount').value       = inv.total;
  document.getElementById('paid-ref').value          = inv.number;
  document.getElementById('paid-desc').value         = `Payment received — ${inv.number}${contact ? ' · ' + contact.name : ''}`;
  document.getElementById('mark-paid-modal').classList.add('show');
}

async function confirmMarkPaid() {
  const invoiceId = document.getElementById('paid-invoice-id').value;
  const date      = document.getElementById('paid-date').value;
  const amount    = parseFloat(document.getElementById('paid-amount').value);
  const debitAcc  = document.getElementById('paid-debit-account').value;
  const creditAcc = document.getElementById('paid-credit-account').value;
  const ref       = document.getElementById('paid-ref').value.trim();
  const desc      = document.getElementById('paid-desc').value.trim();

  if (!date || isNaN(amount)) { toast('Please fill in date and amount'); return; }

  // Create ledger transaction
  const tx = {
    id: uid(), date, ref, desc,
    type: 'journal',
    debits:  [{ account: debitAcc,  amount }],
    credits: [{ account: creditAcc, amount }],
    amount, gst: 'no', method: 'Bank',
    reconciled: false,
  };
  transactions.unshift(tx);
  await dbSaveTransaction(tx);

  // Update invoice status
  const inv = invoices.find(i => i.id === invoiceId);
  if (inv) {
    inv.status = 'paid';
    inv.paid_date = date;
    inv.transaction_id = tx.id;
    await dbSaveInvoice(inv);
  }

  closeModal('mark-paid-modal');
  renderInvoiceList();
  renderInvKpis();
  renderAll();
  toast(`✓ Marked paid — transaction created`);
}

// ══════════════════════════════════════════════════════
//  PRINT / PDF / EMAIL
// ══════════════════════════════════════════════════════

function getActiveInvoice() {
  const id = document.getElementById('inv-edit-id')?.value;
  if (id) return invoices.find(i => i.id === id);
  // Build ephemeral invoice from current form state
  const lines = getInvLines();
  return {
    number:    document.getElementById('inv-number')?.value,
    issue_date: document.getElementById('inv-issue-date')?.value,
    due_date:  document.getElementById('inv-due-date')?.value,
    notes:     document.getElementById('inv-notes')?.value,
    contact_id: document.getElementById('inv-contact')?.value,
    lines,
    subtotal:  lines.reduce((s,l) => s+l.subtotal, 0),
    gst_total: lines.reduce((s,l) => s+l.gst_amount, 0),
    total:     lines.reduce((s,l) => s+l.total, 0),
  };
}

function printInvoice() {
  const inv = getActiveInvoice();
  openPrintWindow(inv);
}

function printInvoiceById(id) {
  const inv = invoices.find(i => i.id === id);
  if (inv) openPrintWindow(inv);
}

function openPrintWindow(inv) {
  const contact  = contacts.find(c => c.id === inv.contact_id);
  const profile  = _businessProfile || {};
  const linesHtml = (inv.lines || []).map(l => `
    <tr>
      <td>${l.description}</td>
      <td style="text-align:right;">${l.qty}</td>
      <td style="text-align:right;">${fmt(l.unit_price)}</td>
      <td style="text-align:center;">${l.gst === 'yes' ? '10%' : '—'}</td>
      <td style="text-align:right;">${fmt(l.total)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${inv.number || 'Invoice'}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; padding: 52px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
  .logo { font-family: 'DM Serif Display', serif; font-size: 24px; color: #1a1a2e; }
  .logo span { color: #e8c547; }
  .inv-title { font-family: 'DM Serif Display', serif; font-size: 32px; color: #1a1a2e; text-align: right; }
  .inv-number { font-family: 'DM Mono', monospace; font-size: 14px; color: #9f9fba; text-align: right; margin-top: 4px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 40px; }
  .party-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .8px; color: #9f9fba; margin-bottom: 8px; }
  .party-name { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
  .party-detail { font-size: 12px; color: #5c5c7a; line-height: 1.6; }
  .dates { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-bottom: 36px; padding: 20px; background: #f7f5f2; border-radius: 10px; }
  .date-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; color: #9f9fba; margin-bottom: 4px; }
  .date-val { font-family: 'DM Mono', monospace; font-size: 14px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; color: #9f9fba; background: #f0ede8; border-bottom: 1px solid #e2ddd6; }
  td { padding: 12px 14px; border-bottom: 1px solid #f0ede8; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .totals { margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .total-row.grand { font-size: 16px; font-weight: 700; border-top: 2px solid #1a1a2e; padding-top: 10px; margin-top: 4px; }
  .notes { margin-top: 40px; padding: 20px; background: #f7f5f2; border-radius: 10px; font-size: 12px; color: #5c5c7a; line-height: 1.7; }
  .footer { margin-top: 48px; text-align: center; font-size: 11px; color: #9f9fba; border-top: 1px solid #e2ddd6; padding-top: 20px; }
  .mono { font-family: 'DM Mono', monospace; }
  @media print { body { padding: 32px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Tayla <span>Business</span></div>
      <div style="font-size:12px;color:#9f9fba;margin-top:6px;">${profile.biz_name || ''}</div>
      ${profile.abn ? `<div style="font-size:12px;color:#9f9fba;">ABN ${profile.abn}</div>` : ''}
      ${profile.address ? `<div style="font-size:12px;color:#9f9fba;">${profile.address}${profile.state ? ', ' + profile.state : ''}</div>` : ''}
      ${profile.biz_email ? `<div style="font-size:12px;color:#9f9fba;">${profile.biz_email}</div>` : ''}
    </div>
    <div>
      <div class="inv-title">Invoice</div>
      <div class="inv-number">${inv.number || ''}</div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">Bill To</div>
      <div class="party-name">${contact?.name || '—'}</div>
      <div class="party-detail">
        ${contact?.abn ? 'ABN ' + contact.abn + '<br>' : ''}
        ${contact?.address ? contact.address + '<br>' : ''}
        ${contact?.email || ''}
      </div>
    </div>
    <div>
      <div class="party-label">From</div>
      <div class="party-name">${profile.biz_name || 'Tayla Business'}</div>
      <div class="party-detail">
        ${profile.abn ? 'ABN ' + profile.abn + '<br>' : ''}
        ${profile.address ? profile.address + (profile.state ? ', ' + profile.state : '') + '<br>' : ''}
        ${profile.biz_email || ''}
      </div>
    </div>
  </div>

  <div class="dates">
    <div><div class="date-label">Invoice Date</div><div class="date-val">${fmtDate(inv.issue_date)}</div></div>
    <div><div class="date-label">Due Date</div><div class="date-val">${inv.due_date ? fmtDate(inv.due_date) : '—'}</div></div>
    <div><div class="date-label">Status</div><div class="date-val">${(inv.status || 'Draft').charAt(0).toUpperCase() + (inv.status || 'draft').slice(1)}</div></div>
  </div>

  <table>
    <thead><tr><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:center;">GST</th><th style="text-align:right;">Amount</th></tr></thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="totals">
    <div class="total-row"><span style="color:#5c5c7a;">Subtotal</span><span class="mono">${fmt(inv.subtotal || 0)}</span></div>
    <div class="total-row"><span style="color:#5c5c7a;">GST (10%)</span><span class="mono">${fmt(inv.gst_total || 0)}</span></div>
    <div class="total-row grand"><span>Total Due</span><span class="mono">${fmt(inv.total || 0)}</span></div>
  </div>

  ${inv.notes ? `<div class="notes"><strong>Notes</strong><br>${inv.notes}</div>` : ''}

  <div class="footer">Generated by Tayla Business · usetayla.com.au</div>

  <script>window.onload = () => window.print();<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

function emailInvoice() {
  const inv     = getActiveInvoice();
  const contact = contacts.find(c => c.id === inv?.contact_id);
  const profile = _businessProfile || {};
  if (!contact?.email) { toast('No email address for this client — add one in Contacts'); return; }
  const subject = encodeURIComponent(`Invoice ${inv.number} from ${profile.biz_name || 'Tayla Business'}`);
  const body = encodeURIComponent(
    `Hi ${contact.name},\n\nPlease find attached invoice ${inv.number} for ${fmt(inv.total)}, due ${inv.due_date ? fmtDate(inv.due_date) : 'on receipt'}.\n\n${inv.notes ? inv.notes + '\n\n' : ''}Kind regards,\n${profile.biz_name || ''}`
  );
  window.open(`mailto:${contact.email}?subject=${subject}&body=${body}`);
}

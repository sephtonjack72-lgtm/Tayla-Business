/* ══════════════════════════════════════════════════════
   Tayla Business — Receipts & Petty Cash
   receipts.js
══════════════════════════════════════════════════════ */

// ── State
let receipts = JSON.parse(localStorage.getItem('receipts') || '[]');
let _currentReceiptFile = null;
let _currentReceiptBase64 = null;

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadReceipts() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('receipts').select('*')
    .eq('business_id', _businessId)
    .order('receipt_date', { ascending: false });
  if (error) { console.error('Load receipts failed:', error); return; }
  receipts = data || [];
  localStorage.setItem('receipts', JSON.stringify(receipts));
}

async function dbSaveReceipt(receipt) {
  const idx = receipts.findIndex(r => r.id === receipt.id);
  if (idx >= 0) receipts[idx] = receipt; else receipts.unshift(receipt);
  localStorage.setItem('receipts', JSON.stringify(receipts));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('receipts').upsert({ ...receipt, business_id: _businessId }, { onConflict: 'id' });
  if (error) {
    console.error('Save receipt failed:', error);
    toast('⚠ Receipt saved locally but failed to sync: ' + error.message);
  }
}

// ── Upload file to Supabase Storage
async function uploadReceiptToStorage(file, receiptId) {
  if (!_businessId) return null;
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${_businessId}/${receiptId}.${ext}`;
  const { error } = await _supabase.storage.from('receipts').upload(path, file, { upsert: true });
  if (error) { console.error('Storage upload failed:', error); return null; }
  const { data } = _supabase.storage.from('receipts').getPublicUrl(path);
  return data?.publicUrl || null;
}

// ══════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════

function showReceiptTab(tab) {
  ['upload','list','petty'].forEach(t => {
    const el = document.getElementById(`rcpt-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`rtab-${t}`);
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--text2)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
    }
  });
  if (tab === 'list')  renderReceiptList();
  if (tab === 'petty') renderPettyCash();
  if (tab === 'upload') populateRcptAccountSelect();
}

// ══════════════════════════════════════════════════════
//  FILE HANDLING
// ══════════════════════════════════════════════════════

function handleReceiptDrop(e) {
  const file = e.dataTransfer.files[0];
  if (file) processReceiptFile(file);
}

function handleReceiptFile(input) {
  const file = input.files[0];
  if (file) processReceiptFile(file);
}

function processReceiptFile(file) {
  const allowed = ['image/jpeg','image/png','image/webp','image/heic'];
  if (!allowed.includes(file.type)) {
    showRcptError('Please upload a JPG, PNG or WebP image. PDF receipts are not supported yet — take a photo of the receipt instead.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showRcptError('File must be under 10MB.');
    return;
  }
  _currentReceiptFile = file;
  document.getElementById('rcpt-upload-error').style.display = 'none';

  const reader = new FileReader();
  reader.onload = e => {
    _currentReceiptBase64 = e.target.result;
    // Show preview for images
    if (file.type.startsWith('image/')) {
      document.getElementById('rcpt-preview-img').src = e.target.result;
      document.getElementById('rcpt-drop-preview').style.display = 'block';
      document.getElementById('rcpt-drop-text').style.display = 'none';
    } else {
      document.getElementById('rcpt-drop-text').innerHTML = `
        <div style="font-size:32px;margin-bottom:8px;">📄</div>
        <div style="font-size:14px;font-weight:500;color:var(--text2);">${file.name}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:4px;">PDF ready to analyse</div>
      `;
    }
    document.getElementById('rcpt-analyse-btn').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function showRcptError(msg) {
  const el = document.getElementById('rcpt-upload-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// ══════════════════════════════════════════════════════
//  AI ANALYSIS — Claude Vision
// ══════════════════════════════════════════════════════

async function analyseReceipt() {
  if (!_currentReceiptBase64) { showRcptError('Please upload a file first.'); return; }

  document.getElementById('rcpt-analyse-btn').style.display    = 'none';
  document.getElementById('rcpt-analysing').style.display      = 'block';
  document.getElementById('rcpt-review-card').style.display    = 'none';

  try {
    let base64Data, mediaType;

    // Compress images before sending to keep payload small
    if (_currentReceiptFile.type.startsWith('image/')) {
      const compressed = await compressImage(_currentReceiptBase64, 1024, 0.8);
      base64Data = compressed.split(',')[1];
      mediaType  = 'image/jpeg';
    } else {
      base64Data = _currentReceiptBase64.split(',')[1];
      mediaType  = _currentReceiptFile.type;
    }

    const response = await fetch(
      'https://vyikolyljzygmxiahcul.supabase.co/functions/v1/analyse-receipt',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify({ base64: base64Data, mediaType }),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const extracted = await response.json();
    document.getElementById('rcpt-analysing').style.display = 'none';
    populateRcptReviewForm(extracted);

  } catch (err) {
    console.error('AI analysis failed:', err);
    document.getElementById('rcpt-analysing').style.display = 'none';
    document.getElementById('rcpt-analyse-btn').style.display = 'block';
    showRcptError('AI analysis failed: ' + err.message + ' — please fill in the details manually.');
    populateRcptReviewForm({});
  }
}

function compressImage(base64, maxSize, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
        else { width = Math.round(width * maxSize / height); height = maxSize; }
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = base64;
  });
}

function populateRcptReviewForm(data) {
  populateRcptAccountSelect();

  document.getElementById('rcpt-supplier').value = data.supplier || '';
  document.getElementById('rcpt-date').value     = data.date     || new Date().toISOString().split('T')[0];
  document.getElementById('rcpt-total').value    = data.total    || '';
  document.getElementById('rcpt-gst').value      = data.gst != null ? data.gst : '';
  document.getElementById('rcpt-net').value      = data.net  != null ? data.net  : '';
  document.getElementById('rcpt-desc').value     = data.description || '';

  if (data.account) {
    const sel = document.getElementById('rcpt-account');
    if (sel) sel.value = data.account;
  }

  // Show confidence badge
  const card = document.getElementById('rcpt-review-card');
  card.style.display = 'block';

  if (data.confidence) {
    const colours = { high: '#d4edda', medium: '#fff3cd', low: '#fde2e2' };
    const labels  = { high: '✓ High confidence', medium: '⚠ Medium confidence — please verify', low: '⚠ Low confidence — please verify carefully' };
    const badge = card.querySelector('.card-header span:last-child');
    if (badge) {
      badge.textContent = labels[data.confidence] || 'AI extracted — please verify';
      badge.style.background = colours[data.confidence] || 'var(--surface2)';
    }
  }
}

function populateRcptAccountSelect() {
  const sel = document.getElementById('rcpt-account');
  if (!sel) return;
  const expenses = CHART_OF_ACCOUNTS.expenses?.accounts || [];
  sel.innerHTML = expenses.map(a => `<option value="${a.id}">${a.id} ${a.name}</option>`).join('');
}

function updateRcptGst() {
  const total = parseFloat(document.getElementById('rcpt-total')?.value) || 0;
  const gst   = +(total / 11).toFixed(2);
  const net   = +(total - gst).toFixed(2);
  document.getElementById('rcpt-gst').value = gst;
  document.getElementById('rcpt-net').value = net;
}

function resetReceiptUpload() {
  _currentReceiptFile   = null;
  _currentReceiptBase64 = null;
  document.getElementById('rcpt-file-input').value     = '';
  document.getElementById('rcpt-drop-preview').style.display = 'none';
  document.getElementById('rcpt-drop-text').style.display    = 'block';
  document.getElementById('rcpt-drop-text').innerHTML = `
    <div style="font-size:36px;margin-bottom:10px;">📷</div>
    <div style="font-size:14px;font-weight:500;color:var(--text2);">Drop receipt here or click to upload</div>
    <div style="font-size:12px;color:var(--text3);margin-top:6px;">JPG, PNG or PDF · Max 10MB</div>
  `;
  document.getElementById('rcpt-analyse-btn').style.display  = 'none';
  document.getElementById('rcpt-review-card').style.display  = 'none';
  document.getElementById('rcpt-upload-error').style.display = 'none';
}

// ══════════════════════════════════════════════════════
//  SAVE ENTRY
// ══════════════════════════════════════════════════════

async function saveReceiptEntry() {
  const supplier = document.getElementById('rcpt-supplier').value.trim();
  const date     = document.getElementById('rcpt-date').value;
  const total    = parseFloat(document.getElementById('rcpt-total').value) || 0;
  const gst      = parseFloat(document.getElementById('rcpt-gst').value)   || 0;
  const net      = +(total - gst).toFixed(2);
  const desc     = document.getElementById('rcpt-desc').value.trim();
  const account  = document.getElementById('rcpt-account').value;
  const type     = document.getElementById('rcpt-type').value;
  const payAcct  = document.getElementById('rcpt-payment-account').value;
  const errEl    = document.getElementById('rcpt-review-error');
  errEl.style.display = 'none';

  if (!date || !total) { errEl.textContent = 'Date and amount are required.'; errEl.style.display = 'block'; return; }

  const receiptId = uid();

  // Upload to Supabase Storage
  let fileUrl = null;
  if (_currentReceiptFile) {
    fileUrl = await uploadReceiptToStorage(_currentReceiptFile, receiptId);
  }

  // Save receipt record
  const receipt = {
    id: receiptId,
    supplier, date, total, gst_amount: gst, net_amount: net,
    description: desc, account, type,
    file_url: fileUrl,
    entry_id: null,
    receipt_date: date,
    created_at: new Date().toISOString(),
  };

  // Create the accounting entry
  if (type === 'bill') {
    // Create a bill
    const bill = {
      id: uid(),
      number: 'RCPT-' + receiptId.slice(0,6).toUpperCase(),
      contact_id: null,
      bill_date: date,
      due_date: date,
      status: 'received',
      notes: `Receipt: ${supplier}`,
      subtotal: net,
      gst_total: gst,
      total,
      lines: [{
        id: uid(), description: desc || supplier,
        qty: 1, unit_price: net, gst: gst > 0 ? 'yes' : 'no',
        subtotal: net, gst_amount: gst, total,
      }],
      receipt_id: receiptId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await dbSaveBill(bill);
    receipt.entry_id = bill.id;
    receipt.entry_type = 'bill';
    toast('✓ Bill created from receipt');

  } else {
    // Create transaction (direct or petty cash)
    const creditAccount = type === 'petty' ? '1015' : payAcct;
    const debits = gst > 0
      ? [{ account, amount: net }, { account: '1030', amount: gst }]
      : [{ account, amount: total }];

    const tx = {
      id: uid(), date,
      ref:  'RCPT-' + receiptId.slice(0,6).toUpperCase(),
      desc: desc || supplier,
      type: 'journal',
      debits,
      credits: [{ account: creditAccount, amount: total }],
      amount: total,
      gst: gst > 0 ? 'yes' : 'no',
      method: type === 'petty' ? 'Petty Cash' : 'Bank',
      reconciled: false,
      receipt_id: receiptId,
    };
    transactions.unshift(tx);
    await dbSaveTransaction(tx);
    receipt.entry_id   = tx.id;
    receipt.entry_type = 'transaction';
    toast(`✓ ${type === 'petty' ? 'Petty cash' : 'Transaction'} created from receipt`);
  }

  await dbSaveReceipt(receipt);
  renderAll();
  resetReceiptUpload();
  showReceiptTab('list');
}

// ══════════════════════════════════════════════════════
//  RECEIPT LIST
// ══════════════════════════════════════════════════════

function renderReceiptList() {
  const search = document.getElementById('rcpt-search')?.value.toLowerCase() || '';
  const tbody  = document.getElementById('rcpt-tbody');
  const empty  = document.getElementById('rcpt-list-empty');
  if (!tbody) return;

  const filtered = receipts.filter(r =>
    !search ||
    r.supplier?.toLowerCase().includes(search) ||
    r.description?.toLowerCase().includes(search)
  );

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const typeBadge = t => ({
    bill: '<span class="badge badge-operating">Bill</span>',
    transaction: '<span class="badge badge-income">Transaction</span>',
    petty: '<span class="badge badge-setup">Petty Cash</span>',
  })[t] || '';

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${fmtDate(r.receipt_date || r.date)}</td>
      <td style="font-weight:500;">${r.supplier || '—'}</td>
      <td style="color:var(--text2);">${r.description || '—'}</td>
      <td class="mono" style="font-weight:600;">${fmt(r.total || 0)}</td>
      <td class="mono" style="color:var(--text3);">${r.gst_amount ? fmt(r.gst_amount) : '—'}</td>
      <td>${typeBadge(r.type)}</td>
      <td>
        ${r.file_url
          ? `<a href="${r.file_url}" target="_blank" class="btn btn-ghost btn-sm" style="color:var(--accent3);">View 🔗</a>`
          : '<span style="color:var(--text3);font-size:12px;">No file</span>'}
      </td>
    </tr>
  `).join('');
}

// ══════════════════════════════════════════════════════
//  PETTY CASH
// ══════════════════════════════════════════════════════

function savePettyCashFloat() {
  const val = document.getElementById('petty-float')?.value;
  localStorage.setItem('pettyCashFloat', val || '0');
  renderPettyCash();
}

function renderPettyCash() {
  const float  = parseFloat(localStorage.getItem('pettyCashFloat')) || 0;
  const pettyTxns = transactions.filter(t =>
    t.method === 'Petty Cash' ||
    t.credits?.some(c => c.account === '1015') ||
    t.debits?.some(d => d.account === '1015')
  );
  const spent = pettyTxns.reduce((s, t) => s + (t.amount || 0), 0);
  const remaining = float - spent;

  const floatEl     = document.getElementById('petty-float-display');
  const spentEl     = document.getElementById('petty-spent-display');
  const remainingEl = document.getElementById('petty-remaining-display');
  if (floatEl) floatEl.textContent = fmt(float);
  if (spentEl) spentEl.textContent = fmt(spent);
  if (remainingEl) {
    remainingEl.textContent = fmt(remaining);
    remainingEl.style.color = remaining < 0 ? 'var(--danger)' : remaining < float * 0.2 ? '#856404' : 'var(--success)';
  }

  // Set float input
  const floatInput = document.getElementById('petty-float');
  if (floatInput && !floatInput.value) floatInput.value = float || '';

  // Render petty cash transactions
  const listEl = document.getElementById('petty-txn-list');
  if (!listEl) return;
  if (!pettyTxns.length) {
    listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">No petty cash transactions yet.</div>`;
    return;
  }
  listEl.innerHTML = pettyTxns.map(t => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:500;font-size:13px;">${t.desc || '—'}</div>
        <div style="font-size:12px;color:var(--text3);">${fmtDate(t.date)} · ${t.ref || ''}</div>
      </div>
      <div class="mono" style="font-weight:600;color:var(--danger);">${fmt(t.amount)}</div>
    </div>
  `).join('');
}

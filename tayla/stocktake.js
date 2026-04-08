/* ══════════════════════════════════════════════════════
   Tayla Business — Stocktake Module
   stocktake.js

   Inventory counting, variance tracking, and accounting
   integration for Australian hospitality venues.
══════════════════════════════════════════════════════ */

// ── State
let suppliers        = [];
let stockItems       = [];
let stocktakeSessions = [];
let _activeSession   = null;   // session being counted right now
let _viewingSession  = null;   // session open in the detail modal
let _scannerStream   = null;   // MediaStream for barcode camera
let _scannerInterval = null;   // polling interval for BarcodeDetector

// ══════════════════════════════════════════════════════
//  SUPABASE — SUPPLIERS
// ══════════════════════════════════════════════════════

async function dbLoadSuppliers() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('suppliers')
    .select('*')
    .eq('business_id', _businessId)
    .order('name');
  if (error) { console.error('Load suppliers failed:', error); return; }
  suppliers = data || [];
}

async function dbSaveSupplier(supplier) {
  const idx = suppliers.findIndex(s => s.id === supplier.id);
  if (idx >= 0) suppliers[idx] = supplier; else suppliers.push(supplier);
  if (!_businessId) return;
  const { error } = await _supabase
    .from('suppliers')
    .upsert({ ...supplier, business_id: _businessId }, { onConflict: 'id' });
  if (error) { console.error('Save supplier failed:', error); toast('Failed to save supplier: ' + error.message); }
}

async function dbDeleteSupplier(id) {
  suppliers = suppliers.filter(s => s.id !== id);
  if (!_businessId) return;
  const { error } = await _supabase.from('suppliers').delete().eq('id', id).eq('business_id', _businessId);
  if (error) console.error('Delete supplier failed:', error);
}

// ══════════════════════════════════════════════════════
//  SUPABASE — STOCK ITEMS
// ══════════════════════════════════════════════════════

async function dbLoadStockItems() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('stock_items')
    .select('*')
    .eq('business_id', _businessId)
    .order('category')
    .order('name');
  if (error) { console.error('Load stock items failed:', error); return; }
  stockItems = data || [];
  // Update item count hint on the start form
  const hint = document.getElementById('stk-item-count-hint');
  if (hint) hint.textContent = stockItems.filter(i => !i.archived).length + ' active items';
}

async function dbSaveStockItem(item) {
  const idx = stockItems.findIndex(i => i.id === item.id);
  if (idx >= 0) stockItems[idx] = item; else stockItems.push(item);
  if (!_businessId) return;
  const { error } = await _supabase
    .from('stock_items')
    .upsert({ ...item, business_id: _businessId }, { onConflict: 'id' });
  if (error) { console.error('Save stock item failed:', error); toast('Failed to save item: ' + error.message); }
}

// ══════════════════════════════════════════════════════
//  SUPABASE — STOCKTAKE SESSIONS
// ══════════════════════════════════════════════════════

async function dbLoadStocktakeSessions() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('stocktake_sessions')
    .select('*')
    .eq('business_id', _businessId)
    .order('date', { ascending: false });
  if (error) { console.error('Load sessions failed:', error); return; }

  stocktakeSessions = (data || []).map(s => ({
    ...s,
    items:       typeof s.items       === 'string' ? JSON.parse(s.items)       : (s.items       || []),
    journal_ids: typeof s.journal_ids === 'string' ? JSON.parse(s.journal_ids) : (s.journal_ids || []),
  }));

  // Restore any in-progress draft session
  const draft = stocktakeSessions.find(s => s.status === 'draft');
  if (draft) {
    _activeSession = draft;
    renderCountSheet();
    const newcountTab = document.getElementById('stktab-newcount');
    if (newcountTab) newcountTab.textContent = 'New Count (in progress)';
  }
}

async function dbSaveStocktakeSession(session) {
  const idx = stocktakeSessions.findIndex(s => s.id === session.id);
  if (idx >= 0) stocktakeSessions[idx] = session; else stocktakeSessions.unshift(session);
  if (!_businessId) return;
  const row = {
    ...session,
    items:       JSON.stringify(session.items || []),
    journal_ids: JSON.stringify(session.journal_ids || []),
    business_id: _businessId,
  };
  const { error } = await _supabase
    .from('stocktake_sessions')
    .upsert(row, { onConflict: 'id' });
  if (error) { console.error('Save session failed:', error); toast('Failed to save session: ' + error.message); }
}

async function dbDeleteStocktakeSession(id) {
  stocktakeSessions = stocktakeSessions.filter(s => s.id !== id);
  if (!_businessId) return;
  await _supabase.from('stocktake_sessions').delete().eq('id', id).eq('business_id', _businessId);
}

// ══════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════

function showStocktakeTab(tab) {
  ['catalogue', 'newcount', 'history'].forEach(t => {
    const panel = document.getElementById(`stk-${t}`);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`stktab-${t}`);
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--text2)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
    }
  });

  if (tab === 'catalogue') { renderCatalogue(); renderSuppliersList(); renderStkKpis(); }
  if (tab === 'newcount')  { renderNewCountTab(); }
  if (tab === 'history')   { renderSessionHistory(); }
}

// ══════════════════════════════════════════════════════
//  KPI STRIP
// ══════════════════════════════════════════════════════

function renderStkKpis() {
  const strip = document.getElementById('stk-kpi-strip');
  if (!strip) return;

  const activeItems    = stockItems.filter(i => !i.archived).length;
  const totalItems     = stockItems.length;
  const submitted      = stocktakeSessions.filter(s => s.status === 'submitted');
  const lastSession    = submitted[0];
  const lastDate       = lastSession ? new Date(lastSession.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—';
  const supplierCount  = suppliers.length;

  // Calculate average variance rate from last submitted session
  let varianceRate = '—';
  if (lastSession) {
    const items     = lastSession.items || [];
    const varItems  = items.filter(i => i.variance !== undefined && i.variance < 0).length;
    const total     = items.length;
    if (total > 0) varianceRate = Math.round((varItems / total) * 100) + '%';
  }

  strip.innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Active Items</div>
      <div class="kpi-value">${activeItems}</div>
      <div class="kpi-sub">${totalItems} total incl. archived</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Suppliers</div>
      <div class="kpi-value">${supplierCount}</div>
      <div class="kpi-sub">Linked to items</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Last Stocktake</div>
      <div class="kpi-value" style="font-size:20px;">${lastDate}</div>
      <div class="kpi-sub">${submitted.length} completed session${submitted.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Last Variance Rate</div>
      <div class="kpi-value" style="font-size:20px;">${varianceRate}</div>
      <div class="kpi-sub">Items below par last count</div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  CATALOGUE — ITEMS
// ══════════════════════════════════════════════════════

function renderCatalogue() {
  const el          = document.getElementById('stk-items-list');
  if (!el) return;
  const search      = (document.getElementById('stk-item-search')?.value || '').toLowerCase();
  const showArchived = document.getElementById('stk-show-archived')?.checked || false;

  let filtered = stockItems.filter(i => {
    if (!showArchived && i.archived) return false;
    if (search && !i.name?.toLowerCase().includes(search) && !i.category?.toLowerCase().includes(search)) return false;
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">
      ${search ? 'No items match your search.' : 'No items yet — add your first stock item.'}
    </div>`;
    return;
  }

  // Group by category
  const byCategory = {};
  filtered.forEach(item => {
    const cat = item.category || 'Uncategorised';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });

  // Update datalist for category autocomplete
  const dl = document.getElementById('stk-category-list');
  if (dl) {
    const cats = [...new Set(stockItems.map(i => i.category).filter(Boolean))];
    dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  }

  el.innerHTML = Object.entries(byCategory).sort(([a],[b]) => a.localeCompare(b)).map(([cat, items]) => `
    <div class="stk-category-header">${cat} <span style="font-weight:400;color:var(--text3);">(${items.length})</span></div>
    ${items.map(item => {
      const supplier = suppliers.find(s => s.id === item.supplier_id);
      return `
        <div class="stk-item-card ${item.archived ? 'archived' : ''}">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
            ${item.barcode ? `<div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace;">${item.barcode}</div>` : ''}
          </div>
          <div style="width:90px;font-size:12px;color:var(--text2);">${item.unit || 'units'}</div>
          <div style="width:80px;font-size:12px;color:var(--text2);font-family:'DM Mono',monospace;">${item.par_level ?? '—'}</div>
          <div style="width:100px;font-size:12px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${supplier?.name || '—'}</div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${item.archived
              ? `<button class="btn btn-ghost btn-sm" style="color:var(--success);font-size:11px;" onclick="unarchiveItem('${item.id}')">Restore</button>`
              : `<button class="btn btn-ghost btn-sm" style="color:var(--text);font-size:11px;" onclick="openItemModal('${item.id}')">Edit</button>
                 <button class="btn btn-ghost btn-sm" style="color:var(--danger);font-size:11px;" onclick="archiveItem('${item.id}')">Archive</button>`
            }
          </div>
        </div>
      `;
    }).join('')}
  `).join('');
}

// ══════════════════════════════════════════════════════
//  CATALOGUE — ITEM MODAL
// ══════════════════════════════════════════════════════

function openItemModal(id) {
  const item = id ? stockItems.find(i => i.id === id) : null;
  document.getElementById('stk-item-modal-title').textContent = item ? 'Edit Stock Item' : 'Add Stock Item';
  document.getElementById('stk-item-edit-id').value  = item?.id  || '';
  document.getElementById('stk-item-name').value     = item?.name || '';
  document.getElementById('stk-item-category').value = item?.category || '';
  document.getElementById('stk-item-unit').value     = item?.unit || 'bottles';
  document.getElementById('stk-item-par').value      = item?.par_level ?? '';
  document.getElementById('stk-item-barcode').value  = item?.barcode || '';

  // Populate category datalist
  const dl = document.getElementById('stk-category-list');
  if (dl) {
    const cats = [...new Set(stockItems.map(i => i.category).filter(Boolean))];
    dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
  }

  // Populate supplier dropdown
  const sel = document.getElementById('stk-item-supplier');
  sel.innerHTML = '<option value="">— None —</option>' +
    suppliers.map(s => `<option value="${s.id}" ${item?.supplier_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('');

  document.getElementById('stk-item-modal').classList.add('show');
  document.getElementById('stk-item-name').focus();
}

async function saveStockItem() {
  const name     = document.getElementById('stk-item-name').value.trim();
  const category = document.getElementById('stk-item-category').value.trim();
  const unit     = document.getElementById('stk-item-unit').value;
  const parRaw   = document.getElementById('stk-item-par').value;
  const barcode  = document.getElementById('stk-item-barcode').value.trim();
  const supplier = document.getElementById('stk-item-supplier').value;
  const editId   = document.getElementById('stk-item-edit-id').value;

  if (!name)     { toast('Item name is required'); return; }
  if (!category) { toast('Category is required'); return; }

  const item = {
    id:          editId || uid(),
    name,
    category,
    unit,
    par_level:   parRaw !== '' ? parseFloat(parRaw) : null,
    barcode:     barcode || null,
    supplier_id: supplier || null,
    archived:    false,
    created_at:  editId ? undefined : new Date().toISOString(),
  };
  if (!editId) delete item.created_at;

  await dbSaveStockItem(item);
  closeModal('stk-item-modal');
  renderCatalogue();
  renderStkKpis();

  // Update item count hint
  const hint = document.getElementById('stk-item-count-hint');
  if (hint) hint.textContent = stockItems.filter(i => !i.archived).length + ' active items';

  toast(`${editId ? 'Updated' : 'Added'} "${name}" ✓`);
}

async function archiveItem(id) {
  const item = stockItems.find(i => i.id === id);
  if (!item || !confirm(`Archive "${item.name}"? It won't appear in future counts.`)) return;
  item.archived = true;
  await dbSaveStockItem(item);
  renderCatalogue();
  renderStkKpis();
  toast(`"${item.name}" archived`);
}

async function unarchiveItem(id) {
  const item = stockItems.find(i => i.id === id);
  if (!item) return;
  item.archived = false;
  await dbSaveStockItem(item);
  renderCatalogue();
  renderStkKpis();
  toast(`"${item.name}" restored`);
}

// ══════════════════════════════════════════════════════
//  CATALOGUE — SUPPLIER MODAL
// ══════════════════════════════════════════════════════

function openSupplierModal(id) {
  const s = id ? suppliers.find(s => s.id === id) : null;
  document.getElementById('stk-supplier-modal-title').textContent = s ? 'Edit Supplier' : 'Add Supplier';
  document.getElementById('stk-supplier-edit-id').value   = s?.id      || '';
  document.getElementById('stk-supplier-name').value      = s?.name    || '';
  document.getElementById('stk-supplier-contact').value   = s?.contact_name || '';
  document.getElementById('stk-supplier-phone').value     = s?.phone   || '';
  document.getElementById('stk-supplier-email').value     = s?.email   || '';
  document.getElementById('stk-supplier-notes').value     = s?.notes   || '';
  document.getElementById('stk-supplier-modal').classList.add('show');
  document.getElementById('stk-supplier-name').focus();
}

async function saveSupplier() {
  const name    = document.getElementById('stk-supplier-name').value.trim();
  const contact = document.getElementById('stk-supplier-contact').value.trim();
  const phone   = document.getElementById('stk-supplier-phone').value.trim();
  const email   = document.getElementById('stk-supplier-email').value.trim();
  const notes   = document.getElementById('stk-supplier-notes').value.trim();
  const editId  = document.getElementById('stk-supplier-edit-id').value;

  if (!name) { toast('Supplier name is required'); return; }

  const supplier = {
    id:           editId || uid(),
    name,
    contact_name: contact || null,
    phone:        phone   || null,
    email:        email   || null,
    notes:        notes   || null,
    created_at:   editId ? undefined : new Date().toISOString(),
  };
  if (!editId) delete supplier.created_at;

  await dbSaveSupplier(supplier);
  closeModal('stk-supplier-modal');
  renderSuppliersList();
  toast(`${editId ? 'Updated' : 'Added'} "${name}" ✓`);
}

function renderSuppliersList() {
  const el = document.getElementById('stk-suppliers-list');
  if (!el) return;
  if (!suppliers.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">No suppliers yet.</div>';
    return;
  }
  el.innerHTML = suppliers.map(s => {
    const itemCount = stockItems.filter(i => i.supplier_id === s.id).length;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:500;font-size:13px;">${s.name}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">
            ${s.contact_name ? s.contact_name + ' · ' : ''}${s.phone || s.email || ''}
            ${itemCount > 0 ? `<span style="margin-left:6px;">· ${itemCount} item${itemCount !== 1 ? 's' : ''}</span>` : ''}
          </div>
          ${s.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;font-style:italic;">${s.notes}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" style="color:var(--text);font-size:11px;" onclick="openSupplierModal('${s.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);font-size:11px;" onclick="deleteSupplier('${s.id}')">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteSupplier(id) {
  const s = suppliers.find(s => s.id === id);
  if (!s) return;
  const linked = stockItems.filter(i => i.supplier_id === id).length;
  const msg = linked > 0
    ? `Remove "${s.name}"? This supplier is linked to ${linked} item${linked !== 1 ? 's' : ''} — the link will be removed.`
    : `Remove "${s.name}"?`;
  if (!confirm(msg)) return;

  // Unlink items
  for (const item of stockItems.filter(i => i.supplier_id === id)) {
    item.supplier_id = null;
    await dbSaveStockItem(item);
  }

  await dbDeleteSupplier(id);
  renderSuppliersList();
  renderCatalogue();
  toast(`"${s.name}" removed`);
}

// ══════════════════════════════════════════════════════
//  NEW COUNT TAB
// ══════════════════════════════════════════════════════

function renderNewCountTab() {
  if (_activeSession) {
    document.getElementById('stk-session-start').style.display  = 'none';
    document.getElementById('stk-count-sheet').style.display    = 'block';
    renderCountSheet();
  } else {
    document.getElementById('stk-session-start').style.display  = 'block';
    document.getElementById('stk-count-sheet').style.display    = 'none';
    // Pre-fill today's date
    const dateEl = document.getElementById('stk-session-date');
    if (dateEl && !dateEl.value) {
      dateEl.value = new Date().toISOString().split('T')[0];
    }
    // Update item count hint
    const hint = document.getElementById('stk-item-count-hint');
    if (hint) hint.textContent = stockItems.filter(i => !i.archived).length + ' active items';
  }
}

function startStocktake() {
  const date  = document.getElementById('stk-session-date').value;
  const staff = document.getElementById('stk-session-staff').value.trim();
  const notes = document.getElementById('stk-session-notes').value.trim();

  if (!date)  { toast('Please select a date'); return; }
  if (!staff) { toast('Please enter a staff member name'); return; }

  const activeItems = stockItems.filter(i => !i.archived);
  if (!activeItems.length) {
    toast('No active items in catalogue — add items first');
    return;
  }

  const sessionItems = activeItems.map(item => ({
    item_id:   item.id,
    name:      item.name,
    category:  item.category,
    unit:      item.unit,
    par_level: item.par_level,
    count:     null,   // null = not yet counted
    variance:  null,
    variance_reason: null,
  }));

  _activeSession = {
    id:          uid(),
    date,
    staff_name:  staff,
    notes:       notes || null,
    status:      'draft',
    items:       sessionItems,
    journal_ids: [],
    created_at:  new Date().toISOString(),
  };

  dbSaveStocktakeSession(_activeSession);

  document.getElementById('stk-session-start').style.display = 'none';
  document.getElementById('stk-count-sheet').style.display   = 'block';
  renderCountSheet();

  const newcountTab = document.getElementById('stktab-newcount');
  if (newcountTab) newcountTab.textContent = 'New Count (in progress)';

  toast('Stocktake started — begin counting');
}

function renderCountSheet() {
  if (!_activeSession) return;

  const titleEl    = document.getElementById('stk-count-title');
  const subtitleEl = document.getElementById('stk-count-subtitle');
  if (titleEl)    titleEl.textContent    = 'Stocktake — ' + new Date(_activeSession.date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (subtitleEl) subtitleEl.textContent = 'Staff: ' + _activeSession.staff_name + (_activeSession.notes ? ' · ' + _activeSession.notes : '');

  const container = document.getElementById('stk-count-rows');
  if (!container) return;

  const byCategory = {};
  (_activeSession.items || []).forEach(item => {
    const cat = item.category || 'Uncategorised';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });

  container.innerHTML = Object.entries(byCategory).sort(([a],[b]) => a.localeCompare(b)).map(([cat, items]) => `
    <div class="stk-category-header">${cat}</div>
    ${items.map((item, _i) => {
      const counted = item.count !== null && item.count !== undefined && item.count !== '';
      return `
        <div class="stk-count-row ${counted ? '' : ''}" id="stk-row-${item.item_id}">
          <div>
            <div style="font-size:13px;font-weight:${counted ? '500' : '400'};color:${counted ? 'var(--text)' : 'var(--text2)'};">${item.name}</div>
          </div>
          <span class="stk-unit-col" style="font-size:12px;color:var(--text3);">${item.unit || 'units'}</span>
          <span class="stk-par-col" style="font-size:12px;color:var(--text3);font-family:'DM Mono',monospace;">${item.par_level ?? '—'}</span>
          <input
            type="number"
            min="0"
            step="0.5"
            inputmode="decimal"
            placeholder="0"
            value="${item.count !== null && item.count !== undefined ? item.count : ''}"
            data-item-id="${item.item_id}"
            onchange="updateCountValue('${item.item_id}', this.value)"
            oninput="updateCountProgress()"
            style="text-align:right;"
          >
        </div>
      `;
    }).join('')}
  `).join('');

  updateCountProgress();
}

function updateCountValue(itemId, rawValue) {
  if (!_activeSession) return;
  const item = _activeSession.items.find(i => i.item_id === itemId);
  if (!item) return;
  item.count = rawValue !== '' ? parseFloat(rawValue) : null;
  updateCountProgress();
}

function updateCountProgress() {
  if (!_activeSession) return;
  const items   = _activeSession.items || [];
  const counted = items.filter(i => i.count !== null && i.count !== undefined && i.count !== '').length;
  const total   = items.length;
  const pct     = total > 0 ? Math.round((counted / total) * 100) : 0;

  const labelEl = document.getElementById('stk-progress-label');
  const pctEl   = document.getElementById('stk-progress-pct');
  const barEl   = document.getElementById('stk-progress-bar');

  if (labelEl) labelEl.textContent = `${counted} of ${total} items counted`;
  if (pctEl)   pctEl.textContent   = `${pct}%`;
  if (barEl)   barEl.style.width   = `${pct}%`;
}

async function saveCountProgress() {
  if (!_activeSession) return;
  // Read all current input values into the session
  document.querySelectorAll('#stk-count-rows input[data-item-id]').forEach(inp => {
    const item = _activeSession.items.find(i => i.item_id === inp.dataset.itemId);
    if (item) item.count = inp.value !== '' ? parseFloat(inp.value) : null;
  });
  await dbSaveStocktakeSession(_activeSession);
  toast('Progress saved ✓');
}

// ══════════════════════════════════════════════════════
//  SUBMIT FLOW
// ══════════════════════════════════════════════════════

function confirmSubmitStocktake() {
  if (!_activeSession) return;

  // Read all current inputs first
  document.querySelectorAll('#stk-count-rows input[data-item-id]').forEach(inp => {
    const item = _activeSession.items.find(i => i.item_id === inp.dataset.itemId);
    if (item) item.count = inp.value !== '' ? parseFloat(inp.value) : null;
  });

  // Calculate variances
  const items      = _activeSession.items || [];
  const counted    = items.filter(i => i.count !== null).length;
  const uncounted  = items.filter(i => i.count === null).length;
  const belowPar   = items.filter(i => i.count !== null && i.par_level !== null && i.count < i.par_level).length;
  const abovePar   = items.filter(i => i.count !== null && i.par_level !== null && i.count > i.par_level).length;
  const zeroStock  = items.filter(i => i.count !== null && i.count === 0).length;

  const summaryEl = document.getElementById('stk-submit-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;">
        <span style="color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Counted</span>
        <span style="font-weight:600;">${counted} of ${items.length} items</span>
        ${uncounted > 0 ? `<span style="color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Uncounted</span>
        <span style="color:var(--danger);font-weight:600;">${uncounted} items (will be recorded as no count)</span>` : ''}
        <span style="color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Below Par</span>
        <span style="color:${belowPar > 0 ? 'var(--danger)' : 'var(--success)'};">${belowPar} items</span>
        <span style="color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Above Par</span>
        <span style="color:var(--success);">${abovePar} items</span>
        <span style="color:var(--text3);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Zero Stock</span>
        <span style="color:${zeroStock > 0 ? 'var(--danger)' : 'var(--text)'};">${zeroStock} items</span>
      </div>
    `;
  }

  document.getElementById('stk-submit-confirm-modal').classList.add('show');
}

function openVarianceReasonModal() {
  closeModal('stk-submit-confirm-modal');
  if (!_activeSession) return;

  const items = _activeSession.items || [];

  // Calculate variance per item
  items.forEach(item => {
    if (item.count !== null && item.par_level !== null) {
      item.variance = +(item.count - item.par_level).toFixed(3);
    } else {
      item.variance = null;
    }
  });

  // Only negative variances need reasons
  const negItems = items.filter(i => i.variance !== null && i.variance < 0);

  if (!negItems.length) {
    // No negative variances — go straight to finalise
    finaliseStocktake();
    return;
  }

  const container = document.getElementById('stk-variance-reason-rows');
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 80px 80px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:8px;">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Item</span>
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Par</span>
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Count</span>
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Reason</span>
    </div>
    ${negItems.map(item => `
      <div style="display:grid;grid-template-columns:1fr 80px 80px 1fr;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;font-weight:500;">${item.name}</div>
          <div style="font-size:11px;color:var(--text3);">${item.category}</div>
        </div>
        <span style="font-size:13px;font-family:'DM Mono',monospace;">${item.par_level}</span>
        <span style="font-size:13px;font-family:'DM Mono',monospace;color:var(--danger);">${item.count} <span style="font-size:11px;">(${item.variance > 0 ? '+' : ''}${item.variance})</span></span>
        <select data-item-id="${item.item_id}"
          style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;background:var(--bg);color:var(--text);">
          <option value="">Select reason…</option>
          <option value="shrinkage">Shrinkage (theft/loss)</option>
          <option value="wastage">Wastage (spoilage/breakage)</option>
          <option value="unaccounted">Unaccounted</option>
          <option value="data_entry">Data entry error</option>
          <option value="received">Stock received — not entered</option>
        </select>
      </div>
    `).join('')}
  `;

  document.getElementById('stk-variance-modal-error').style.display = 'none';
  document.getElementById('stk-variance-modal').classList.add('show');
}

async function finaliseStocktake() {
  if (!_activeSession) return;

  // Collect variance reasons from modal (if open)
  const reasonSelects = document.querySelectorAll('#stk-variance-reason-rows select[data-item-id]');
  let allReasonsSet = true;
  reasonSelects.forEach(sel => {
    if (!sel.value) { allReasonsSet = false; return; }
    const item = _activeSession.items.find(i => i.item_id === sel.dataset.itemId);
    if (item) item.variance_reason = sel.value;
  });

  if (!allReasonsSet) {
    const errEl = document.getElementById('stk-variance-modal-error');
    if (errEl) { errEl.textContent = 'Please select a reason for all negative variances.'; errEl.style.display = 'block'; }
    return;
  }

  closeModal('stk-variance-modal');

  // Recalculate all variances with final values
  const items = _activeSession.items || [];
  items.forEach(item => {
    if (item.count !== null && item.par_level !== null) {
      item.variance = +(item.count - item.par_level).toFixed(3);
    }
  });

  // Post journal entries
  const journalIds = await postStocktakeJournals(_activeSession);

  // Finalise session
  _activeSession.status       = 'submitted';
  _activeSession.submitted_at = new Date().toISOString();
  _activeSession.journal_ids  = journalIds;

  await dbSaveStocktakeSession(_activeSession);

  // Update the journals in app state
  if (typeof renderAll === 'function') renderAll();

  const session   = _activeSession;
  _activeSession  = null;

  // Reset new count tab label
  const newcountTab = document.getElementById('stktab-newcount');
  if (newcountTab) newcountTab.textContent = 'New Count';

  // Reset start form
  const dateEl  = document.getElementById('stk-session-date');
  const staffEl = document.getElementById('stk-session-staff');
  const notesEl = document.getElementById('stk-session-notes');
  if (dateEl)  dateEl.value  = '';
  if (staffEl) staffEl.value = '';
  if (notesEl) notesEl.value = '';

  document.getElementById('stk-session-start').style.display = 'block';
  document.getElementById('stk-count-sheet').style.display   = 'none';

  showStocktakeTab('history');
  toast('Stocktake submitted ✓ Journals posted');
}

// ══════════════════════════════════════════════════════
//  JOURNAL POSTING
//  Variance accounting:
//    Negative (below par):
//      DR 5120 Cost of Goods Sold   (loss value — no $ value, qty-based note)
//      CR 1100 Inventory
//    Positive variances are informational only (no journal — receiving stock
//    is a separate purchase entry). We record zero-variance items too for
//    completeness in the narration.
//
//  Since we have quantities but not unit costs, we post $0.01 placeholder
//  journals for variance tracking. Users can edit the $ amount manually
//  in the journal entry view once unit costs are known.
//  The narration carries the full detail.
// ══════════════════════════════════════════════════════

async function postStocktakeJournals(session) {
  const journalIds   = [];
  const date         = session.date;
  const ref          = 'STK-' + session.id.slice(0, 6).toUpperCase();

  const negItems  = (session.items || []).filter(i => i.variance !== null && i.variance < 0 && i.count !== null);
  const zeroItems = (session.items || []).filter(i => i.count !== null && i.count === 0);

  if (!negItems.length && !zeroItems.length) return journalIds;

  // Group by variance reason for cleaner journals
  const byReason = {};
  negItems.forEach(item => {
    const reason = item.variance_reason || 'unaccounted';
    if (!byReason[reason]) byReason[reason] = [];
    byReason[reason].push(item);
  });

  const reasonLabels = {
    shrinkage:   'Shrinkage (Theft / Loss)',
    wastage:     'Wastage (Spoilage / Breakage)',
    unaccounted: 'Unaccounted Variance',
    data_entry:  'Data Entry Correction',
    received:    'Stock Received — Not Entered',
  };

  for (const [reason, items] of Object.entries(byReason)) {
    const narration = `Stocktake ${date} (${session.staff_name}) — ${reasonLabels[reason] || reason}:\n` +
      items.map(i => `  ${i.name}: counted ${i.count} ${i.unit}, par ${i.par_level}, variance ${i.variance}`).join('\n');

    // One consolidated journal per reason type
    // Amount = $0.01 placeholder per item — user updates with actual unit cost
    const totalPlaceholder = +(items.length * 0.01).toFixed(2);

    const lines = [
      { account: '5120', debit: totalPlaceholder, credit: 0,                 narration: reasonLabels[reason] || reason },
      { account: '1100', debit: 0,                credit: totalPlaceholder,  narration: 'Inventory adjustment' },
    ];

    const journal = {
      id:         uid(),
      date,
      ref:        ref + '-' + reason.slice(0, 3).toUpperCase(),
      narration,
      source:     'stocktake',
      session_id: session.id,
      lines:      lines.map((l, i) => ({ ...l, id: uid(), sort_order: i })),
    };

    journals.unshift(journal);
    if (typeof dbSaveJournal === 'function') await dbSaveJournal(journal);
    journalIds.push(journal.id);
  }

  return journalIds;
}

// ══════════════════════════════════════════════════════
//  VOID SESSION
// ══════════════════════════════════════════════════════

async function voidSession() {
  if (!_viewingSession) return;
  if (_viewingSession.status === 'voided') { toast('Session is already voided'); return; }

  if (!confirm('Void this stocktake session? This will reverse all journal entries created on submission.')) return;

  // Reverse journal entries
  if (_viewingSession.journal_ids?.length) {
    for (const jid of _viewingSession.journal_ids) {
      const original = journals.find(j => j.id === jid);
      if (!original) continue;

      // Create reversing journal
      const reversal = {
        id:       uid(),
        date:     new Date().toISOString().split('T')[0],
        ref:      'VOID-' + original.ref,
        narration: 'REVERSAL — ' + original.narration,
        source:   'stocktake-void',
        lines:    (original.lines || []).map((l, i) => ({
          ...l,
          id:          uid(),
          sort_order:  i,
          debit:       l.credit,  // swap
          credit:      l.debit,
        })),
      };

      journals.unshift(reversal);
      if (typeof dbSaveJournal === 'function') await dbSaveJournal(reversal);
    }
  }

  _viewingSession.status    = 'voided';
  _viewingSession.voided_at = new Date().toISOString();
  await dbSaveStocktakeSession(_viewingSession);

  closeModal('stk-session-detail-modal');
  renderSessionHistory();
  renderStkKpis();
  if (typeof renderAll === 'function') renderAll();
  toast('Session voided — journals reversed');
}

// ══════════════════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════════════════

function renderSessionHistory() {
  const el = document.getElementById('stk-session-list');
  if (!el) return;

  const sessions = stocktakeSessions.filter(s => s.status !== 'draft');
  if (!sessions.length) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">No submitted stocktakes yet.</div>`;
    return;
  }

  el.innerHTML = sessions.map(s => {
    const items     = s.items || [];
    const counted   = items.filter(i => i.count !== null).length;
    const belowPar  = items.filter(i => i.variance !== null && i.variance < 0).length;
    const statusLabel = { submitted: 'Submitted', voided: 'Voided', draft: 'Draft' };
    const statusClass = { submitted: 'stk-status-submitted', voided: 'stk-status-voided', draft: 'stk-status-draft' };
    return `
      <div class="stk-session-row" onclick="viewSession('${s.id}')">
        <div>
          <div style="font-weight:600;font-size:13px;">
            ${new Date(s.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <div style="font-size:12px;color:var(--text3);margin-top:3px;">
            ${s.staff_name}${s.notes ? ' · ' + s.notes : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-shrink:0;">
          <div style="text-align:right;font-size:12px;color:var(--text3);">
            <div>${counted} item${counted !== 1 ? 's' : ''} counted</div>
            ${belowPar > 0 ? `<div style="color:var(--danger);">${belowPar} below par</div>` : '<div style="color:var(--success);">All at par</div>'}
          </div>
          <span class="badge ${statusClass[s.status] || 'stk-status-submitted'}">${statusLabel[s.status] || s.status}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text3);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    `;
  }).join('');
}

function viewSession(id) {
  const session = stocktakeSessions.find(s => s.id === id);
  if (!session) return;
  _viewingSession = session;

  const items    = session.items || [];
  const counted  = items.filter(i => i.count !== null).length;
  const belowPar = items.filter(i => i.variance !== null && i.variance < 0).length;
  const abovePar = items.filter(i => i.variance !== null && i.variance > 0).length;
  const zeroStock= items.filter(i => i.count !== null && i.count === 0).length;

  document.getElementById('stk-detail-title').textContent =
    'Stocktake — ' + new Date(session.date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('stk-detail-subtitle').textContent =
    'Staff: ' + session.staff_name + (session.notes ? ' · ' + session.notes : '') +
    ' · Status: ' + (session.status.charAt(0).toUpperCase() + session.status.slice(1));

  // KPIs
  document.getElementById('stk-detail-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Items Counted</div><div class="kpi-value">${counted}</div><div class="kpi-sub">of ${items.length} total</div></div>
    <div class="kpi"><div class="kpi-label">Below Par</div><div class="kpi-value ${belowPar > 0 ? 'negative' : ''}">${belowPar}</div><div class="kpi-sub">items with shortage</div></div>
    <div class="kpi"><div class="kpi-label">Above Par</div><div class="kpi-value ${abovePar > 0 ? 'positive' : ''}">${abovePar}</div><div class="kpi-sub">items with surplus</div></div>
    <div class="kpi"><div class="kpi-label">Zero Stock</div><div class="kpi-value ${zeroStock > 0 ? 'negative' : ''}">${zeroStock}</div><div class="kpi-sub">empty items</div></div>
  `;

  // Show/hide void button
  const voidBtn = document.getElementById('stk-void-btn');
  if (voidBtn) voidBtn.style.display = session.status === 'submitted' ? 'inline-flex' : 'none';

  // Variance table
  const byCategory = {};
  items.forEach(item => {
    const cat = item.category || 'Uncategorised';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });

  const tableHtml = `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:12px;">Variance Report</div>
    ${Object.entries(byCategory).sort(([a],[b]) => a.localeCompare(b)).map(([cat, catItems]) => `
      <div class="stk-category-header">${cat}</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;margin-bottom:16px;overflow:hidden;">
        <div style="display:grid;grid-template-columns:1fr 70px 70px 80px 80px 1fr;gap:8px;padding:8px 14px;background:var(--surface2);border-bottom:1px solid var(--border);">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Item</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Unit</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Par</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Count</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Variance</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Reason</span>
        </div>
        ${catItems.map(item => {
          const v    = item.variance;
          let badgeCls, badgeText;
          if (item.count === null) {
            badgeCls = ''; badgeText = '—';
          } else if (item.count === 0) {
            badgeCls = 'stk-variance-zero'; badgeText = 'Zero Stock';
          } else if (v === null) {
            badgeCls = ''; badgeText = 'No par set';
          } else if (v < 0) {
            badgeCls = 'stk-variance-under'; badgeText = String(v);
          } else if (v === 0) {
            badgeCls = 'stk-variance-ok'; badgeText = 'On par';
          } else {
            badgeCls = 'stk-variance-over'; badgeText = '+' + v;
          }
          const reasonLabels = {
            shrinkage: 'Shrinkage', wastage: 'Wastage', unaccounted: 'Unaccounted',
            data_entry: 'Data Entry', received: 'Stock Received',
          };
          return `
            <div style="display:grid;grid-template-columns:1fr 70px 70px 80px 80px 1fr;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);">
              <div style="font-size:13px;font-weight:500;">${item.name}</div>
              <div style="font-size:12px;color:var(--text3);">${item.unit || '—'}</div>
              <div style="font-size:13px;font-family:'DM Mono',monospace;">${item.par_level ?? '—'}</div>
              <div style="font-size:13px;font-family:'DM Mono',monospace;">${item.count !== null ? item.count : '—'}</div>
              <div>
                ${badgeCls ? `<span class="stk-variance-badge ${badgeCls}">${badgeText}</span>` : `<span style="font-size:12px;color:var(--text3);">${badgeText}</span>`}
              </div>
              <div style="font-size:12px;color:var(--text3);">${item.variance_reason ? (reasonLabels[item.variance_reason] || item.variance_reason) : '—'}</div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('')}
  `;

  document.getElementById('stk-detail-table').innerHTML = tableHtml;
  document.getElementById('stk-session-detail-modal').classList.add('show');
}

// ══════════════════════════════════════════════════════
//  CSV EXPORT
// ══════════════════════════════════════════════════════

function exportVariancesCSV() {
  const session = _viewingSession;
  if (!session) return;

  const rows   = [['Item', 'Category', 'Unit', 'Par Level', 'Count', 'Variance', 'Status', 'Reason']];
  const items  = session.items || [];
  const reasonLabels = {
    shrinkage: 'Shrinkage', wastage: 'Wastage', unaccounted: 'Unaccounted',
    data_entry: 'Data Entry', received: 'Stock Received',
  };

  // Sort by category then name
  [...items].sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || '')).forEach(item => {
    let status;
    if (item.count === null)        status = 'Not Counted';
    else if (item.count === 0)      status = 'Zero Stock';
    else if (item.variance === null) status = 'No Par Set';
    else if (item.variance < 0)     status = 'Below Par';
    else if (item.variance === 0)   status = 'On Par';
    else                            status = 'Above Par';

    rows.push([
      item.name,
      item.category || '',
      item.unit || '',
      item.par_level !== null ? item.par_level : '',
      item.count     !== null ? item.count     : '',
      item.variance  !== null ? item.variance  : '',
      status,
      item.variance_reason ? (reasonLabels[item.variance_reason] || item.variance_reason) : '',
    ]);
  });

  const dateStr   = session.date.replace(/-/g, '');
  const filename  = `stocktake_${dateStr}_${session.staff_name.replace(/\s+/g, '_')}.csv`;
  const csv       = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob      = new Blob([csv], { type: 'text/csv' });
  const url       = URL.createObjectURL(blob);
  const a         = document.createElement('a');
  a.href          = url;
  a.download      = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported ✓');
}

// ══════════════════════════════════════════════════════
//  BARCODE SCANNER
// ══════════════════════════════════════════════════════

async function startBarcodeScanner() {
  if (!_activeSession) { toast('Start a stocktake count first'); return; }

  // Check browser support
  if (!('BarcodeDetector' in window)) {
    toast('Barcode scanning requires Chrome on Android or Safari on iOS 17+. Enter barcodes manually in Item Catalogue.');
    return;
  }

  try {
    _scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
  } catch (e) {
    toast('Camera access denied — please allow camera permission in your browser settings');
    return;
  }

  const video = document.getElementById('stk-scanner-video');
  video.srcObject = _scannerStream;
  await video.play();

  document.getElementById('stk-scanner-overlay').style.display = 'flex';
  document.getElementById('stk-scanner-status').textContent = 'Ready — point camera at barcode';

  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] });

  _scannerInterval = setInterval(async () => {
    if (!video.readyState || video.readyState < 2) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        const raw = barcodes[0].rawValue;
        stopBarcodeScanner();
        onBarcodeDetected(raw);
      }
    } catch (e) {
      // Detection error — continue polling
    }
  }, 200);
}

function stopBarcodeScanner() {
  if (_scannerInterval) { clearInterval(_scannerInterval); _scannerInterval = null; }
  if (_scannerStream)   { _scannerStream.getTracks().forEach(t => t.stop()); _scannerStream = null; }
  const video = document.getElementById('stk-scanner-video');
  if (video) video.srcObject = null;
  document.getElementById('stk-scanner-overlay').style.display = 'none';
}

function onBarcodeDetected(barcode) {
  if (!_activeSession) return;

  // Find matching item in catalogue by barcode
  const item = stockItems.find(i => i.barcode === barcode && !i.archived);
  if (!item) {
    toast(`Barcode ${barcode} not found in catalogue — add barcode to item first`);
    return;
  }

  // Find session item
  const sessionItem = _activeSession.items.find(i => i.item_id === item.id);
  if (!sessionItem) {
    toast(`Item "${item.name}" is not in this count session`);
    return;
  }

  // Scroll to and highlight the matching row
  const row = document.getElementById(`stk-row-${item.id}`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('highlighted');
    const inp = row.querySelector('input[type=number]');
    if (inp) inp.focus();
    setTimeout(() => row.classList.remove('highlighted'), 2000);
    toast(`Found: ${item.name} — enter count`);
  }
}

// ══════════════════════════════════════════════════════
//  UTILITY — shared closeModal helper (mirrors pattern
//  already used by other modules)
// ══════════════════════════════════════════════════════

// closeModal is already defined in app.js — this file relies on it.
// Guard in case this file loads before app.js in some environments.
if (typeof closeModal === 'undefined') {
  window.closeModal = function(id) {
    document.getElementById(id)?.classList.remove('show');
  };
}

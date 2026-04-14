/* ══════════════════════════════════════════════════════
   Tayla Business — Ordering Module
   ordering.js

   Procurement and purchase order system.
   Closes the loop: stocktake variance → suggested order
   → PO → goods received → draft bill → P&L updated.
══════════════════════════════════════════════════════ */

// ── State
let purchaseOrders  = [];
let standingOrders  = [];
let _viewingPO      = null;   // PO open in detail modal
let _poLineCount    = 0;
let _standingLineCount = 0;

// ══════════════════════════════════════════════════════
//  SUPABASE — PURCHASE ORDERS
// ══════════════════════════════════════════════════════

async function dbLoadPurchaseOrders() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('purchase_orders')
    .select('*')
    .eq('business_id', _businessId)
    .order('date', { ascending: false });
  if (error) { console.error('Load POs failed:', error); return; }
  purchaseOrders = (data || []).map(po => ({
    ...po,
    lines:    typeof po.lines    === 'string' ? JSON.parse(po.lines)    : (po.lines    || []),
    receipts: typeof po.receipts === 'string' ? JSON.parse(po.receipts) : (po.receipts || []),
    returns:  typeof po.returns  === 'string' ? JSON.parse(po.returns)  : (po.returns  || []),
  }));
}

async function dbSavePurchaseOrder(po) {
  const idx = purchaseOrders.findIndex(p => p.id === po.id);
  if (idx >= 0) purchaseOrders[idx] = po; else purchaseOrders.unshift(po);
  if (!_businessId) return;
  const row = {
    ...po,
    lines:       JSON.stringify(po.lines    || []),
    receipts:    JSON.stringify(po.receipts || []),
    returns:     JSON.stringify(po.returns  || []),
    business_id: _businessId,
  };
  const { error } = await _supabase
    .from('purchase_orders')
    .upsert(row, { onConflict: 'id' });
  if (error) { console.error('Save PO failed:', error); toast('Failed to save PO: ' + error.message); }
}

async function dbDeletePurchaseOrder(id) {
  purchaseOrders = purchaseOrders.filter(p => p.id !== id);
  if (!_businessId) return;
  await _supabase.from('purchase_orders').delete().eq('id', id).eq('business_id', _businessId);
}

// ══════════════════════════════════════════════════════
//  SUPABASE — STANDING ORDERS
// ══════════════════════════════════════════════════════

async function dbLoadStandingOrders() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('standing_orders')
    .select('*')
    .eq('business_id', _businessId)
    .order('name');
  if (error) { console.error('Load standing orders failed:', error); return; }
  standingOrders = (data || []).map(so => ({
    ...so,
    lines: typeof so.lines === 'string' ? JSON.parse(so.lines) : (so.lines || []),
  }));
}

async function dbSaveStandingOrder(so) {
  const idx = standingOrders.findIndex(s => s.id === so.id);
  if (idx >= 0) standingOrders[idx] = so; else standingOrders.push(so);
  if (!_businessId) return;
  const row = {
    ...so,
    lines:       JSON.stringify(so.lines || []),
    business_id: _businessId,
  };
  const { error } = await _supabase
    .from('standing_orders')
    .upsert(row, { onConflict: 'id' });
  if (error) { console.error('Save standing order failed:', error); toast('Failed to save standing order: ' + error.message); }
}

async function dbDeleteStandingOrder(id) {
  standingOrders = standingOrders.filter(s => s.id !== id);
  if (!_businessId) return;
  await _supabase.from('standing_orders').delete().eq('id', id).eq('business_id', _businessId);
}

// ══════════════════════════════════════════════════════
//  TAB NAVIGATION
// ══════════════════════════════════════════════════════

function showOrderingTab(tab) {
  ['suggested','orders','standing','analytics'].forEach(t => {
    const panel = document.getElementById(`ord-${t}`);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`ordtab-${t}`);
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--text2)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
    }
  });
  if (tab === 'suggested')  { renderSuggestedOrders(); renderOrdKpis(); }
  if (tab === 'orders')     { renderPOList(); renderOrdKpis(); }
  if (tab === 'standing')   { renderStandingList(); }
  if (tab === 'analytics')  { renderAnalytics(); }
}

// ══════════════════════════════════════════════════════
//  KPI STRIP
// ══════════════════════════════════════════════════════

function renderOrdKpis() {
  const strip = document.getElementById('ord-kpi-strip');
  if (!strip) return;

  const open       = purchaseOrders.filter(p => ['draft','sent','partial'].includes(p.status));
  const totalOpen  = open.reduce((s, p) => s + (p.total || 0), 0);
  const sentCount  = purchaseOrders.filter(p => p.status === 'sent').length;
  const activeStanding = standingOrders.filter(s => s.active).length;

  // Spend in last 30 days from received POs
  const thirtyAgo  = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const recentSpend = purchaseOrders
    .filter(p => p.status === 'received' && p.received_at && new Date(p.received_at) >= thirtyAgo)
    .reduce((s, p) => s + (p.total || 0), 0);

  strip.innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Open Orders Value</div>
      <div class="kpi-value">${fmt(totalOpen)}</div>
      <div class="kpi-sub">${open.length} open PO${open.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Awaiting Delivery</div>
      <div class="kpi-value">${sentCount}</div>
      <div class="kpi-sub">PO${sentCount !== 1 ? 's' : ''} sent to suppliers</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Standing Orders</div>
      <div class="kpi-value">${activeStanding}</div>
      <div class="kpi-sub">active recurring template${activeStanding !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Spend (30 days)</div>
      <div class="kpi-value">${fmt(recentSpend)}</div>
      <div class="kpi-sub">received goods</div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  SUGGESTED ORDERS
// ══════════════════════════════════════════════════════

function refreshSuggestedOrders() {
  renderSuggestedOrders();
  toast('Suggested orders refreshed');
}

function renderSuggestedOrders() {
  const sourceEl = document.getElementById('ord-suggested-source');
  const listEl   = document.getElementById('ord-suggested-list');
  if (!listEl) return;

  const allItems = typeof stockItems !== 'undefined' ? stockItems : [];
  const allSuppliers = typeof suppliers !== 'undefined' ? suppliers : [];

  // Trigger: on_hand is at or below par level (and item is active)
  const needsOrdering = allItems.filter(i =>
    !i.archived &&
    i.par_level !== null &&
    i.on_hand   !== null &&
    i.on_hand   <= i.par_level
  );

  const itemsMissingData = allItems.filter(i =>
    !i.archived &&
    i.par_level !== null &&
    i.on_hand   === null
  );

  if (sourceEl) {
    const total = allItems.filter(i => !i.archived && i.par_level !== null).length;
    sourceEl.textContent = `${needsOrdering.length} of ${total} items at or below par level`;
  }

  if (!needsOrdering.length && !itemsMissingData.length) {
    listEl.innerHTML = `<div class="card"><div class="card-body" style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">
      All items are above par level — no orders needed right now.
    </div></div>`;
    return;
  }

  // Group by supplier
  const bySupplier = {};
  const noSupplier = [];

  needsOrdering.forEach(item => {
    const orderQty = +(item.par_level - item.on_hand).toFixed(3);
    const enriched = {
      item_id:     item.id,
      name:        item.name,
      category:    item.category,
      unit:        item.unit,
      par_level:   item.par_level,
      on_hand:     item.on_hand,
      unit_cost:   item.unit_cost ?? null,
      upt:         item.upt ?? null,
      supplier_id: item.supplier_id || null,
      suggested_qty: orderQty,
      order_qty:     orderQty,
    };
    if (item.supplier_id) {
      if (!bySupplier[item.supplier_id]) bySupplier[item.supplier_id] = [];
      bySupplier[item.supplier_id].push(enriched);
    } else {
      noSupplier.push(enriched);
    }
  });

  window._suggestedGroups      = bySupplier;
  window._suggestedNoSupplier  = noSupplier;

  let html = '';

  Object.entries(bySupplier).forEach(([supplierId, items]) => {
    const supplier = allSuppliers.find(s => s.id === supplierId);
    html += `
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header flex-between">
          <div>
            <div class="card-title" style="font-size:16px;">${supplier?.name || 'Unknown Supplier'}</div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px;">
              ${supplier?.lead_time_days ? `<span class="text-sm">Lead time: ${supplier.lead_time_days} day${supplier.lead_time_days !== 1 ? 's' : ''}</span>` : ''}
              ${supplier?.payment_terms  ? `<span class="text-sm">Terms: ${supplier.payment_terms}</span>` : ''}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="generatePOFromSuggestion('${supplierId}')">Generate PO</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 80px 80px 80px 100px 100px;gap:8px;padding:8px 20px;background:var(--surface2);border-bottom:1px solid var(--border);">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Item</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">On Hand</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Par</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">UPT</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Order Qty</span>
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Est. Cost</span>
        </div>
        ${items.map((item, idx) => `
          <div style="display:grid;grid-template-columns:1fr 80px 80px 80px 100px 100px;gap:8px;align-items:center;padding:10px 20px;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-size:13px;font-weight:500;">${item.name}</div>
              <div style="font-size:11px;color:var(--text3);">${item.category} · ${item.unit || 'units'}</div>
            </div>
            <span style="font-size:13px;font-family:'DM Mono',monospace;color:var(--danger);">${item.on_hand}</span>
            <span style="font-size:13px;font-family:'DM Mono',monospace;">${item.par_level}</span>
            <span style="font-size:12px;font-family:'DM Mono',monospace;color:var(--text3);">${item.upt != null ? item.upt : '—'}</span>
            <input type="number" min="0.01" step="0.01"
              value="${item.order_qty}"
              data-supplier="${supplierId}"
              data-idx="${idx}"
              onchange="updateSuggestedQty('${supplierId}', ${idx}, this.value)"
              style="padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-family:'DM Mono',monospace;background:var(--bg);text-align:right;width:100%;">
            <span style="font-size:13px;font-family:'DM Mono',monospace;color:var(--text2);" id="sugg-cost-${supplierId}-${idx}">
              ${item.unit_cost != null ? fmt(item.unit_cost * item.order_qty) : '—'}
            </span>
          </div>
        `).join('')}
        <div style="padding:12px 20px;display:flex;justify-content:flex-end;gap:8px;background:var(--surface2);">
          <span style="font-size:13px;color:var(--text2);">Est. Total:</span>
          <span style="font-size:13px;font-weight:600;font-family:'DM Mono',monospace;" id="sugg-total-${supplierId}">
            ${calcSuggestionTotal(items)}
          </span>
        </div>
      </div>
    `;
  });

  // Items with no supplier
  if (noSupplier.length) {
    html += `
      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--accent2);">
        <div class="card-header">
          <div>
            <div class="card-title" style="font-size:16px;">No Supplier Assigned</div>
            <div class="text-sm">Assign a supplier to these items in the Stocktake catalogue to include them in POs</div>
          </div>
        </div>
        ${noSupplier.map(item => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-size:13px;font-weight:500;">${item.name}</div>
              <div style="font-size:11px;color:var(--text3);">${item.category}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;color:var(--danger);font-family:'DM Mono',monospace;">
                On hand: ${item.on_hand} / Par: ${item.par_level}
              </div>
              <div style="font-size:11px;color:var(--text3);">Need ${item.suggested_qty} ${item.unit || 'units'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Items with par set but no on_hand recorded yet
  if (itemsMissingData.length) {
    html += `
      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--border);">
        <div class="card-header">
          <div>
            <div class="card-title" style="font-size:16px;color:var(--text3);">On-Hand Not Set</div>
            <div class="text-sm">These items have a par level but no on-hand count — update via stocktake or item catalogue</div>
          </div>
        </div>
        ${itemsMissingData.map(item => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid var(--border);opacity:.6;">
            <div style="font-size:13px;">${item.name}</div>
            <div style="font-size:12px;color:var(--text3);">Par: ${item.par_level} · On hand: not set</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  listEl.innerHTML = html;
}

function calcSuggestionTotal(items) {
  const total = items.reduce((s, i) => {
    return s + (i.unit_cost != null ? i.unit_cost * (i.order_qty || i.suggested_qty) : 0);
  }, 0);
  return total > 0 ? fmt(total) : '—';
}

function updateSuggestedQty(supplierId, idx, newVal) {
  if (!window._suggestedGroups?.[supplierId]) return;
  const item  = window._suggestedGroups[supplierId][idx];
  if (!item) return;
  item.order_qty = parseFloat(newVal) || 0;

  // Update cost cell
  const costEl  = document.getElementById(`sugg-cost-${supplierId}-${idx}`);
  if (costEl) costEl.textContent = item.unit_cost != null ? fmt(item.unit_cost * item.order_qty) : '—';

  // Update group total
  const totalEl = document.getElementById(`sugg-total-${supplierId}`);
  if (totalEl) totalEl.textContent = calcSuggestionTotal(window._suggestedGroups[supplierId]);
}

async function generatePOFromSuggestion(supplierId) {
  const items    = window._suggestedGroups?.[supplierId];
  if (!items?.length) return;
  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === supplierId);

  const lines = items.filter(i => i.order_qty > 0).map(i => ({
    id:          uid(),
    description: i.name,
    unit:        i.unit || 'units',
    qty:         i.order_qty,
    unit_cost:   i.unit_cost || 0,
    subtotal:    +((i.order_qty) * (i.unit_cost || 0)).toFixed(2),
    gst_amount:  0,
    stock_item_id: i.item_id,
  }));

  if (!lines.length) { toast('No lines with quantity > 0'); return; }

  const today    = new Date().toISOString().split('T')[0];
  const expected = supplier?.lead_time_days
    ? (() => { const d = new Date(); d.setDate(d.getDate() + supplier.lead_time_days); return d.toISOString().split('T')[0]; })()
    : '';

  const po = buildPOObject({
    supplier_id:   supplierId,
    date:          today,
    expected_date: expected,
    notes:         'Generated from stocktake suggested orders',
    lines,
    status:        'draft',
  });

  await dbSavePurchaseOrder(po);
  renderPOList();
  renderOrdKpis();
  toast(`PO ${po.po_number} created for ${supplier?.name || 'supplier'} ✓`);
  // Switch to orders tab to show the new PO
  showOrderingTab('orders');
}

async function confirmAllSuggestedOrders() {
  const groups = window._suggestedGroups || {};
  if (!Object.keys(groups).length) { toast('No suggested orders to generate'); return; }
  let count = 0;
  for (const supplierId of Object.keys(groups)) {
    await generatePOFromSuggestion(supplierId);
    count++;
  }
  toast(`${count} PO${count !== 1 ? 's' : ''} generated ✓`);
}

// ══════════════════════════════════════════════════════
//  PURCHASE ORDERS — LIST
// ══════════════════════════════════════════════════════

function renderPOList() {
  const el     = document.getElementById('ord-po-list');
  if (!el) return;
  const search = (document.getElementById('ord-po-search')?.value || '').toLowerCase();
  const filter = document.getElementById('ord-po-filter')?.value || '';

  let list = purchaseOrders.filter(po => {
    if (filter && po.status !== filter) return false;
    if (search) {
      const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id);
      if (!po.po_number?.toLowerCase().includes(search) &&
          !supplier?.name?.toLowerCase().includes(search)) return false;
    }
    return true;
  });

  if (!list.length) {
    el.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">
      ${search || filter ? 'No POs match your filter.' : 'No purchase orders yet.'}
    </div>`;
    return;
  }

  el.innerHTML = list.map(po => {
    const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id);
    const received = (po.receipts || []).reduce((s, r) => s + (r.total || 0), 0);
    const pct      = po.total > 0 ? Math.min(100, Math.round((received / po.total) * 100)) : 0;
    return `
      <div class="ord-po-row" onclick="viewPO('${po.id}')">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-weight:600;font-size:13px;font-family:'DM Mono',monospace;">${po.po_number}</span>
            <span class="badge po-status-${po.status}">${poStatusLabel(po.status)}</span>
          </div>
          <div style="font-size:12px;color:var(--text3);margin-top:3px;">
            ${supplier?.name || 'In-person purchase'} · ${fmtDate(po.date)}
            ${po.expected_date ? ' · Expected ' + fmtDate(po.expected_date) : ''}
          </div>
          ${po.status === 'partial' ? `
            <div style="margin-top:6px;max-width:260px;">
              <div style="height:4px;background:var(--border);border-radius:99px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:var(--accent2);border-radius:99px;"></div>
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px;">${pct}% received</div>
            </div>
          ` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-shrink:0;">
          <div style="text-align:right;">
            <div style="font-size:14px;font-weight:600;font-family:'DM Mono',monospace;">${fmt(po.total)}</div>
            <div style="font-size:11px;color:var(--text3);">${(po.lines||[]).length} line${(po.lines||[]).length !== 1 ? 's' : ''}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text3);flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
    `;
  }).join('');
}

function poStatusLabel(status) {
  return { draft: 'Draft', sent: 'Sent', partial: 'Partial', received: 'Received', closed: 'Closed', voided: 'Voided' }[status] || status;
}

// ══════════════════════════════════════════════════════
//  PURCHASE ORDERS — CREATE / EDIT
// ══════════════════════════════════════════════════════

function buildPOObject({ supplier_id, date, expected_date, notes, lines, status = 'draft', id }) {
  const subtotal  = lines.reduce((s, l) => s + (l.subtotal || 0), 0);
  const gst_total = lines.reduce((s, l) => s + (l.gst_amount || 0), 0);
  const total     = +(subtotal + gst_total).toFixed(2);
  return {
    id:            id || uid(),
    po_number:     nextPONumber(),
    supplier_id,
    date,
    expected_date: expected_date || null,
    notes:         notes || null,
    status,
    lines,
    receipts:      [],
    returns:       [],
    subtotal:      +subtotal.toFixed(2),
    gst_total:     +gst_total.toFixed(2),
    total,
    bill_id:       null,
    created_at:    new Date().toISOString(),
  };
}

function nextPONumber() {
  if (!purchaseOrders.length) return 'PO-001';
  const nums = purchaseOrders
    .map(p => p.po_number?.match(/(\d+)$/)?.[1])
    .filter(Boolean).map(Number);
  return 'PO-' + String(nums.length ? Math.max(...nums) + 1 : 1).padStart(3, '0');
}

function openNewPOModal() {
  document.getElementById('ord-po-modal-title').textContent = 'New Purchase Order';
  document.getElementById('ord-po-edit-id').value   = '';
  document.getElementById('ord-po-number').value    = nextPONumber();
  document.getElementById('ord-po-date').value      = new Date().toISOString().split('T')[0];
  document.getElementById('ord-po-expected').value  = '';
  document.getElementById('ord-po-notes').value     = '';

  // Populate supplier dropdown
  populatePOSupplierDropdown('ord-po-supplier');

  // Reset lines
  _poLineCount = 0;
  document.getElementById('ord-po-lines').innerHTML = '';
  addPOLine();
  updatePOSummary();

  document.getElementById('ord-po-modal').classList.add('show');
  document.getElementById('ord-po-number').focus();
}

function openEditPOModal(poId) {
  const po = purchaseOrders.find(p => p.id === poId);
  if (!po) return;

  document.getElementById('ord-po-modal-title').textContent = 'Edit Purchase Order';
  document.getElementById('ord-po-edit-id').value   = po.id;
  document.getElementById('ord-po-number').value    = po.po_number;
  document.getElementById('ord-po-date').value      = po.date;
  document.getElementById('ord-po-expected').value  = po.expected_date || '';
  document.getElementById('ord-po-notes').value     = po.notes || '';

  populatePOSupplierDropdown('ord-po-supplier', po.supplier_id);

  _poLineCount = 0;
  document.getElementById('ord-po-lines').innerHTML = '';
  (po.lines || []).forEach(l => addPOLine(l));
  updatePOSummary();

  document.getElementById('ord-po-modal').classList.add('show');
}

function populatePOSupplierDropdown(selId, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = '<option value="">No supplier (in-person / cash purchase)</option>' +
    (typeof suppliers !== 'undefined' ? suppliers : []).map(s =>
      `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${s.name}</option>`
    ).join('');
  // Update email button visibility on change
  sel.onchange = () => updatePOModalEmailBtn(sel.value);
  updatePOModalEmailBtn(selectedId || '');
}

function updatePOModalEmailBtn(supplierId) {
  const btn = document.getElementById('ord-po-modal-email-btn');
  if (!btn) return;
  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === supplierId);
  btn.style.display = supplier?.email ? 'inline-flex' : 'none';
}

function addPOLine(line) {
  const idx  = _poLineCount++;
  const desc = line?.description || '';
  const qty  = line?.qty         ?? '';
  const cost = line?.unit_cost   ?? '';

  const container = document.getElementById('ord-po-lines');
  const div = document.createElement('div');
  div.className = 'ord-line-row';
  div.dataset.lineIdx = idx;
  div.innerHTML = `
    <input type="text" placeholder="Item description" value="${desc}"
      style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);"
      oninput="updatePOSummary()">
    <input type="number" min="0" step="0.01" placeholder="0" value="${qty}"
      style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;font-family:'DM Mono',monospace;"
      oninput="updatePOLineCalc(this);updatePOSummary()">
    <input type="number" min="0" step="0.01" placeholder="0.00" value="${cost}"
      style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;font-family:'DM Mono',monospace;"
      oninput="updatePOLineCalc(this);updatePOSummary()">
    <span class="ord-col-total" style="font-size:13px;font-family:'DM Mono',monospace;color:var(--text2);text-align:right;padding-right:4px;">—</span>
    <button class="btn btn-ghost btn-sm" onclick="this.closest('.ord-line-row').remove();updatePOSummary()" style="padding:4px 8px;color:var(--danger);">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  container.appendChild(div);
  if (qty && cost) updatePOLineCalc(div.querySelectorAll('input')[1]);
}

function updatePOLineCalc(input) {
  const row    = input.closest('.ord-line-row');
  if (!row) return;
  const inputs = row.querySelectorAll('input[type=number]');
  const qty    = parseFloat(inputs[0].value) || 0;
  const cost   = parseFloat(inputs[1].value) || 0;
  const sub    = qty * cost;
  const totalEl = row.querySelector('.ord-col-total');
  if (totalEl) totalEl.textContent = sub > 0 ? fmt(sub) : '—';
}

function getPOLines() {
  return Array.from(document.querySelectorAll('#ord-po-lines .ord-line-row')).map(row => {
    const inputs  = row.querySelectorAll('input');
    const gstSel  = row.querySelector('select');
    const desc    = inputs[0].value.trim();
    const qty     = parseFloat(inputs[1].value) || 0;
    const cost    = parseFloat(inputs[2].value) || 0;
    const gst     = null;
    const sub     = +(qty * cost).toFixed(2);
    const gstAmt  = 0; // GST is on the supplier bill, not the PO
    return { id: uid(), description: desc, qty, unit_cost: cost, subtotal: sub, gst_amount: 0 };
  }).filter(l => l.description || l.qty > 0);
}

function updatePOSummary() {
  const lines    = getPOLines();
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  const gst      = lines.reduce((s, l) => s + l.gst_amount, 0);
  const total    = subtotal + gst;
  const el = document.getElementById('ord-po-summary');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px;">
      <span style="color:var(--text2);">Subtotal</span>
      <span class="mono">${fmt(subtotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
      <span style="color:var(--text3);font-size:12px;">GST not included — add on supplier bill when received</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:2px solid var(--text);padding-top:8px;margin-top:4px;">
      <span>Total</span>
      <span class="mono">${fmt(total)}</span>
    </div>
  `;
}

async function savePOAs(status) {
  const editId      = document.getElementById('ord-po-edit-id').value;
  const poNumber    = document.getElementById('ord-po-number').value.trim();
  const supplierId  = document.getElementById('ord-po-supplier').value;
  const date        = document.getElementById('ord-po-date').value;
  const expected    = document.getElementById('ord-po-expected').value;
  const notes       = document.getElementById('ord-po-notes').value.trim();
  const lines       = getPOLines();

  if (!date)         { toast('Date is required'); return; }
  if (!lines.length) { toast('Add at least one line item'); return; }

  const subtotal  = lines.reduce((s, l) => s + l.subtotal,   0);
  const gst_total = 0; // GST excluded from PO — on supplier bill only
  const total     = +subtotal.toFixed(2);

  let po;
  if (editId) {
    // Editing existing PO
    po = purchaseOrders.find(p => p.id === editId);
    if (!po) return;
    po = { ...po, supplier_id: supplierId, date, expected_date: expected || null,
           notes: notes || null, lines, subtotal: +subtotal.toFixed(2), gst_total, total,
           status, updated_at: new Date().toISOString() };
    if (status === 'sent' && !po.sent_at) po.sent_at = new Date().toISOString();
  } else {
    po = {
      id:            uid(),
      po_number:     poNumber || nextPONumber(),
      supplier_id:   supplierId,
      date,
      expected_date: expected || null,
      notes:         notes   || null,
      status,
      lines,
      receipts:      [],
      returns:       [],
      subtotal:      +subtotal.toFixed(2),
      gst_total,
      total,
      bill_id:       null,
      created_at:    new Date().toISOString(),
      sent_at:       status === 'sent' ? new Date().toISOString() : null,
    };
  }

  await dbSavePurchaseOrder(po);
  closeModal('ord-po-modal');
  renderPOList();
  renderOrdKpis();
  toast(`PO ${po.po_number} ${status === 'sent' ? 'sent' : 'saved as draft'} ✓`);
}

// ══════════════════════════════════════════════════════
//  PO DETAIL VIEW
// ══════════════════════════════════════════════════════

function viewPO(id) {
  const po = purchaseOrders.find(p => p.id === id);
  if (!po) return;
  _viewingPO = po;

  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id);

  document.getElementById('ord-detail-title').textContent    = po.po_number;
  document.getElementById('ord-detail-subtitle').textContent =
    (supplier?.name || '—') + ' · ' + fmtDate(po.date) +
    (po.expected_date ? ' · Expected ' + fmtDate(po.expected_date) : '') +
    ' · ' + poStatusLabel(po.status);

  // KPIs
  const totalReceived = (po.receipts || []).reduce((s, r) => s + (r.total || 0), 0);
  const totalReturned = (po.returns  || []).reduce((s, r) => s + (r.credit  || 0), 0);
  document.getElementById('ord-detail-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">PO Total</div><div class="kpi-value">${fmt(po.total)}</div></div>
    <div class="kpi"><div class="kpi-label">Received</div><div class="kpi-value positive">${fmt(totalReceived)}</div></div>
    <div class="kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">${fmt(Math.max(0, po.total - totalReceived))}</div></div>
    <div class="kpi"><div class="kpi-label">Returns</div><div class="kpi-value ${totalReturned > 0 ? 'negative' : ''}">${fmt(totalReturned)}</div></div>
  `;

  // Lines table
  document.getElementById('ord-detail-lines').innerHTML = `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:8px;">Line Items <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3);"> — all amounts ex-GST</span></div>
    <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
      <div style="display:grid;grid-template-columns:1fr 70px 100px 90px;gap:8px;padding:8px 16px;background:var(--surface2);border-bottom:1px solid var(--border);">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Description</span>
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Qty</span>
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Unit Cost</span>
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);">Subtotal</span>
      </div>
      ${(po.lines || []).map(l => `
        <div style="display:grid;grid-template-columns:1fr 70px 100px 90px;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);">
          <div style="font-size:13px;font-weight:500;">${l.description}</div>
          <div style="font-size:13px;font-family:'DM Mono',monospace;">${l.qty}</div>
          <div style="font-size:13px;font-family:'DM Mono',monospace;">${fmt(l.unit_cost)}</div>
          <div style="font-size:13px;font-family:'DM Mono',monospace;">${fmt(l.subtotal)}</div>
        </div>
      `).join('')}
      <div style="display:grid;grid-template-columns:1fr 70px 100px 90px;gap:8px;padding:10px 16px;background:var(--surface2);">
        <span style="font-weight:600;">Total (ex-GST)</span>
        <span></span>
        <span></span>
        <span style="font-weight:600;font-family:'DM Mono',monospace;">${fmt(po.subtotal || po.total)}</span>
      </div>
      <div style="padding:8px 16px;background:var(--surface2);border-top:1px solid var(--border);">
        <span style="font-size:11px;color:var(--text3);">GST will be confirmed on the supplier's invoice when goods are received.</span>
      </div>
    </div>
  `;

  // Receipt / return history
  let histHtml = '';
  const allEvents = [
    ...(po.receipts || []).map(r => ({ ...r, _type: 'receipt' })),
    ...(po.returns  || []).map(r => ({ ...r, _type: 'return'  })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (allEvents.length) {
    histHtml = `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:8px;margin-top:20px;">History</div>
      <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
        ${allEvents.map(e => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-size:13px;font-weight:500;">${e._type === 'receipt' ? 'Goods Received' : 'Return / Credit Note'}</div>
              <div style="font-size:12px;color:var(--text3);">${fmtDate(e.date)} ${e.notes ? '· ' + e.notes : ''}</div>
            </div>
            <div style="font-size:13px;font-family:'DM Mono',monospace;font-weight:600;color:${e._type === 'return' ? 'var(--danger)' : 'var(--success)'};">
              ${e._type === 'return' ? '-' : '+'}${fmt(e._type === 'receipt' ? e.total : e.credit)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  document.getElementById('ord-detail-history').innerHTML = histHtml;

  // Show/hide action buttons based on status
  const canEdit    = ['draft'].includes(po.status);
  const canSend    = ['draft'].includes(po.status);
  const canEmail   = ['draft','sent'].includes(po.status) && !!(supplier?.email);
  const canReceive = ['sent','partial','draft'].includes(po.status);
  const canReturn  = ['partial','received'].includes(po.status);
  const canVoid    = ['draft','sent'].includes(po.status);
  const hasPortal  = !!(supplier?.order_portal_url);

  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? 'inline-flex' : 'none';
  };
  show('ord-detail-edit-btn',    canEdit);
  show('ord-detail-send-btn',    canSend);
  show('ord-detail-email-btn',   canEmail);
  show('ord-detail-portal-btn',  hasPortal);
  show('ord-detail-receive-btn', canReceive);
  show('ord-detail-return-btn',  canReturn);
  show('ord-detail-void-btn',    canVoid);

  document.getElementById('ord-po-detail-modal').classList.add('show');
}

async function voidPO(id) {
  const po = purchaseOrders.find(p => p.id === id);
  if (!po || !confirm(`Void PO ${po.po_number}? This cannot be undone.`)) return;
  po.status   = 'voided';
  po.voided_at = new Date().toISOString();
  await dbSavePurchaseOrder(po);
  closeModal('ord-po-detail-modal');
  renderPOList();
  renderOrdKpis();
  toast(`PO ${po.po_number} voided`);
}

// Open supplier's online ordering portal in a new tab
function openSupplierPortal(supplierId) {
  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === supplierId);
  if (!supplier?.order_portal_url) {
    toast('No order portal URL set for this supplier — add one in the supplier profile');
    return;
  }
  // Ensure URL has a protocol
  let url = supplier.order_portal_url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  window.open(url, '_blank', 'noopener');
}

// Mark a draft PO as sent directly from the detail modal
// For in-person purchases (no supplier email), this marks as sent so goods can be received
async function savePOFromDetail() {
  const po = _viewingPO;
  if (!po) return;
  if (po.status !== 'draft') { toast('PO is already sent'); return; }
  po.status  = 'sent';
  po.sent_at = new Date().toISOString();
  await dbSavePurchaseOrder(po);
  // Refresh button states
  viewPO(po.id);
  renderPOList();
  renderOrdKpis();
  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id);
  const label = supplier?.email ? `PO ${po.po_number} marked as sent ✓` : `PO ${po.po_number} marked as sent — ready to receive goods ✓`;
  toast(label);
}

// ══════════════════════════════════════════════════════
//  GOODS RECEIVED
// ══════════════════════════════════════════════════════

function openReceiveModal(id) {
  const po = purchaseOrders.find(p => p.id === id);
  if (!po) return;
  closeModal('ord-po-detail-modal');

  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id);
  document.getElementById('ord-receive-title').textContent    = 'Receive Goods — ' + po.po_number;
  document.getElementById('ord-receive-subtitle').textContent =
    (supplier?.name || '—') + ' · PO date: ' + fmtDate(po.date);
  document.getElementById('ord-receive-modal').dataset.poId   = po.id;
  document.getElementById('ord-receive-error').style.display  = 'none';
  document.getElementById('ord-receive-variance-note').style.display = 'none';

  const container = document.getElementById('ord-receive-lines');
  container.innerHTML = (po.lines || []).map(l => {
    const alreadyReceived = (po.receipts || []).reduce((s, r) => {
      const rl = (r.lines || []).find(rl => rl.line_id === l.id);
      return s + (rl?.qty_received || 0);
    }, 0);
    const remaining = Math.max(0, l.qty - alreadyReceived);
    return `
      <div class="ord-receive-row" data-line-id="${l.id}" data-po-price="${l.unit_cost}">
        <div>
          <div style="font-size:13px;font-weight:500;">${l.description}</div>
          <div style="font-size:11px;color:var(--text3);">Ordered: ${l.qty} · Remaining: ${remaining}</div>
        </div>
        <span style="font-size:13px;font-family:'DM Mono',monospace;">${l.qty}</span>
        <input type="number" min="0" step="0.01" value="${remaining}" placeholder="0"
          data-ordered="${l.qty}" data-remaining="${remaining}"
          oninput="checkPriceVariance(this)"
          style="text-align:right;">
        <span class="ord-col-unit" style="font-size:13px;font-family:'DM Mono',monospace;color:var(--text2);">${fmt(l.unit_cost)}</span>
        <input type="number" class="ord-col-price" min="0" step="0.01" value="${l.unit_cost}" placeholder="${l.unit_cost}"
          data-po-price="${l.unit_cost}"
          oninput="checkPriceVariance(this)"
          style="text-align:right;">
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text2);cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;white-space:nowrap;">
          <input type="checkbox" class="ord-col-gst" checked style="width:auto;padding:0;border:none;accent-color:var(--accent);cursor:pointer;">
          GST
        </label>
      </div>
    `;
  }).join('');

  document.getElementById('ord-receive-modal').classList.add('show');
}

function checkPriceVariance(input) {
  const container  = document.getElementById('ord-receive-lines');
  const variances  = [];
  container.querySelectorAll('.ord-receive-row').forEach(row => {
    const poPrice     = parseFloat(row.dataset.poPrice) || 0;
    const actualInput = row.querySelector('input.ord-col-price');
    const actualPrice = parseFloat(actualInput?.value) || 0;
    if (actualInput) actualInput.classList.toggle('price-variance', Math.abs(actualPrice - poPrice) > 0.001);
    if (poPrice > 0 && Math.abs(actualPrice - poPrice) > 0.001) {
      variances.push(`${row.querySelector('div>div')?.textContent?.trim()}: PO ${fmt(poPrice)} → Actual ${fmt(actualPrice)}`);
    }
  });
  const noteEl = document.getElementById('ord-receive-variance-note');
  if (variances.length) {
    noteEl.innerHTML = '<strong>Price variance detected:</strong><br>' + variances.join('<br>');
    noteEl.style.display = 'block';
  } else {
    noteEl.style.display = 'none';
  }
}

async function confirmGoodsReceived() {
  const poId    = document.getElementById('ord-receive-modal').dataset.poId;
  const po      = purchaseOrders.find(p => p.id === poId);
  if (!po) return;

  const receiptLines = [];
  document.querySelectorAll('#ord-receive-lines .ord-receive-row').forEach(row => {
    const lineId      = row.dataset.lineId;
    const qtyReceived = parseFloat(row.querySelector('input[type=number]').value) || 0;
    const actualPrice = parseFloat(row.querySelector('input.ord-col-price')?.value) || 0;
    const gstChecked  = row.querySelector('input.ord-col-gst')?.checked ?? true;
    const poLine      = po.lines.find(l => l.id === lineId);
    if (qtyReceived > 0 && poLine) {
      const subtotal = +(qtyReceived * actualPrice).toFixed(2);
      receiptLines.push({
        line_id:          lineId,
        description:      poLine.description,
        qty_ordered:      poLine.qty,
        qty_received:     qtyReceived,
        po_unit_cost:     poLine.unit_cost,
        actual_unit_cost: actualPrice,
        subtotal,
        gst:              gstChecked ? 'yes' : 'no',
        gst_amount:       gstChecked ? +(subtotal * 0.1).toFixed(2) : 0,
      });
    }
  });

  if (!receiptLines.length) {
    document.getElementById('ord-receive-error').textContent = 'Enter a received quantity for at least one line.';
    document.getElementById('ord-receive-error').style.display = 'block';
    return;
  }

  const receiptTotal = receiptLines.reduce((s, l) => s + l.subtotal + l.gst_amount, 0);
  const receipt = {
    id:    uid(),
    date:  new Date().toISOString().split('T')[0],
    lines: receiptLines,
    total: +receiptTotal.toFixed(2),
    notes: '',
  };

  po.receipts = [...(po.receipts || []), receipt];

  // Determine new status
  const totalOrdered  = po.lines.reduce((s, l) => s + l.qty, 0);
  const totalReceived = po.receipts.reduce((s, r) =>
    s + r.lines.reduce((ss, rl) => ss + rl.qty_received, 0), 0);
  po.status = totalReceived >= totalOrdered ? 'received' : 'partial';
  if (po.status === 'received') po.received_at = new Date().toISOString();

  // Auto-create draft bill
  const createBill = document.getElementById('ord-receive-create-bill')?.checked;
  if (createBill) {
    const billId = await createBillFromDelivery(po, receipt);
    if (!po.bill_id) po.bill_id = billId;
  }

  await dbSavePurchaseOrder(po);

  // Increment on_hand for each received line that matches a stock item
  for (const rl of receiptLines) {
    // Match by stock_item_id if present, otherwise by description
    const catalogueItem = (typeof stockItems !== 'undefined' ? stockItems : []).find(i =>
      (rl.stock_item_id && i.id === rl.stock_item_id) ||
      (!rl.stock_item_id && i.name?.toLowerCase() === rl.description?.toLowerCase())
    );
    if (catalogueItem) {
      catalogueItem.on_hand = +((catalogueItem.on_hand || 0) + rl.qty_received).toFixed(3);
      if (typeof dbSaveStockItem === 'function') await dbSaveStockItem(catalogueItem);
    }
  }

  closeModal('ord-receive-modal');
  renderPOList();
  renderOrdKpis();
  toast(`Goods received ✓${createBill ? ' · Draft bill created' : ''} · On-hand updated`);

  // Notify parent if this is a franchise branch
  if (_businessProfile?.parent_business_id && typeof postFranchiseEvent === 'function') {
    const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id);
    postFranchiseEvent('po_received', {
      summary: `PO ${po.po_number} received from ${supplier?.name || 'supplier'} · ${receiptLines.length} line${receiptLines.length !== 1 ? 's' : ''}`,
      details: `Total: $${receiptTotal.toFixed(2)}${createBill ? ' · Draft bill created' : ''}`,
      po_number:     po.po_number,
      supplier_name: supplier?.name || '',
      total:         +receiptTotal.toFixed(2),
      lines:         receiptLines.length,
    });
  }
}

async function createBillFromDelivery(po, receipt) {
  const supplier  = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id);

  // Find or create a contact matching this supplier
  let contactId = null;
  if (typeof contacts !== 'undefined') {
    const existing = contacts.find(c =>
      c.name?.toLowerCase() === supplier?.name?.toLowerCase() && c.type !== 'customer'
    );
    contactId = existing?.id || null;
  }

  const billLines = (receipt.lines || []).map(l => ({
    id:          uid(),
    description: l.description,
    qty:         l.qty_received,
    unit_price:  l.actual_unit_cost,
    gst:         l.gst,
    subtotal:    l.subtotal,
    gst_amount:  l.gst_amount,
    total:       +(l.subtotal + l.gst_amount).toFixed(2),
  }));

  const subtotal  = billLines.reduce((s, l) => s + l.subtotal,   0);
  const gst_total = billLines.reduce((s, l) => s + l.gst_amount, 0);
  const total     = +(subtotal + gst_total).toFixed(2);

  const bill = {
    id:          uid(),
    number:      typeof nextBillNumber === 'function' ? nextBillNumber() : 'BILL-AUTO',
    contact_id:  contactId,
    bill_date:   receipt.date,
    due_date:    calcDueDate(supplier?.payment_terms, receipt.date),
    status:      'draft',
    notes:       `Auto-created from PO ${po.po_number}`,
    subtotal:    +subtotal.toFixed(2),
    gst_total,
    total,
    lines:       billLines,
    source_po_id: po.id,
    created_at:  new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  };

  if (typeof dbSaveBill === 'function') {
    await dbSaveBill(bill);
    if (typeof renderBillList === 'function') renderBillList();
  }
  return bill.id;
}

function calcDueDate(paymentTerms, fromDate) {
  const d = new Date(fromDate);
  const days = { 'Net 7': 7, 'Net 14': 14, 'Net 30': 30, 'Net 60': 60, 'COD': 0, 'EOM': null }[paymentTerms];
  if (days === null) {
    // End of month
    d.setMonth(d.getMonth() + 1, 0);
  } else if (days !== undefined) {
    d.setDate(d.getDate() + days);
  } else {
    d.setDate(d.getDate() + 30); // default 30 days
  }
  return d.toISOString().split('T')[0];
}

// ══════════════════════════════════════════════════════
//  RETURNS / CREDIT NOTES
// ══════════════════════════════════════════════════════

function openReturnModal(id) {
  const po = purchaseOrders.find(p => p.id === id);
  if (!po) return;
  closeModal('ord-po-detail-modal');

  document.getElementById('ord-return-po-id').value  = po.id;
  document.getElementById('ord-return-qty').value    = '';
  document.getElementById('ord-return-notes').value  = '';
  document.getElementById('ord-return-preview').style.display = 'none';

  // Populate line dropdown from received lines
  const allReceivedLines = [];
  (po.receipts || []).forEach(r => {
    (r.lines || []).forEach(l => {
      const already = (po.returns || []).reduce((s, ret) =>
        s + (ret.line_id === l.line_id ? ret.qty_returned : 0), 0);
      if (l.qty_received - already > 0) allReceivedLines.push(l);
    });
  });

  const sel = document.getElementById('ord-return-line');
  sel.innerHTML = '<option value="">Select line…</option>' +
    allReceivedLines.map((l, i) => `<option value="${i}">${l.description} (received ${l.qty_received})</option>`).join('');
  sel.dataset.linesJson = JSON.stringify(allReceivedLines);

  document.getElementById('ord-return-modal').classList.add('show');
}

async function confirmReturn() {
  const poId   = document.getElementById('ord-return-po-id').value;
  const po     = purchaseOrders.find(p => p.id === poId);
  const lineIdx = parseInt(document.getElementById('ord-return-line').value);
  const qtyRet  = parseFloat(document.getElementById('ord-return-qty').value);
  const reason  = document.getElementById('ord-return-reason').value;
  const notes   = document.getElementById('ord-return-notes').value.trim();

  if (!po || isNaN(lineIdx)) { toast('Please select a line'); return; }
  if (!qtyRet || qtyRet <= 0) { toast('Enter a valid return quantity'); return; }

  const linesData = JSON.parse(document.getElementById('ord-return-line').dataset.linesJson || '[]');
  const line      = linesData[lineIdx];
  if (!line) return;

  const creditAmt = +(qtyRet * line.actual_unit_cost).toFixed(2);
  const gstCredit = line.gst === 'yes' ? +(creditAmt * 0.1).toFixed(2) : 0;
  const totalCredit = +(creditAmt + gstCredit).toFixed(2);

  const returnRecord = {
    id:           uid(),
    date:         new Date().toISOString().split('T')[0],
    line_id:      line.line_id,
    description:  line.description,
    qty_returned: qtyRet,
    unit_cost:    line.actual_unit_cost,
    credit:       totalCredit,
    reason,
    notes,
  };

  po.returns = [...(po.returns || []), returnRecord];
  await dbSavePurchaseOrder(po);

  // Post credit note journal: DR Accounts Payable / CR Inventory (or Expense)
  const journal = {
    id:       uid(),
    date:     returnRecord.date,
    ref:      'RTN-' + po.po_number,
    narration: `Return to ${(typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id)?.name || 'supplier'} — ${line.description} × ${qtyRet} (${reason}). PO ${po.po_number}.`,
    source:   'return',
    lines: [
      { id: uid(), account: '2010', debit: totalCredit, credit: 0,           sort_order: 0, narration: 'Accounts Payable' },
      { id: uid(), account: '1100', debit: 0,           credit: totalCredit, sort_order: 1, narration: 'Inventory / COGS reversal' },
    ],
  };
  if (typeof journals !== 'undefined') journals.unshift(journal);
  if (typeof dbSaveJournal === 'function') await dbSaveJournal(journal);
  if (typeof renderAll === 'function') renderAll();

  closeModal('ord-return-modal');
  renderPOList();
  renderOrdKpis();
  toast(`Return logged ✓ Credit note journal posted — ${fmt(totalCredit)}`);
}

// ══════════════════════════════════════════════════════
//  STANDING ORDERS
// ══════════════════════════════════════════════════════

function renderStandingList() {
  const el = document.getElementById('ord-standing-list');
  if (!el) return;
  if (!standingOrders.length) {
    el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px;">No standing orders yet.</div>';
    return;
  }
  el.innerHTML = standingOrders.map(so => {
    const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === so.supplier_id);
    const scheduleLabels = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
    return `
      <div class="ord-standing-row">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;">${so.name}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">
            ${supplier?.name || '—'} · ${scheduleLabels[so.schedule] || so.schedule}
            · Next: ${so.next_due_date ? fmtDate(so.next_due_date) : '—'}
          </div>
          <div style="font-size:12px;color:var(--text3);">${(so.lines||[]).length} line${(so.lines||[]).length !== 1 ? 's' : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span class="badge ${so.active ? 'badge-income' : 'badge-operating'}">${so.active ? 'Active' : 'Paused'}</span>
          <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="openStandingOrderModal('${so.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="generatePOFromStanding('${so.id}')">Generate PO</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteStandingOrder('${so.id}')">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

function openStandingOrderModal(id) {
  const so = id ? standingOrders.find(s => s.id === id) : null;
  document.getElementById('ord-standing-modal-title').textContent = so ? 'Edit Standing Order' : 'New Standing Order';
  document.getElementById('ord-standing-edit-id').value   = so?.id || '';
  document.getElementById('ord-standing-name').value      = so?.name || '';
  document.getElementById('ord-standing-schedule').value  = so?.schedule || 'weekly';
  document.getElementById('ord-standing-next-due').value  = so?.next_due_date || '';
  document.getElementById('ord-standing-active').checked  = so?.active !== false;

  populatePOSupplierDropdown('ord-standing-supplier', so?.supplier_id);

  _standingLineCount = 0;
  document.getElementById('ord-standing-lines').innerHTML = '';
  if (so?.lines?.length) {
    so.lines.forEach(l => addStandingLine(l));
  } else {
    addStandingLine();
  }

  document.getElementById('ord-standing-modal').classList.add('show');
  document.getElementById('ord-standing-name').focus();
}

function addStandingLine(line) {
  const idx  = _standingLineCount++;
  const desc = line?.description || '';
  const qty  = line?.qty ?? '';
  const cost = line?.unit_cost ?? '';

  const container = document.getElementById('ord-standing-lines');
  const div = document.createElement('div');
  div.style.cssText = 'display:grid;grid-template-columns:1fr 80px 100px 36px;gap:8px;margin-bottom:8px;align-items:center;';
  div.innerHTML = `
    <input type="text" placeholder="Item description" value="${desc}"
      style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);">
    <input type="number" min="0" step="0.01" placeholder="0" value="${qty}"
      style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;font-family:'DM Mono',monospace;">
    <input type="number" min="0" step="0.01" placeholder="0.00" value="${cost}"
      style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);text-align:right;font-family:'DM Mono',monospace;">
    <button class="btn btn-ghost btn-sm" onclick="this.closest('div').remove()" style="padding:4px 8px;color:var(--danger);">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  container.appendChild(div);
}

function getStandingLines() {
  return Array.from(document.querySelectorAll('#ord-standing-lines > div')).map(row => {
    const inputs = row.querySelectorAll('input');
    return {
      id:          uid(),
      description: inputs[0].value.trim(),
      qty:         parseFloat(inputs[1].value) || 0,
      unit_cost:   parseFloat(inputs[2].value) || 0,
    };
  }).filter(l => l.description || l.qty > 0);
}

async function saveStandingOrder() {
  const editId     = document.getElementById('ord-standing-edit-id').value;
  const name       = document.getElementById('ord-standing-name').value.trim();
  const supplierId = document.getElementById('ord-standing-supplier').value;
  const schedule   = document.getElementById('ord-standing-schedule').value;
  const nextDue    = document.getElementById('ord-standing-next-due').value;
  const active     = document.getElementById('ord-standing-active').checked;
  const lines      = getStandingLines();

  if (!name)       { toast('Name is required'); return; }
  if (!supplierId) { toast('Please select a supplier'); return; }
  if (!lines.length) { toast('Add at least one line item'); return; }

  const so = {
    id:            editId || uid(),
    name,
    supplier_id:   supplierId,
    schedule,
    next_due_date: nextDue || null,
    active,
    lines,
    created_at:    editId ? undefined : new Date().toISOString(),
    last_generated_at: null,
  };
  if (!editId) delete so.created_at;

  await dbSaveStandingOrder(so);
  closeModal('ord-standing-modal');
  renderStandingList();
  toast(`${editId ? 'Updated' : 'Created'} "${name}" ✓`);
}

async function deleteStandingOrder(id) {
  const so = standingOrders.find(s => s.id === id);
  if (!so || !confirm(`Remove standing order "${so.name}"?`)) return;
  await dbDeleteStandingOrder(id);
  renderStandingList();
  toast('Standing order removed');
}

async function generatePOFromStanding(id) {
  const so = standingOrders.find(s => s.id === id);
  if (!so) return;

  const lines = so.lines.map(l => ({
    id:          uid(),
    description: l.description,
    qty:         l.qty,
    unit_cost:   l.unit_cost || 0,
    subtotal:    +(l.qty * (l.unit_cost || 0)).toFixed(2),
    gst_amount:  0,
  }));

  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === so.supplier_id);
  const today    = new Date().toISOString().split('T')[0];
  const expected = supplier?.lead_time_days
    ? (() => { const d = new Date(); d.setDate(d.getDate() + supplier.lead_time_days); return d.toISOString().split('T')[0]; })()
    : '';

  const po = buildPOObject({
    supplier_id:   so.supplier_id,
    date:          today,
    expected_date: expected,
    notes:         `Standing order: ${so.name}`,
    lines,
    status:        'draft',
  });

  await dbSavePurchaseOrder(po);

  // Update next due date
  so.last_generated_at = new Date().toISOString();
  so.next_due_date = calcNextDueDate(so.schedule, today);
  await dbSaveStandingOrder(so);

  renderStandingList();
  renderPOList();
  renderOrdKpis();
  toast(`PO ${po.po_number} generated from "${so.name}" ✓`);
  showOrderingTab('orders');
}

function calcNextDueDate(schedule, fromDate) {
  const d = new Date(fromDate);
  if (schedule === 'weekly')      d.setDate(d.getDate() + 7);
  else if (schedule === 'fortnightly') d.setDate(d.getDate() + 14);
  else if (schedule === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

// Called on login — auto-generates draft POs for overdue standing orders
async function checkDueStandingOrders() {
  const today    = new Date().toISOString().split('T')[0];
  const overdue  = standingOrders.filter(so =>
    so.active && so.next_due_date && so.next_due_date <= today
  );
  if (!overdue.length) return;

  for (const so of overdue) {
    await generatePOFromStanding(so.id);
  }
  toast(`${overdue.length} standing order${overdue.length !== 1 ? 's' : ''} generated — review before sending`);
}

// ══════════════════════════════════════════════════════
//  ANALYTICS
// ══════════════════════════════════════════════════════

function renderAnalytics() {
  const rangeEl = document.getElementById('ord-analytics-range');
  const days    = rangeEl?.value === 'all' ? Infinity : parseInt(rangeEl?.value || '90');
  const cutoff  = days === Infinity ? null : (() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0]; })();

  const relevantPOs = purchaseOrders.filter(po =>
    po.status === 'received' && (!cutoff || po.date >= cutoff)
  );

  renderSpendBySupplier(relevantPOs);
  renderTopItems(relevantPOs);
  renderPriceTrends();
}

function renderSpendBySupplier(pos) {
  const el = document.getElementById('ord-spend-chart');
  if (!el) return;

  const bySupplier = {};
  pos.forEach(po => {
    const name = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === po.supplier_id)?.name || 'Unknown';
    bySupplier[name] = (bySupplier[name] || 0) + (po.total || 0);
  });

  const sorted = Object.entries(bySupplier).sort(([,a],[,b]) => b - a).slice(0, 8);
  const max    = sorted[0]?.[1] || 1;

  if (!sorted.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">No received orders in this period.</div>';
    return;
  }

  el.innerHTML = sorted.map(([name, total], i) => `
    <div class="ord-analytics-bar-wrap">
      <div style="width:120px;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;" title="${name}">${name}</div>
      <div class="ord-analytics-bar-track">
        <div class="ord-analytics-bar-fill" style="width:${Math.round((total/max)*100)}%;"></div>
      </div>
      <div style="width:80px;text-align:right;font-size:12px;font-family:'DM Mono',monospace;flex-shrink:0;">${fmt(total)}</div>
    </div>
  `).join('');
}

function renderTopItems(pos) {
  const el = document.getElementById('ord-top-items-chart');
  if (!el) return;

  const byItem = {};
  pos.forEach(po => {
    (po.lines || []).forEach(l => {
      byItem[l.description] = (byItem[l.description] || 0) + (l.subtotal || 0);
    });
    (po.receipts || []).forEach(r => {
      (r.lines || []).forEach(l => {
        byItem[l.description] = (byItem[l.description] || 0) + (l.subtotal || 0);
      });
    });
  });

  const sorted = Object.entries(byItem).sort(([,a],[,b]) => b - a).slice(0, 8);
  const max    = sorted[0]?.[1] || 1;

  if (!sorted.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;">No data yet.</div>';
    return;
  }

  el.innerHTML = sorted.map(([name, total]) => `
    <div class="ord-analytics-bar-wrap">
      <div style="width:130px;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;" title="${name}">${name}</div>
      <div class="ord-analytics-bar-track">
        <div class="ord-analytics-bar-fill accent2" style="width:${Math.round((total/max)*100)}%;"></div>
      </div>
      <div style="width:80px;text-align:right;font-size:12px;font-family:'DM Mono',monospace;flex-shrink:0;">${fmt(total)}</div>
    </div>
  `).join('');
}

function renderPriceTrends() {
  const el = document.getElementById('ord-price-trends');
  if (!el) return;

  // Build price history per item description across all received POs
  const history = {};
  [...purchaseOrders]
    .filter(po => po.status === 'received' && po.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(po => {
      (po.lines || []).forEach(l => {
        if (!l.description || !l.unit_cost) return;
        if (!history[l.description]) history[l.description] = [];
        history[l.description].push({ date: po.date, price: l.unit_cost, po: po.po_number });
      });
    });

  // Only show items with 2+ price points that have changed
  const changed = Object.entries(history).filter(([, pts]) => {
    if (pts.length < 2) return false;
    const prices = pts.map(p => p.price);
    return Math.max(...prices) !== Math.min(...prices);
  });

  if (!changed.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">No price changes detected yet — need at least 2 received POs per item.</div>';
    return;
  }

  el.innerHTML = changed.map(([name, pts]) => {
    const first   = pts[0].price;
    const last    = pts[pts.length - 1].price;
    const change  = last - first;
    const pct     = first > 0 ? ((change / first) * 100).toFixed(1) : 0;
    const up      = change > 0;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:500;">${name}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">
            ${pts.length} price point${pts.length !== 1 ? 's' : ''} ·
            First: ${fmt(first)} · Latest: ${fmt(last)}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:16px;">
          <div style="font-size:14px;font-weight:600;font-family:'DM Mono',monospace;color:${up ? 'var(--danger)' : 'var(--success)'};">
            ${up ? '▲' : '▼'} ${fmt(Math.abs(change))}
          </div>
          <div style="font-size:11px;color:${up ? 'var(--danger)' : 'var(--success)'};">${up ? '+' : ''}${pct}%</div>
        </div>
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  PO HTML TEMPLATE
//  Shared by generatePOPdf (print window) and
//  emailPOToSupplier (Edge Function email/attachment).
// ══════════════════════════════════════════════════════

function buildPOHtml(po, supplier, biz, lines) {
  const poNum    = po?.po_number || 'PREVIEW';
  const date     = po?.date     || '';
  const expected = po?.expected_date || '';
  const notes    = po?.notes    || '';
  const subtotal = lines.reduce((s, l) => s + (l.subtotal    || 0), 0);
  const gstTotal = lines.reduce((s, l) => s + (l.gst_amount  || 0), 0);
  const total    = subtotal + gstTotal;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Purchase Order ${poNum}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;font-size:13px;color:#1a1a2e;background:#fff;padding:0;}
  .page{padding:52px 56px;max-width:820px;margin:0 auto;}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:16px;border-bottom:2px solid #1a1a2e;}
  .logo{font-family:'DM Serif Display',serif;font-size:26px;color:#1a1a2e;}
  .logo span{color:#e8c547;}
  .po-title{font-family:'DM Serif Display',serif;font-size:22px;margin-bottom:4px;}
  .po-meta{font-size:12px;color:#5c5c7a;line-height:1.8;}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:28px;}
  .party-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:#9f9fba;margin-bottom:6px;}
  .party-name{font-weight:600;font-size:14px;margin-bottom:3px;}
  .party-detail{font-size:12px;color:#5c5c7a;line-height:1.6;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th{text-align:left;padding:8px 12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:#9f9fba;background:#f0ede8;border-bottom:1px solid #e2ddd6;}
  td{padding:10px 12px;border-bottom:1px solid #e2ddd6;vertical-align:top;}
  tr:last-child td{border-bottom:none;}
  .mono{font-family:'DM Mono',monospace;}
  .text-right{text-align:right;}
  .totals{width:260px;margin-left:auto;margin-bottom:20px;}
  .totals-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;}
  .totals-row.grand{font-size:15px;font-weight:700;border-top:2px solid #1a1a2e;padding-top:10px;margin-top:6px;}
  .notes-section{background:#f7f5f2;border-radius:8px;padding:16px;font-size:12px;color:#5c5c7a;margin-bottom:20px;}
  .footer{margin-top:40px;padding-top:12px;border-top:1px solid #e2ddd6;font-size:10px;color:#9f9fba;display:flex;justify-content:space-between;}
  .badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;}
  .badge-draft{background:#e2d9f3;color:#4a3072;}
  .badge-sent{background:#d1ecf1;color:#0c5460;}
  @media print{.print-btn{display:none!important;}}
  .print-btn{position:fixed;top:20px;right:20px;background:#1a1a2e;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.2);}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="page">
  <div class="header">
    <div>
      <div class="logo">Tayla <span>Business</span></div>
      <div style="font-size:12px;color:#5c5c7a;margin-top:4px;">${biz.biz_name || ''}</div>
      ${biz.abn     ? `<div style="font-size:12px;color:#5c5c7a;">ABN ${biz.abn}</div>` : ''}
      ${biz.address ? `<div style="font-size:12px;color:#5c5c7a;">${biz.address}${biz.state ? ', ' + biz.state : ''}${biz.postcode ? ' ' + biz.postcode : ''}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <div class="po-title">Purchase Order</div>
      <div class="po-meta">
        <div style="font-size:16px;font-family:'DM Mono',monospace;font-weight:500;color:#1a1a2e;">${poNum}</div>
        <div>Date: ${date ? new Date(date).toLocaleDateString('en-AU', {day:'numeric',month:'long',year:'numeric'}) : '—'}</div>
        ${expected ? `<div>Expected: ${new Date(expected).toLocaleDateString('en-AU', {day:'numeric',month:'long',year:'numeric'})}</div>` : ''}
        ${po?.status ? `<span class="badge badge-${po.status}">${poStatusLabel(po.status)}</span>` : ''}
      </div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">From</div>
      <div class="party-name">${biz.biz_name || 'Our Business'}</div>
      ${biz.address   ? `<div class="party-detail">${biz.address}${biz.state ? ', ' + biz.state : ''}${biz.postcode ? ' ' + biz.postcode : ''}</div>` : ''}
      ${biz.phone     ? `<div class="party-detail">${biz.phone}</div>` : ''}
      ${biz.biz_email ? `<div class="party-detail">${biz.biz_email}</div>` : ''}
    </div>
    <div>
      <div class="party-label">To (Supplier)</div>
      <div class="party-name">${supplier?.name || '—'}</div>
      ${supplier?.contact_name  ? `<div class="party-detail">Attn: ${supplier.contact_name}</div>` : ''}
      ${supplier?.phone         ? `<div class="party-detail">${supplier.phone}</div>` : ''}
      ${supplier?.email         ? `<div class="party-detail">${supplier.email}</div>` : ''}
      ${supplier?.payment_terms ? `<div class="party-detail">Terms: ${supplier.payment_terms}</div>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="text-right" style="width:70px;">Qty</th>
        <th class="text-right" style="width:100px;">Unit Cost</th>
        <th class="text-right" style="width:90px;">Subtotal</th>
        <th class="text-right" style="width:80px;">GST</th>
        <th class="text-right" style="width:90px;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map(l => `
        <tr>
          <td>${l.description}</td>
          <td class="mono text-right">${l.qty}</td>
          <td class="mono text-right">$${(l.unit_cost || 0).toFixed(2)}</td>
          <td class="mono text-right" style="font-weight:600;">$${(l.subtotal || 0).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span style="color:#5c5c7a;">Subtotal</span><span class="mono">$${subtotal.toFixed(2)}</span></div>
    <div class="totals-row"><span style="color:#5c5c7a;">GST (10%)</span><span class="mono">$${gstTotal.toFixed(2)}</span></div>
    <div class="totals-row grand"><span>Total (AUD)</span><span class="mono">$${total.toFixed(2)}</span></div>
  </div>

  ${notes ? `<div class="notes-section"><strong>Notes:</strong> ${notes}</div>` : ''}

  <div class="footer">
    <span>Generated by Tayla Business · usetayla.com.au</span>
    <span>${new Date().toLocaleDateString('en-AU', {day:'numeric',month:'long',year:'numeric'})}</span>
  </div>
</div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════
//  PO PDF GENERATION (print window)
// ══════════════════════════════════════════════════════

function generatePOPdf(poId) {
  const id         = poId || document.getElementById('ord-po-edit-id')?.value || _viewingPO?.id;
  const po         = purchaseOrders.find(p => p.id === id);
  const supplierId = po?.supplier_id || document.getElementById('ord-po-supplier')?.value;
  const supplier   = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === supplierId);
  const biz        = typeof _businessProfile !== 'undefined' ? _businessProfile : {};
  const lines      = po?.lines || getPOLines();
  const html       = buildPOHtml(po, supplier, biz, lines);
  const w          = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

async function emailPOToSupplier(poId) {
  const id       = poId || _viewingPO?.id || document.getElementById('ord-po-edit-id')?.value;
  const po       = purchaseOrders.find(p => p.id === id);
  const supplierId = po?.supplier_id || document.getElementById('ord-po-supplier')?.value;
  const supplier = (typeof suppliers !== 'undefined' ? suppliers : []).find(s => s.id === supplierId);

  if (!supplier?.email) {
    toast('No email address on file for this supplier — add one in the supplier profile');
    return;
  }

  // Resolve email settings (custom from or Tayla default)
  const emailCfg = typeof getEmailSettings === 'function'
    ? getEmailSettings()
    : { from: 'noreply@usetayla.com.au', replyTo: '', isCustom: false };

  const biz   = typeof _businessProfile !== 'undefined' ? _businessProfile : {};
  const lines = po?.lines || getPOLines();

  // Build PO HTML for email body + PDF attachment
  const poHtml = buildPOHtml(po, supplier, biz, lines);

  // Show sending state
  toast('Sending PO to ' + supplier.email + '…');

  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const token = session?.access_token;

    const res = await fetch(
      `https://vyikolyljzygmxiahcul.supabase.co/functions/v1/send-po-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          to:          supplier.email,
          supplierName: supplier.name,
          contactName:  supplier.contact_name || null,
          from:         emailCfg.from,
          replyTo:      emailCfg.replyTo || biz.biz_email || null,
          bizName:      biz.biz_name || 'Tayla Business',
          poNumber:     po?.po_number || 'PO',
          poHtml,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast('Failed to send: ' + (err.error || res.statusText));
      return;
    }

    // Mark PO as sent
    if (po && po.status === 'draft') {
      po.status  = 'sent';
      po.sent_at = new Date().toISOString();
      await dbSavePurchaseOrder(po);
      renderPOList();
      renderOrdKpis();
    }

    closeModal('ord-po-detail-modal');
    closeModal('ord-po-modal');
    toast('PO sent to ' + supplier.email + ' ✓');

  } catch (err) {
    console.error('Send PO email failed:', err);
    toast('Failed to send email — check your connection');
  }
}

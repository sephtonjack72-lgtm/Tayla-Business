/* ══════════════════════════════════════════════════════
   Tayla Business — Fixed Asset Register
   assets.js
══════════════════════════════════════════════════════ */

let fixedAssets = JSON.parse(localStorage.getItem('fixedAssets') || '[]');

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadFixedAssets() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('fixed_assets').select('*')
    .eq('business_id', _businessId)
    .order('purchase_date', { ascending: false });
  if (error) { console.error('Load fixed assets failed:', error); return; }
  fixedAssets = data || [];
  localStorage.setItem('fixedAssets', JSON.stringify(fixedAssets));
}

async function dbSaveFixedAsset(asset) {
  const idx = fixedAssets.findIndex(a => a.id === asset.id);
  if (idx >= 0) fixedAssets[idx] = asset; else fixedAssets.push(asset);
  localStorage.setItem('fixedAssets', JSON.stringify(fixedAssets));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('fixed_assets').upsert({ ...asset, business_id: _businessId }, { onConflict: 'id' });
  if (error) console.error('Save fixed asset failed:', error);
}

async function dbDeleteFixedAsset(id) {
  fixedAssets = fixedAssets.filter(a => a.id !== id);
  localStorage.setItem('fixedAssets', JSON.stringify(fixedAssets));
  if (!_businessId) return;
  await _supabase.from('fixed_assets').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  DEPRECIATION CALCULATIONS
// ══════════════════════════════════════════════════════

function getFYDates(fy) {
  const year = parseInt(fy);
  return {
    start: new Date(`${year - 1}-07-01`),
    end:   new Date(`${year}-06-30`),
  };
}

function calcDepreciation(asset, fy) {
  const cost      = parseFloat(asset.cost)     || 0;
  const salvage   = parseFloat(asset.salvage)  || 0;
  const life      = parseFloat(asset.life)     || 1;
  const dvRate    = parseFloat(asset.dv_rate)  || 20;
  const method    = asset.method || 'sl';
  const purchDate = new Date(asset.purchase_date);
  const { start, end } = getFYDates(fy);
  if (asset.disposed || method === 'none') return { annual: 0, accum: 0, bookValue: cost };

  // How many full FYs have elapsed before this FY
  const fyStart = parseInt(fy);
  const assetFYStart = purchDate >= start ? fyStart
    : purchDate.getFullYear() + (purchDate.getMonth() >= 6 ? 1 : 0);
  const fysPassed = Math.max(0, fyStart - assetFYStart);

  let accum = 0;
  let bookValue = cost;
  let annual = 0;

  if (method === 'sl') {
    const depreciableAmount = cost - salvage;
    annual = +(depreciableAmount / life).toFixed(2);
    // Pro-rate first year based on days owned in that FY
    if (purchDate >= start && purchDate <= end) {
      const daysInFY = 365;
      const daysOwned = Math.floor((end - purchDate) / 86400000);
      annual = +((depreciableAmount / life) * (daysOwned / daysInFY)).toFixed(2);
    }
    accum = Math.min(+((depreciableAmount / life) * fysPassed + annual).toFixed(2), depreciableAmount);
    bookValue = Math.max(+(cost - accum).toFixed(2), salvage);
  } else if (method === 'dv') {
    const rate = dvRate / 100;
    bookValue = cost;
    for (let i = 0; i < fysPassed; i++) {
      bookValue = Math.max(+(bookValue * (1 - rate)).toFixed(2), salvage);
    }
    const openingBookValue = bookValue;
    annual = Math.max(+(bookValue * rate).toFixed(2), 0);
    if (purchDate >= start && purchDate <= end) {
      const daysInFY = 365;
      const daysOwned = Math.floor((end - purchDate) / 86400000);
      annual = +((cost * rate) * (daysOwned / daysInFY)).toFixed(2);
    }
    bookValue = Math.max(+(openingBookValue - annual).toFixed(2), salvage);
    accum = +(cost - bookValue).toFixed(2);
  }

  // Stop depreciating once fully depreciated
  if (bookValue <= salvage) {
    annual = 0;
    bookValue = salvage;
    accum = cost - salvage;
  }

  // Don't depreciate assets not yet purchased
  if (purchDate > end) return { annual: 0, accum: 0, bookValue: cost, openingBookValue: cost };

  const openingBookValue = +(bookValue + annual).toFixed(2);
  return { annual, accum, bookValue, openingBookValue };
}

// ══════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════

function showAssetTab(tab) {
  ['register','depreciation','add'].forEach(t => {
    const el = document.getElementById(`asset-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById(`atab-${t}`);
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.color = t === tab ? 'var(--accent)' : 'var(--text2)';
      btn.style.borderBottomColor = t === tab ? 'var(--accent2)' : 'transparent';
    }
  });
  if (tab === 'register')    { renderAssetRegister(); renderAssetKpis(); }
  if (tab === 'depreciation'){ renderDepreciationSchedule(); }
  if (tab === 'add')         { renderAssetFormPreview(); }
}

// ══════════════════════════════════════════════════════
//  ASSET REGISTER
// ══════════════════════════════════════════════════════

function renderAssetKpis() {
  const el = document.getElementById('asset-kpis');
  if (!el) return;
  const fy = document.getElementById('depr-fy')?.value || '2026';
  const active  = fixedAssets.filter(a => !a.disposed);
  const totalCost  = active.reduce((s,a) => s + (parseFloat(a.cost)||0), 0);
  const totalAccum = active.reduce((s,a) => s + calcDepreciation(a, fy).accum, 0);
  const totalBook  = active.reduce((s,a) => s + calcDepreciation(a, fy).bookValue, 0);
  const totalDeprThisFY = active.reduce((s,a) => s + calcDepreciation(a, fy).annual, 0);
  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Total Assets (Cost)</div><div class="kpi-value">${fmt(totalCost)}</div></div>
    <div class="kpi"><div class="kpi-label">Acc. Depreciation</div><div class="kpi-value negative">${fmt(totalAccum)}</div></div>
    <div class="kpi"><div class="kpi-label">Net Book Value</div><div class="kpi-value">${fmt(totalBook)}</div></div>
    <div class="kpi"><div class="kpi-label">Depreciation FY${fy}</div><div class="kpi-value negative">${fmt(totalDeprThisFY)}</div></div>
  `;
}

function renderAssetRegister() {
  const tbody = document.getElementById('asset-register-tbody');
  const empty = document.getElementById('asset-register-empty');
  if (!tbody) return;
  const fy = document.getElementById('depr-fy')?.value || '2026';
  const active = fixedAssets.filter(a => !a.disposed);

  if (!active.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const methodLabel = { sl: 'Straight-Line', dv: 'Diminishing Value', none: 'No Depreciation' };

  tbody.innerHTML = active.map(asset => {
    const { accum, bookValue } = calcDepreciation(asset, fy);
    return `
      <tr>
        <td>
          <div style="font-weight:600;">${asset.name}</div>
          <div style="font-size:11px;color:var(--text3);">${asset.notes || ''}</div>
        </td>
        <td>${asset.category || '—'}</td>
        <td>${fmtDate(asset.purchase_date)}</td>
        <td class="mono">${fmt(asset.cost)}</td>
        <td style="font-size:12px;">${methodLabel[asset.method] || asset.method}</td>
        <td class="mono" style="color:var(--danger);">${fmt(accum)}</td>
        <td class="mono" style="font-weight:600;">${fmt(bookValue)}</td>
        <td>
          <div class="flex-gap">
            <button class="btn btn-ghost btn-sm" style="color:var(--text);" onclick="editFixedAsset('${asset.id}')">Edit</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="openDisposal('${asset.id}')">Dispose</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Also show disposed assets
  const disposed = fixedAssets.filter(a => a.disposed);
  if (disposed.length) {
    tbody.innerHTML += `<tr><td colspan="8" style="padding:10px 14px;background:var(--surface2);font-size:12px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Disposed Assets</td></tr>`;
    tbody.innerHTML += disposed.map(asset => `
      <tr style="opacity:.6;">
        <td><div style="font-weight:600;">${asset.name}</div></td>
        <td>${asset.category || '—'}</td>
        <td>${fmtDate(asset.purchase_date)}</td>
        <td class="mono">${fmt(asset.cost)}</td>
        <td style="font-size:12px;">Disposed ${fmtDate(asset.disposal_date)}</td>
        <td class="mono">${fmt(asset.cost)}</td>
        <td class="mono">$0.00</td>
        <td><span style="font-size:12px;color:var(--text3);">Disposed</span></td>
      </tr>
    `).join('');
  }
}

// ══════════════════════════════════════════════════════
//  DEPRECIATION SCHEDULE
// ══════════════════════════════════════════════════════

function renderDepreciationSchedule() {
  const fy    = document.getElementById('depr-fy')?.value || '2026';
  const tbody = document.getElementById('depr-tbody');
  const total = document.getElementById('depr-total');
  if (!tbody) return;

  const active = fixedAssets.filter(a => !a.disposed);
  const methodLabel = { sl: 'SL', dv: 'DV', none: '—' };

  let totalDepr = 0;
  tbody.innerHTML = active.map(asset => {
    const { annual, accum, bookValue, openingBookValue } = calcDepreciation(asset, fy);
    totalDepr += annual;
    return `
      <tr>
        <td>
          <div style="font-weight:600;">${asset.name}</div>
          <div style="font-size:11px;color:var(--text3);">Cost: ${fmt(asset.cost)} · Life: ${asset.life}yr${asset.method === 'dv' ? ` · Rate: ${asset.dv_rate}%` : ''}</div>
        </td>
        <td><span class="badge ${asset.method === 'sl' ? 'badge-operating' : asset.method === 'dv' ? 'badge-software' : 'badge-setup'}">${methodLabel[asset.method]}</span></td>
        <td class="mono">${fmt(openingBookValue || 0)}</td>
        <td class="mono" style="color:${annual > 0 ? 'var(--danger)' : 'var(--text3)'};">${annual > 0 ? fmt(annual) : '—'}</td>
        <td class="mono" style="font-weight:600;">${fmt(bookValue)}</td>
        <td class="mono" style="color:var(--danger);">${fmt(accum)}</td>
      </tr>
    `;
  }).join('');

  if (!active.length) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text3);">No assets to depreciate.</td></tr>`;

  if (total) total.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div style="font-size:13px;color:var(--text2);">Total depreciation for FY${fy}: <strong style="font-family:'DM Mono',monospace;color:var(--danger);">${fmt(totalDepr)}</strong></div>
      <div style="font-size:12px;color:var(--text3);">DR 5060 Depreciation Expense · CR 1510 Accumulated Depreciation</div>
    </div>
  `;
}

async function postDepreciationJournals() {
  const fy = document.getElementById('depr-fy')?.value || '2026';
  const active = fixedAssets.filter(a => !a.disposed);
  const lines = [];
  let totalDepr = 0;

  active.forEach(asset => {
    const { annual } = calcDepreciation(asset, fy);
    if (annual > 0) {
      lines.push({ accountId: '5060', accountName: 'Depreciation Expense', debit: annual, credit: 0 });
      lines.push({ accountId: '1510', accountName: 'Accumulated Depreciation - PPE', debit: 0, credit: annual });
      totalDepr += annual;
    }
  });

  if (!lines.length) { toast('No depreciation to post for this period'); return; }

  // Consolidate — sum all debits into one line, all credits into one
  const journalLines = [
    { accountId: '5060', accountName: 'Depreciation Expense', debit: totalDepr, credit: 0 },
    { accountId: '1510', accountName: 'Accumulated Depreciation - PPE', debit: 0, credit: totalDepr },
  ];

  const journal = {
    id: uid(),
    date: new Date().toISOString().split('T')[0],
    ref: `DEP-FY${fy}`,
    narration: `Depreciation expense for FY${fy} — ${active.filter(a => calcDepreciation(a, fy).annual > 0).length} assets`,
    lines: journalLines,
    total: totalDepr,
    gst: 'no',
    createdAt: new Date().toISOString(),
  };

  journals.unshift(journal);
  await dbSaveJournal(journal);
  renderAll();
  toast(`✓ Depreciation journal posted — ${fmt(totalDepr)} for FY${fy}`);
}

// ══════════════════════════════════════════════════════
//  ADD / EDIT ASSET FORM
// ══════════════════════════════════════════════════════

function saveFixedAsset() {
  const name     = document.getElementById('fa-name').value.trim();
  const category = document.getElementById('fa-category').value;
  const account  = document.getElementById('fa-account').value;
  const purchDate= document.getElementById('fa-purchase-date').value;
  const cost     = parseFloat(document.getElementById('fa-cost').value) || 0;
  const method   = document.getElementById('fa-method').value;
  const life     = parseFloat(document.getElementById('fa-life').value) || 5;
  const salvage  = parseFloat(document.getElementById('fa-salvage').value) || 0;
  const dvRate   = parseFloat(document.getElementById('fa-dv-rate').value) || 20;
  const notes    = document.getElementById('fa-notes').value.trim();
  const editId   = document.getElementById('asset-edit-id').value;

  if (!name)     { toast('Asset name is required'); return; }
  if (!purchDate){ toast('Purchase date is required'); return; }
  if (!cost)     { toast('Purchase price is required'); return; }

  const asset = {
    id: editId || uid(), name, category, account, purchase_date: purchDate,
    cost, method, life, salvage, dv_rate: dvRate, notes,
    disposed: false, created_at: editId ? undefined : new Date().toISOString(),
  };
  if (!editId) delete asset.created_at;

  dbSaveFixedAsset(asset).then(() => {
    cancelAssetEdit();
    renderAssetRegister();
    renderAssetKpis();
    renderDepreciationSchedule();
    showAssetTab('register');
    toast(`Asset "${name}" saved ✓`);
  });
}

function editFixedAsset(id) {
  const asset = fixedAssets.find(a => a.id === id);
  if (!asset) return;
  document.getElementById('asset-edit-id').value   = asset.id;
  document.getElementById('fa-name').value         = asset.name || '';
  document.getElementById('fa-category').value     = asset.category || 'ppe';
  document.getElementById('fa-account').value      = asset.account || '1500';
  document.getElementById('fa-purchase-date').value= asset.purchase_date || '';
  document.getElementById('fa-cost').value         = asset.cost || '';
  document.getElementById('fa-method').value       = asset.method || 'sl';
  document.getElementById('fa-life').value         = asset.life || 5;
  document.getElementById('fa-salvage').value      = asset.salvage || 0;
  document.getElementById('fa-dv-rate').value      = asset.dv_rate || 20;
  document.getElementById('fa-notes').value        = asset.notes || '';
  document.getElementById('asset-form-title').textContent = 'Edit Asset';
  document.getElementById('asset-cancel-btn').style.display = 'inline-flex';
  showAssetTab('add');
  renderAssetFormPreview();
}

function cancelAssetEdit() {
  ['asset-edit-id','fa-name','fa-notes','fa-cost','fa-purchase-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fa-category').value  = 'ppe';
  document.getElementById('fa-method').value    = 'sl';
  document.getElementById('fa-life').value      = 5;
  document.getElementById('fa-salvage').value   = 0;
  document.getElementById('fa-dv-rate').value   = 20;
  document.getElementById('fa-account').value   = '1500';
  document.getElementById('asset-form-title').textContent = 'Add Asset';
  document.getElementById('asset-cancel-btn').style.display = 'none';
  document.getElementById('asset-form-preview').innerHTML = 'Fill in the form to see a depreciation preview.';
}

function renderAssetFormPreview() {
  const cost    = parseFloat(document.getElementById('fa-cost')?.value) || 0;
  const method  = document.getElementById('fa-method')?.value || 'sl';
  const life    = parseFloat(document.getElementById('fa-life')?.value) || 5;
  const salvage = parseFloat(document.getElementById('fa-salvage')?.value) || 0;
  const dvRate  = parseFloat(document.getElementById('fa-dv-rate')?.value) || 20;
  const el      = document.getElementById('asset-form-preview');
  if (!el || !cost) return;

  const depreciable = cost - salvage;
  let rows = '';

  if (method === 'sl') {
    const annualDepr = depreciable / life;
    rows = Array.from({ length: Math.min(life, 10) }, (_, i) => {
      const bookValue = Math.max(cost - annualDepr * (i + 1), salvage);
      return `<tr><td style="padding:5px 8px;color:var(--text3);">Year ${i+1}</td><td style="padding:5px 8px;font-family:'DM Mono',monospace;color:var(--danger);">${fmt(annualDepr)}</td><td style="padding:5px 8px;font-family:'DM Mono',monospace;">${fmt(bookValue)}</td></tr>`;
    }).join('');
    el.innerHTML = `
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px;">Straight-Line · ${life} years</div>
        <div style="font-size:13px;">Annual depreciation: <strong style="font-family:'DM Mono',monospace;color:var(--danger);">${fmt(annualDepr)}</strong></div>
        <div style="font-size:13px;">Salvage value: <strong style="font-family:'DM Mono',monospace;">${fmt(salvage)}</strong></div>
      </div>
      <table style="width:100%;font-size:12px;"><thead><tr><th style="padding:5px 8px;color:var(--text3);text-align:left;">Period</th><th style="padding:5px 8px;color:var(--text3);text-align:left;">Depreciation</th><th style="padding:5px 8px;color:var(--text3);text-align:left;">Book Value</th></tr></thead><tbody>${rows}${life > 10 ? `<tr><td colspan="3" style="padding:5px 8px;color:var(--text3);font-size:11px;">... ${life - 10} more years</td></tr>` : ''}</tbody></table>
    `;
  } else if (method === 'dv') {
    const rate = dvRate / 100;
    let bv = cost;
    rows = Array.from({ length: Math.min(Math.ceil(life), 10) }, (_, i) => {
      const depr = Math.max(+(bv * rate).toFixed(2), 0);
      bv = Math.max(+(bv - depr).toFixed(2), salvage);
      return `<tr><td style="padding:5px 8px;color:var(--text3);">Year ${i+1}</td><td style="padding:5px 8px;font-family:'DM Mono',monospace;color:var(--danger);">${fmt(depr)}</td><td style="padding:5px 8px;font-family:'DM Mono',monospace;">${fmt(bv)}</td></tr>`;
    }).join('');
    el.innerHTML = `
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px;">Diminishing Value · ${dvRate}% per year</div>
        <div style="font-size:13px;">Year 1 depreciation: <strong style="font-family:'DM Mono',monospace;color:var(--danger);">${fmt(cost * rate)}</strong></div>
      </div>
      <table style="width:100%;font-size:12px;"><thead><tr><th style="padding:5px 8px;color:var(--text3);text-align:left;">Period</th><th style="padding:5px 8px;color:var(--text3);text-align:left;">Depreciation</th><th style="padding:5px 8px;color:var(--text3);text-align:left;">Book Value</th></tr></thead><tbody>${rows}</tbody></table>
    `;
  } else {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;">No depreciation will be calculated for this asset.</div>`;
  }
}

// ══════════════════════════════════════════════════════
//  DISPOSAL
// ══════════════════════════════════════════════════════

function openDisposal(assetId) {
  const asset = fixedAssets.find(a => a.id === assetId);
  if (!asset) return;
  document.getElementById('disposal-asset-id').value = assetId;
  document.getElementById('disposal-date').valueAsDate = new Date();
  document.getElementById('disposal-proceeds').value = '';
  const fy = document.getElementById('depr-fy')?.value || '2026';
  const { accum, bookValue } = calcDepreciation(asset, fy);
  document.getElementById('disposal-summary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
      <span style="color:var(--text3);">Asset</span><span style="font-weight:600;">${asset.name}</span>
      <span style="color:var(--text3);">Cost</span><span class="mono">${fmt(asset.cost)}</span>
      <span style="color:var(--text3);">Acc. Depreciation</span><span class="mono" style="color:var(--danger);">${fmt(accum)}</span>
      <span style="color:var(--text3);">Book Value</span><span class="mono" style="font-weight:600;">${fmt(bookValue)}</span>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text3);">Gain/loss on disposal = proceeds minus book value. A journal will be posted automatically.</div>
  `;
  document.getElementById('asset-disposal-modal').classList.add('show');
}

async function confirmDisposal() {
  const assetId  = document.getElementById('disposal-asset-id').value;
  const date     = document.getElementById('disposal-date').value;
  const proceeds = parseFloat(document.getElementById('disposal-proceeds').value) || 0;
  const method   = document.getElementById('disposal-method').value;
  const asset    = fixedAssets.find(a => a.id === assetId);
  if (!asset || !date) { toast('Please fill in all fields'); return; }

  const fy = document.getElementById('depr-fy')?.value || '2026';
  const { accum, bookValue } = calcDepreciation(asset, fy);
  const gainLoss = +(proceeds - bookValue).toFixed(2);

  // Build disposal journal
  // DR  1510 Accumulated Depreciation  (clear accum)
  // DR  1010 Cash at Bank              (if proceeds > 0)
  // CR  1500 Plant & Equipment         (remove cost)
  // CR/DR 4040 Other Revenue / 5060 Loss on Disposal (gain or loss)
  const journalLines = [];
  if (accum > 0) journalLines.push({ accountId: '1510', accountName: 'Accumulated Depreciation - PPE', debit: accum, credit: 0 });
  if (proceeds > 0) journalLines.push({ accountId: '1010', accountName: 'Cash at Bank', debit: proceeds, credit: 0 });
  journalLines.push({ accountId: asset.account || '1500', accountName: 'Plant & Equipment', debit: 0, credit: asset.cost });
  if (gainLoss > 0)       journalLines.push({ accountId: '4040', accountName: 'Gain on Disposal', debit: 0, credit: gainLoss });
  else if (gainLoss < 0)  journalLines.push({ accountId: '5060', accountName: 'Loss on Disposal', debit: Math.abs(gainLoss), credit: 0 });

  const journal = {
    id: uid(), date,
    ref: `DISP-${asset.name.slice(0,6).toUpperCase().replace(/\s/g,'')}-${uid().slice(0,4)}`,
    narration: `Disposal of ${asset.name} — ${method}${proceeds ? ' · Proceeds ' + fmt(proceeds) : ''}`,
    lines: journalLines,
    total: journalLines.reduce((s,l) => s+l.debit, 0),
    gst: 'no', createdAt: new Date().toISOString(),
  };

  journals.unshift(journal);
  await dbSaveJournal(journal);

  // Mark asset as disposed
  asset.disposed = true;
  asset.disposal_date = date;
  asset.disposal_proceeds = proceeds;
  asset.disposal_method = method;
  await dbSaveFixedAsset(asset);

  closeModal('asset-disposal-modal');
  renderAssetRegister();
  renderAssetKpis();
  renderDepreciationSchedule();
  renderAll();
  toast(`✓ ${asset.name} disposed — journal posted${gainLoss !== 0 ? ' · ' + (gainLoss > 0 ? 'Gain' : 'Loss') + ': ' + fmt(Math.abs(gainLoss)) : ''}`);
}

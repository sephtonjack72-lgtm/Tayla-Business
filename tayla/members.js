/* ══════════════════════════════════════════════════════
   Tayla Business — Multi-tenant, Team Access, Currency
   members.js
══════════════════════════════════════════════════════ */

// ── State
let _allBusinesses   = [];  // all businesses this user can access
let _isReadOnly      = false;
let _userRole        = 'owner'; // 'owner' | 'accountant' | 'admin' | 'manager'
let _permissionSet   = 'full_access'; // 'full_access' | 'operations' | 'financials' | 'read_only'

// Permission set definitions
const PERMISSION_SETS = {
  full_access: {
    label:       'Full Access',
    description: 'All tabs — cannot mark bills/invoices paid or post journal entries',
    tabs:        ['dashboard','transactions','journals','ledger','reports','reconcile','invoices','bills','receipts','stocktake','ordering','settings'],
    canMarkPaid: false,
    canPostJournals: false,
    readOnly:    false,
  },
  operations: {
    label:       'Operations',
    description: 'Dashboard, Stocktake, Ordering, Invoices (draft only)',
    tabs:        ['dashboard','stocktake','ordering','invoices','receipts'],
    canMarkPaid: false,
    canPostJournals: false,
    readOnly:    false,
  },
  financials: {
    label:       'Financials',
    description: 'Dashboard, Transactions, Invoices, Bills, Reports, Ledger, Reconcile',
    tabs:        ['dashboard','transactions','journals','ledger','reports','reconcile','invoices','bills','receipts'],
    canMarkPaid: false,
    canPostJournals: false,
    readOnly:    false,
  },
  read_only: {
    label:       'Read Only',
    description: 'All tabs — view only, no create, edit or status changes',
    tabs:        ['dashboard','transactions','journals','ledger','reports','reconcile','invoices','bills','receipts','stocktake','ordering','settings'],
    canMarkPaid: false,
    canPostJournals: false,
    readOnly:    true,
  },
};

// Exchange rates cache
let _exchangeRates   = {};

// ══════════════════════════════════════════════════════
//  MULTI-TENANT — load all businesses for this user
// ══════════════════════════════════════════════════════

async function loadAllBusinesses() {
  if (!_currentUser) return;

  // Businesses owned by this user
  const { data: owned } = await _supabase
    .from('businesses')
    .select('*')
    .eq('user_id', _currentUser.id);

  // Businesses this user is a member of (accountant/admin access)
  const { data: memberships } = await _supabase
    .from('business_members')
    .select('*, businesses(*)')
    .eq('user_id', _currentUser.id)
    .eq('status', 'active');

  const memberBizzes = (memberships || [])
    .map(m => ({ ...m.businesses, _role: m.role, _membershipId: m.id, _permissionSet: m.permission_set || 'full_access' }))
    .filter(Boolean);

  _allBusinesses = [
    ...(owned || []).map(b => ({ ...b, _role: 'owner' })),
    ...memberBizzes.filter(b => !(owned || []).some(o => o.id === b.id)),
  ];

  renderBizSwitcher();
}

function renderBizSwitcher() {
  const wrap    = document.getElementById('biz-switcher-wrap');
  const nameEl  = document.getElementById('biz-switcher-name');
  const listEl  = document.getElementById('biz-switcher-list');
  if (!wrap || !listEl) return;

  // Only show switcher if user has access to 2+ businesses
  if (_allBusinesses.length > 1) {
    wrap.style.display = 'block';
  } else {
    wrap.style.display = 'none';
  }

  if (nameEl && _businessProfile) {
    nameEl.textContent = _businessProfile.biz_name || 'Business';
  }

  if (listEl) {
    listEl.innerHTML = _allBusinesses.map(b => `
      <div onclick="switchBusiness('${b.id}')" style="
        padding:11px 16px;font-size:13px;cursor:pointer;
        display:flex;align-items:center;justify-content:space-between;
        background:${b.id === _businessProfile?.id ? 'var(--surface2)' : ''};
        border-bottom:1px solid var(--border);
      " onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='${b.id === _businessProfile?.id ? 'var(--surface2)' : ''}'">
        <span style="font-weight:${b.id === _businessProfile?.id ? '600' : '400'};">${b.biz_name || 'Unnamed Business'}</span>
        <span style="font-size:11px;color:var(--text3);">${
          b._role === 'owner' ? 'Owner' :
          b._role === 'admin' ? 'Admin' :
          b._role === 'manager' ? `Manager · ${PERMISSION_SETS[b._permissionSet || 'full_access']?.label || 'Full Access'}` :
          '👁 Accountant'
        }</span>
      </div>
    `).join('');
  }
}

function toggleBizSwitcher() {
  const menu = document.getElementById('biz-switcher-menu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('biz-switcher-wrap');
  const menu = document.getElementById('biz-switcher-menu');
  if (wrap && menu && !wrap.contains(e.target)) menu.style.display = 'none';
});

async function switchBusiness(bizId) {
  if (bizId === _businessProfile?.id) {
    document.getElementById('biz-switcher-menu').style.display = 'none';
    return;
  }

  const biz = _allBusinesses.find(b => b.id === bizId);
  if (!biz) return;

  document.getElementById('biz-switcher-menu').style.display = 'none';
  toast(`Switching to ${biz.biz_name}…`);

  _businessProfile = biz;
  _userRole        = biz._role || 'owner';
  _permissionSet   = biz._permissionSet || 'full_access';
  _isReadOnly      = _userRole === 'accountant' || _permissionSet === 'read_only';

  applyProfileToApp(biz);
  applyPermissionSet();
}

function addNewBusiness() {
  document.getElementById('biz-switcher-menu').style.display = 'none';
  initSetupWizard();
  showOverlay('setup');
  // Override save to insert new business (not update)
  document.getElementById('setup-save-btn').onclick = saveNewBusinessFromWizard;
}

async function saveNewBusinessFromWizard() {
  // Reset the onclick back to default saveSetup behaviour
  document.getElementById('setup-save-btn').onclick = saveSetup;
  await saveSetup();
  // Reload businesses after adding
  await loadAllBusinesses();
}

// ══════════════════════════════════════════════════════
//  PERMISSION SET — gates tabs and actions per role
// ══════════════════════════════════════════════════════

function applyPermissionSet() {
  const isOwnerOrAdmin = ['owner', 'admin'].includes(_userRole);
  const perm = isOwnerOrAdmin ? PERMISSION_SETS.full_access : (PERMISSION_SETS[_permissionSet] || PERMISSION_SETS.full_access);

  // ── Banner and role display
  const banner   = document.getElementById('readonly-banner');
  const roleDisp = document.getElementById('user-role-display');
  const setupItem= document.getElementById('menu-setup-item');
  const managerBanner = document.getElementById('manager-banner');

  if (perm.readOnly && !isOwnerOrAdmin) {
    if (banner) banner.style.display = 'block';
    if (managerBanner) managerBanner.style.display = 'none';
  } else if (_userRole === 'manager') {
    if (banner) banner.style.display = 'none';
    if (managerBanner) {
      managerBanner.style.display = 'block';
      const labelEl = document.getElementById('manager-perm-label');
      if (labelEl) labelEl.textContent = `${perm.label} access`;
    }
  } else {
    if (banner)        banner.style.display        = 'none';
    if (managerBanner) managerBanner.style.display  = 'none';
  }

  if (roleDisp)  roleDisp.style.display  = (_userRole !== 'owner') ? 'block' : 'none';
  if (setupItem) setupItem.style.display = isOwnerOrAdmin ? 'block' : 'none';

  // ── Tab visibility — hide tabs not in this permission set
  if (!isOwnerOrAdmin) {
    const tabMap = {
      'dashboard':    ['tab-dashboard'],
      'transactions': ['tab-transactions'],
      'journals':     ['tab-journals'],
      'ledger':       ['tab-ledger'],
      'reports':      ['tab-reports'],
      'reconcile':    ['tab-reconcile'],
      'invoices':     ['tab-invoices'],
      'bills':        ['tab-bills'],
      'receipts':     ['tab-receipts'],
      'stocktake':    ['nav-stocktake-tab'],
      'ordering':     ['nav-ordering-tab'],
      'settings':     ['tab-settings'],
    };
    Object.entries(tabMap).forEach(([key, ids]) => {
      const allowed = perm.tabs.includes(key);
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = allowed ? '' : 'none';
      });
    });
    // Always hide Users report for non-owners
    const usersItem = document.getElementById('reports-users-item');
    if (usersItem) usersItem.style.display = 'none';
  }

  // ── Action gating
  if (perm.readOnly) {
    // Full read-only — disable all mutating buttons and inputs
    document.querySelectorAll(
      '.btn-primary, .btn-accent, .btn-danger, button[onclick*="save"], button[onclick*="Save"], button[onclick*="delete"], button[onclick*="Delete"], button[onclick*="confirm"]'
    ).forEach(btn => {
      if (!btn.id?.includes('login') && !btn.id?.includes('logout')) {
        btn.disabled = true;
        btn.style.opacity = '.4';
        btn.title = 'Read-only access';
      }
    });
    document.querySelectorAll('input:not(#login-email):not(#login-password), select, textarea').forEach(el => {
      el.disabled = true;
    });
  }

  if (!perm.canMarkPaid && !isOwnerOrAdmin) {
    // Hide mark-as-paid buttons on invoices and bills
    document.querySelectorAll(
      'button[onclick*="markPaid"], button[onclick*="markInvoicePaid"], button[onclick*="markBillPaid"], [data-action="mark-paid"]'
    ).forEach(btn => {
      btn.style.display = 'none';
    });
  }

  if (!perm.canPostJournals && !isOwnerOrAdmin) {
    // Hide journal entry save buttons
    document.querySelectorAll(
      'button[onclick*="addTransactionDoubleEntry"], button[onclick*="saveJournal"], button[onclick*="postJournal"]'
    ).forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '.4';
      btn.title = 'Your access level cannot post journal entries';
    });
  }

  _isReadOnly = perm.readOnly;
}

// Keep applyReadOnlyMode as alias for backward compatibility
function applyReadOnlyMode() {
  applyPermissionSet();
}

// ══════════════════════════════════════════════════════
//  TEAM ACCESS — invite members
// ══════════════════════════════════════════════════════

async function loadMembers() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('business_members')
    .select('*')
    .eq('business_id', _businessId);
  if (error) return;
  renderMembersList(data || []);

  // Show Team Access menu item for owners
  const teamItem = document.getElementById('menu-team-item');
  if (teamItem) teamItem.style.display = 'block';
}

function renderMembersList(members) {
  const el = document.getElementById('members-list');
  if (!el) return;
  if (!members.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text3);">No team members yet.</div>';
    return;
  }
  const roleLabel = {
    accountant: '👁 Accountant (read-only)',
    admin:      '⚙ Admin (full access)',
    owner:      '👑 Owner',
    manager:    '🔧 Manager',
  };
  el.innerHTML = members.map(m => {
    const permLabel = m.role === 'manager'
      ? ` · ${PERMISSION_SETS[m.permission_set || 'full_access']?.label || 'Full Access'}`
      : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;font-weight:500;">${m.email}</div>
          <div style="font-size:12px;color:var(--text3);">${roleLabel[m.role] || m.role}${permLabel} · ${m.status === 'pending' ? '⏳ Invite pending' : '✓ Active'}</div>
        </div>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="removeMember('${m.id}')">Remove</button>
      </div>
    `;
  }).join('');
}

async function inviteMember() {
  const email      = document.getElementById('invite-email')?.value.trim();
  const role       = document.getElementById('invite-role')?.value || 'accountant';
  const permSet    = document.getElementById('invite-permission-set')?.value || 'full_access';
  if (!email) { toast('Please enter an email address'); return; }
  if (!_businessId) { toast('No business selected'); return; }

  // Check if already a member
  const { data: existing } = await _supabase
    .from('business_members')
    .select('id')
    .eq('business_id', _businessId)
    .eq('email', email)
    .maybeSingle();

  if (existing) { toast('This person already has access'); return; }

  const { error } = await _supabase.from('business_members').insert({
    id:             uid(),
    business_id:    _businessId,
    email,
    role,
    permission_set: role === 'manager' ? permSet : null,
    status:         'pending',
    invited_by:     _currentUser?.id,
    created_at:     new Date().toISOString(),
  });

  if (error) { toast('Failed to send invite: ' + error.message); return; }

  document.getElementById('invite-email').value = '';
  await loadMembers();
  toast(`✓ Invite sent to ${email}`);
}

async function removeMember(memberId) {
  if (!confirm('Remove this team member\'s access?')) return;
  const { error } = await _supabase.from('business_members').delete().eq('id', memberId);
  if (error) { toast('Failed to remove member'); return; }
  await loadMembers();
  toast('Access removed');
}

// Accept invite — called when an invited user logs in
async function checkPendingInvites() {
  if (!_currentUser?.id) return false;

  // First: activate any invites already matched to this user_id
  const { data: byUserId } = await _supabase
    .from('business_members')
    .select('*')
    .eq('user_id', _currentUser.id)
    .eq('status', 'pending');

  if (byUserId?.length) {
    for (const invite of byUserId) {
      await _supabase.from('business_members')
        .update({ status: 'active' })
        .eq('id', invite.id);
    }
    return true;
  }

  // Second: claim any pending invites matching this user's email
  // We do this via update (not select) since UPDATE policy allows user_id match
  // The invite row has user_id = null until claimed, so we match on email via RPC
  if (_currentUser?.email) {
    const { data: claimed } = await _supabase.rpc('claim_pending_invites', {
      p_email:   _currentUser.email,
      p_user_id: _currentUser.id,
    });
    return !!(claimed && claimed > 0);
  }

  return false;
}

// ══════════════════════════════════════════════════════
//  MULTI-CURRENCY
// ══════════════════════════════════════════════════════

// Show/hide currency row based on settings
function initCurrencyUI() {
  const multiCurrency = appSettings.multiCurrency === 'yes';
  const row = document.getElementById('tx-currency-row');
  if (row) row.style.display = multiCurrency ? 'flex' : 'none';
}

async function fetchExchangeRate(fromCurrency, toCurrency = 'AUD') {
  if (fromCurrency === toCurrency) return 1;
  const cacheKey = `${fromCurrency}_${toCurrency}`;
  if (_exchangeRates[cacheKey]) return _exchangeRates[cacheKey];

  try {
    // Using exchangerate-api free tier
    const res = await fetch(`https://open.er-api.com/v6/latest/${fromCurrency}`);
    const data = await res.json();
    if (data.rates?.[toCurrency]) {
      _exchangeRates[cacheKey] = data.rates[toCurrency];
      return data.rates[toCurrency];
    }
  } catch (e) {
    console.warn('Exchange rate fetch failed:', e);
  }
  return null;
}

async function updateTxExchangeRate() {
  const currency = document.getElementById('tx-currency')?.value;
  const rateInput = document.getElementById('tx-exchange-rate');
  const preview = document.getElementById('tx-currency-preview');
  if (!currency || currency === 'AUD') {
    if (rateInput) rateInput.value = 1;
    if (preview) preview.textContent = '';
    return;
  }

  if (preview) preview.textContent = 'Fetching rate…';
  const rate = await fetchExchangeRate(currency, 'AUD');
  if (rate && rateInput) {
    rateInput.value = rate.toFixed(4);
    updateTxCurrencyPreview();
  } else {
    if (preview) preview.textContent = 'Enter rate manually';
  }
}

function updateTxCurrencyPreview() {
  const currency = document.getElementById('tx-currency')?.value || 'AUD';
  const rate     = parseFloat(document.getElementById('tx-exchange-rate')?.value) || 1;
  const preview  = document.getElementById('tx-currency-preview');
  if (!preview) return;
  if (currency === 'AUD' || rate === 1) { preview.textContent = ''; return; }

  // Get total from debit lines
  let total = 0;
  document.querySelectorAll('#tx-debit-lines .tx-line input[type=number]').forEach(inp => {
    total += parseFloat(inp.value) || 0;
  });

  if (total > 0) {
    preview.textContent = `${currency} ${total.toFixed(2)} = AUD ${(total * rate).toFixed(2)}`;
  }
}

// Apply exchange rate to transaction amounts on save
function applyCurrencyToTransaction(tx) {
  const currency = document.getElementById('tx-currency')?.value || 'AUD';
  const rate     = parseFloat(document.getElementById('tx-exchange-rate')?.value) || 1;
  if (currency === 'AUD' || rate === 1) return tx;

  return {
    ...tx,
    foreign_currency: currency,
    exchange_rate: rate,
    foreign_amount: tx.amount,
    amount: +(tx.amount * rate).toFixed(2),
    debits:  tx.debits?.map(d => ({ ...d, amount: +(d.amount * rate).toFixed(2) })),
    credits: tx.credits?.map(c => ({ ...c, amount: +(c.amount * rate).toFixed(2) })),
  };
}

// ══════════════════════════════════════════════════════
//  FRANCHISE LINKING — Business side
//  Owner enters connector code from Workforce.
//  System validates against Workforce, creates a child
//  businesses row in Business linked to this parent.
// ══════════════════════════════════════════════════════

const _WF_SUPABASE_URL  = 'https://whedwekxzjfqwjuoarid.supabase.co';
const _WF_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoZWR3ZWt4empmcXdqdW9hcmlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MjU3MDEsImV4cCI6MjA5MDUwMTcwMX0.KaNI_pbRwWcL7jF_r4gmyP03CnFuSy5ZV2ZFrftL0QY';
let _wfSupabase = null;

function getWfSupabase() {
  if (!_wfSupabase && typeof supabase !== 'undefined') {
    _wfSupabase = supabase.createClient(_WF_SUPABASE_URL, _WF_SUPABASE_ANON);
  }
  return _wfSupabase;
}

async function testFranchiseCode() {
  const code    = document.getElementById('franchise-connector-code')?.value.trim().toUpperCase();
  const statusEl = document.getElementById('franchise-link-status');
  if (!statusEl) return;
  if (!code) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Enter a connector code first'; return; }

  statusEl.style.color = 'var(--text3)';
  statusEl.textContent = 'Validating…';

  const wf = getWfSupabase();
  const { data, error } = await wf
    .from('businesses')
    .select('id, biz_name, abn, business_connector_code, parent_business_id')
    .eq('business_connector_code', code)
    .maybeSingle();

  if (error || !data) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '✕ Code not found — check you copied it correctly from Tayla Workforce';
    return;
  }

  if (!data.parent_business_id) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '✕ This code belongs to a root business, not a franchise — franchises must have a parent set in Workforce';
    return;
  }

  statusEl.style.color = 'var(--success)';
  statusEl.textContent = `✓ Found "${data.biz_name}" — click Link Franchise to connect`;
  statusEl.dataset.wfBizId   = data.id;
  statusEl.dataset.wfBizName = data.biz_name;
  statusEl.dataset.wfAbn     = data.abn || '';
}

async function linkFranchise() {
  const code     = document.getElementById('franchise-connector-code')?.value.trim().toUpperCase();
  const statusEl = document.getElementById('franchise-link-status');
  if (!code || !statusEl?.dataset.wfBizId) {
    toast('Test the connector code first');
    return;
  }

  const wfBizId   = statusEl.dataset.wfBizId;
  const wfBizName = statusEl.dataset.wfBizName;
  const wfAbn     = statusEl.dataset.wfAbn;

  // Check if already linked
  const { data: existing } = await _supabase
    .from('businesses')
    .select('id')
    .eq('connector_code', code)
    .maybeSingle();

  if (existing) {
    toast('This franchise is already linked to a Business account');
    return;
  }

  // Create a child businesses row in Business Supabase
  const { data: newBiz, error } = await _supabase
    .from('businesses')
    .insert({
      user_id:            _currentUser.id,
      biz_name:           wfBizName,
      abn:                wfAbn || null,
      parent_business_id: _businessId,
      connector_code:     code,
      is_franchise:       true,
      biz_type:           _businessProfile?.biz_type || 'hospitality',
      created_at:         new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    })
    .select()
    .single();

  if (error) { toast('Failed to link: ' + error.message); return; }

  // Mirror the linked_business_id back to Workforce so sales can mirror
  const wf = getWfSupabase();
  await wf.from('businesses')
    .update({ linked_business_id: newBiz.id })
    .eq('id', wfBizId);

  // Add this franchise to _allBusinesses for the switcher
  _allBusinesses.push({ ...newBiz, _role: 'owner' });
  renderBizSwitcher();

  // Clear form
  document.getElementById('franchise-connector-code').value = '';
  statusEl.textContent = '';
  delete statusEl.dataset.wfBizId;
  delete statusEl.dataset.wfBizName;

  await loadFranchises();
  toast(`${wfBizName} linked as a franchise ✓`);
}

async function loadFranchises() {
  const el = document.getElementById('franchise-overview-list');
  if (!el) return;
  if (!_businessId) return;
  if (_userRole !== 'owner') return;

  const { data, error } = await _supabase
    .from('businesses')
    .select('*')
    .eq('parent_business_id', _businessId)
    .eq('is_franchise', true)
    .order('biz_name');

  if (error || !data?.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:12px 0;">No franchise branches linked yet. Use the form below to link one.</div>';
    return;
  }

  el.innerHTML = data.map(f => `
    <div style="display:grid;grid-template-columns:1fr 120px 100px;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:13px;font-weight:600;">${f.biz_name}</div>
        <div style="font-size:11px;color:var(--text3);">${f.abn ? 'ABN ' + f.abn + ' · ' : ''}Code: <span style="font-family:monospace;">${f.connector_code}</span></div>
      </div>
      <div style="font-size:12px;color:var(--success);">✓ Linked</div>
      <button class="btn btn-ghost btn-sm" onclick="switchBusiness('${f.id}')">View Branch</button>
    </div>
  `).join('');
}

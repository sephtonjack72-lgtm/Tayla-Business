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

  // Businesses owned by this user — only ROOT businesses (no parent)
  const { data: owned } = await _supabase
    .from('businesses')
    .select('*')
    .eq('user_id', _currentUser.id)
    .is('parent_business_id', null);

  // Franchise branches owned by this user (child businesses)
  const { data: ownedFranchises } = await _supabase
    .from('businesses')
    .select('*')
    .eq('user_id', _currentUser.id)
    .not('parent_business_id', 'is', null);

  // Businesses this user is an active member of
  const { data: memberships } = await _supabase
    .from('business_members')
    .select('id, role, permission_set, business_id')
    .eq('user_id', _currentUser.id)
    .eq('status', 'active');

  // Fetch the actual business details for memberships separately
  let memberBizzes = [];
  if (memberships?.length) {
    const bizIds = memberships.map(m => m.business_id);
    const { data: memberBizData } = await _supabase
      .from('businesses')
      .select('*')
      .in('id', bizIds);

    memberBizzes = (memberBizData || []).map(biz => {
      const membership = memberships.find(m => m.business_id === biz.id);
      return {
        ...biz,
        _role:          membership?.role || 'accountant',
        _membershipId:  membership?.id,
        _permissionSet: membership?.permission_set || 'full_access',
      };
    }).filter(Boolean);
  }

  // Combine: owned root + owned franchises + member businesses (deduped)
  const ownedIds = new Set([
    ...(owned || []).map(b => b.id),
    ...(ownedFranchises || []).map(b => b.id),
  ]);

  _allBusinesses = [
    ...(owned || []).map(b => ({ ...b, _role: 'owner', _isFranchise: false })),
    ...(ownedFranchises || []).map(b => ({ ...b, _role: 'owner', _isFranchise: true })),
    ...memberBizzes.filter(b => !ownedIds.has(b.id)),
  ];

  renderBizSwitcher();
}

function renderBizSwitcher() {
  const wrap    = document.getElementById('biz-switcher-wrap');
  const nameEl  = document.getElementById('biz-switcher-name');
  const listEl  = document.getElementById('biz-switcher-list');
  if (!wrap || !listEl) return;

  // Only show switcher if user has access to 2+ businesses
  wrap.style.display = _allBusinesses.length > 1 ? 'block' : 'none';

  if (nameEl && _businessProfile) {
    nameEl.textContent = _businessProfile.biz_name || 'Business';
  }

  if (listEl) {
    listEl.innerHTML = _allBusinesses.map(b => {
      const isActive   = b.id === _businessProfile?.id;
      const roleLabel  = b._role === 'owner' && b._isFranchise ? '📍 Branch'
        : b._role === 'owner'   ? '👑 Owner'
        : b._role === 'admin'   ? '⚙ Admin'
        : b._role === 'manager' ? `🔧 Manager · ${PERMISSION_SETS[b._permissionSet || 'full_access']?.label || ''}`
        : '👁 Accountant';
      return `
        <div onclick="switchBusiness('${b.id}')" style="
          padding:11px 16px;font-size:13px;cursor:pointer;
          display:flex;align-items:center;justify-content:space-between;gap:12px;
          background:${isActive ? '#3a3a4a' : 'transparent'};
          border-bottom:1px solid #444455;
          color:#e8e8f0;
        " onmouseover="this.style.background='#3a3a4a'" onmouseout="this.style.background='${isActive ? '#3a3a4a' : 'transparent'}'">
          <div style="min-width:0;">
            <div style="font-weight:${isActive ? '600' : '400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e8e8f0;">
              ${b.biz_name || 'Unnamed Business'}
            </div>
          </div>
          <span style="font-size:11px;color:#9f9fba;white-space:nowrap;flex-shrink:0;">${roleLabel}</span>
        </div>
      `;
    }).join('');
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
  // Show the cancel/back button since user is adding a new business (not first-time setup)
  const cancelBtn = document.getElementById('setup-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'block';
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

  // Activate any invites already matched to this user_id
  const { data: byUserId } = await _supabase
    .from('business_members')
    .select('id')
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

  // Claim pending invites matched by email via secure RPC
  if (_currentUser?.email) {
    const { data: claimed } = await _supabase.rpc('claim_pending_invites', {
      p_email:   _currentUser.email,
      p_user_id: _currentUser.id,
    }).maybeSingle();
    // claimed is the count of rows updated — any number > 0 means success
    return claimed > 0;
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

  try {
    const wf = getWfSupabase();
    const { data, error } = await wf
      .from('businesses')
      .select('id, biz_name, abn, business_connector_code, parent_business_id')
      .eq('business_connector_code', code)
      .maybeSingle();

    if (error) {
      console.error('Franchise code lookup error:', error);
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `✕ Lookup failed (${error.code || error.message}) — the Workforce database may need a policy update. Contact support.`;
      return;
    }

    if (!data) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '✕ Code not found — check you copied it correctly from Tayla Workforce → Business Settings → Franchise list';
      return;
    }

    if (!data.parent_business_id) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = '✕ This code belongs to a root business, not a franchise — only franchise branches can be linked';
      return;
    }

    statusEl.style.color = 'var(--success)';
    statusEl.textContent = `✓ Found "${data.biz_name}" — click Link Franchise to connect`;
    statusEl.dataset.wfBizId   = data.id;
    statusEl.dataset.wfBizName = data.biz_name;
    statusEl.dataset.wfAbn     = data.abn || '';

  } catch (e) {
    console.error('testFranchiseCode exception:', e);
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = '✕ Connection failed — check your internet connection';
  }
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

  // Create a child businesses row via RPC (bypasses RLS INSERT restriction)
  const { data: rpcResult, error } = await _supabase.rpc('create_franchise_business', {
    p_user_id:            _currentUser.id,
    p_biz_name:           wfBizName,
    p_abn:                wfAbn || null,
    p_parent_business_id: _businessId,
    p_connector_code:     code,
    p_biz_type:           _businessProfile?.biz_type || 'hospitality',
  });

  if (error) { toast('Link failed: ' + (error.message || error.code)); console.error('linkFranchise error:', error); return; }

  const newBiz = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

  // Mirror the linked_business_id back to Workforce so sales can mirror
  const wf = getWfSupabase();
  await wf.from('businesses')
    .update({ linked_business_id: newBiz.id })
    .eq('id', wfBizId);

  // ── Sync Workforce users to Business members
  // Fetch all active users on this franchise from Workforce
  const { data: wfUsers } = await wf
    .from('business_users')
    .select('user_id, email, role')
    .eq('business_id', wfBizId)
    .eq('status', 'active');

  // Role mapping: Workforce → Business
  const roleMap = {
    owner:           'admin',    // franchise owner gets admin in Business
    franchise:       'admin',    // franchise role → admin
    manager:         'manager',  // manager → manager (Full Access set)
    payroll_officer: null,       // payroll-only, no Business access
  };

  if (wfUsers?.length) {
    const membersToInsert = wfUsers
      .map(u => {
        const bizRole = roleMap[u.role];
        if (!bizRole) return null; // skip payroll_officer
        return {
          id:             uid(),
          business_id:    newBiz.id,
          user_id:        u.user_id || null,
          email:          u.email,
          role:           bizRole,
          permission_set: bizRole === 'manager' ? 'full_access' : null,
          status:         u.user_id ? 'active' : 'pending',
          invited_by:     _currentUser.id,
          created_at:     new Date().toISOString(),
        };
      })
      .filter(Boolean);

    if (membersToInsert.length) {
      const { error: memberErr } = await _supabase
        .from('business_members')
        .insert(membersToInsert);
      if (memberErr) console.warn('Member sync partial error:', memberErr.message);
    }
  }

  const syncCount = (wfUsers || []).filter(u => roleMap[u.role]).length;

  // Add this franchise to _allBusinesses for the switcher
  _allBusinesses.push({ ...newBiz, _role: 'owner' });
  renderBizSwitcher();

  // Clear form
  document.getElementById('franchise-connector-code').value = '';
  statusEl.textContent = '';
  delete statusEl.dataset.wfBizId;
  delete statusEl.dataset.wfBizName;

  await loadFranchises();
  toast(`${wfBizName} linked ✓${syncCount ? ` · ${syncCount} Workforce user${syncCount !== 1 ? 's' : ''} synced` : ''}`);
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
    <div style="padding:12px 0;border-bottom:1px solid var(--border);">
      <div style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;margin-bottom:8px;">
        <div>
          <div style="font-size:13px;font-weight:600;">${f.biz_name}</div>
          <div style="font-size:11px;color:var(--text3);">${f.abn ? 'ABN ' + f.abn + ' · ' : ''}Code: <span style="font-family:monospace;">${f.connector_code}</span></div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="font-size:12px;color:var(--success);">✓ Linked</span>
          <button class="btn btn-ghost btn-sm" onclick="syncFranchiseUsers('${f.id}','${f.connector_code}')" title="Re-sync users from Workforce">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Sync Users
          </button>
          <button class="btn btn-ghost btn-sm" onclick="switchBusiness('${f.id}')">View Branch</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Re-sync Workforce users to a franchise Business account
// Called manually when new users are added to the franchise in Workforce after initial link
async function syncFranchiseUsers(bizId, connectorCode) {
  const wf = getWfSupabase();

  // Find the Workforce business by connector code
  const { data: wfBiz } = await wf
    .from('businesses')
    .select('id')
    .eq('business_connector_code', connectorCode)
    .maybeSingle();

  if (!wfBiz) { toast('Could not find matching Workforce franchise'); return; }

  // Fetch all active Workforce users for this franchise
  const { data: wfUsers } = await wf
    .from('business_users')
    .select('user_id, email, role')
    .eq('business_id', wfBiz.id)
    .eq('status', 'active');

  if (!wfUsers?.length) { toast('No active users found in Workforce for this franchise'); return; }

  const roleMap = {
    owner:           'admin',
    franchise:       'admin',
    manager:         'manager',
    payroll_officer: null,
  };

  // Get existing Business members for this franchise to avoid duplicates
  const { data: existing } = await _supabase
    .from('business_members')
    .select('email')
    .eq('business_id', bizId);

  const existingEmails = new Set((existing || []).map(m => m.email));

  const toInsert = wfUsers
    .map(u => {
      const bizRole = roleMap[u.role];
      if (!bizRole) return null;
      if (existingEmails.has(u.email)) return null; // already synced
      return {
        id:             uid(),
        business_id:    bizId,
        user_id:        u.user_id || null,
        email:          u.email,
        role:           bizRole,
        permission_set: bizRole === 'manager' ? 'full_access' : null,
        status:         u.user_id ? 'active' : 'pending',
        invited_by:     _currentUser.id,
        created_at:     new Date().toISOString(),
      };
    })
    .filter(Boolean);

  if (!toInsert.length) {
    toast('All Workforce users are already synced');
    return;
  }

  const { error } = await _supabase.from('business_members').insert(toInsert);
  if (error) { toast('Sync failed: ' + error.message); return; }

  toast(`${toInsert.length} user${toInsert.length !== 1 ? 's' : ''} synced from Workforce ✓`);
}

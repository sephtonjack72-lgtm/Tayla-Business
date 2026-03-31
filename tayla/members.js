/* ══════════════════════════════════════════════════════
   Tayla Business — Multi-tenant, Team Access, Currency
   members.js
══════════════════════════════════════════════════════ */

// ── State
let _allBusinesses   = [];  // all businesses this user can access
let _isReadOnly      = false;
let _userRole        = 'owner'; // 'owner' | 'accountant' | 'admin'

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
    .map(m => ({ ...m.businesses, _role: m.role, _membershipId: m.id }))
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
        <span style="font-size:11px;color:var(--text3);">${b._role === 'owner' ? 'Owner' : b._role === 'admin' ? 'Admin' : '👁 Accountant'}</span>
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
  _userRole = biz._role || 'owner';
  _isReadOnly = _userRole === 'accountant';

  applyProfileToApp(biz);
  applyReadOnlyMode();
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
//  READ-ONLY MODE (Accountant access)
// ══════════════════════════════════════════════════════

function applyReadOnlyMode() {
  const banner   = document.getElementById('readonly-banner');
  const roleDisp = document.getElementById('user-role-display');
  const setupItem= document.getElementById('menu-setup-item');

  if (_isReadOnly) {
    if (banner)    banner.style.display    = 'block';
    if (roleDisp)  roleDisp.style.display  = 'block';
    if (setupItem) setupItem.style.display = 'none';

    // Disable all save/edit/delete buttons
    document.querySelectorAll(
      '.btn-primary, .btn-accent, .btn-danger, button[onclick*="save"], button[onclick*="Save"], button[onclick*="delete"], button[onclick*="Delete"], button[onclick*="confirm"]'
    ).forEach(btn => {
      if (!btn.id?.includes('login') && !btn.id?.includes('logout')) {
        btn.disabled = true;
        btn.style.opacity = '.4';
        btn.title = 'Read-only — accountant access';
      }
    });

    // Disable all inputs and selects in forms
    document.querySelectorAll('input:not(#login-email):not(#login-password), select, textarea').forEach(el => {
      el.disabled = true;
    });

    toast('👁 Accountant view — read only');
  } else {
    if (banner)    banner.style.display    = 'none';
    if (roleDisp)  roleDisp.style.display  = 'none';
    if (setupItem) setupItem.style.display = 'block';
  }
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
  const roleLabel = { accountant: '👁 Accountant (read-only)', admin: '⚙ Admin (full access)', owner: '👑 Owner' };
  el.innerHTML = members.map(m => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:13px;font-weight:500;">${m.email}</div>
        <div style="font-size:12px;color:var(--text3);">${roleLabel[m.role] || m.role} · ${m.status === 'pending' ? '⏳ Invite pending' : '✓ Active'}</div>
      </div>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="removeMember('${m.id}')">Remove</button>
    </div>
  `).join('');
}

async function inviteMember() {
  const email = document.getElementById('invite-email')?.value.trim();
  const role  = document.getElementById('invite-role')?.value || 'accountant';
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
    id: uid(),
    business_id: _businessId,
    email,
    role,
    status: 'pending',
    invited_by: _currentUser?.id,
    created_at: new Date().toISOString(),
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
  if (!_currentUser?.email) return false;
  const { data: pending } = await _supabase
    .from('business_members')
    .select('*')
    .eq('email', _currentUser.email)
    .eq('status', 'pending');

  if (!pending?.length) return false;

  // Activate pending invites for this user
  for (const invite of pending) {
    await _supabase.from('business_members')
      .update({ status: 'active', user_id: _currentUser.id })
      .eq('id', invite.id);
  }

  return true; // signals that invites were activated
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

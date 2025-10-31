// ===== Config for endpoints (adjust if your backend differs) =====
const USERS_ENDPOINT = '/users'; // POST {email, role} -> 201/200

let originalSettings = null;

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function showMsg(el, text, type) {
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  el.classList.remove('success', 'error');
  el.classList.add(type === 'error' ? 'error' : 'success');
}
function clearMsg(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
  el.classList.remove('success', 'error');
}

function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

// ----- Tabs -----
function activate(tabId) {
  const tabs   = $all('.vtab[role="tab"]');
  const panels = $all('.tab-panel[role="tabpanel"]');
  tabs.forEach(btn => {
    const isActive = (btn.dataset.tab === tabId);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  panels.forEach(p => {
    const isTarget = (p.id === `tab-${tabId}`);
    // Support both strategies
    p.hidden = !isTarget;
    p.classList.toggle('tab-panel-active', isTarget);
  });
}
function initTabs() {
  const tabs = $all('.vtab[role="tab"]');
  const panels = $all('.tab-panel[role="tabpanel"]');
  // Wire
  tabs.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(btn);
      if (e.key === 'ArrowDown') { e.preventDefault(); tabs[(idx + 1) % tabs.length].focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); tabs[(idx - 1 + tabs.length) % tabs.length].focus(); }
      if (e.key === 'Home')      { e.preventDefault(); tabs[0].focus(); }
      if (e.key === 'End')       { e.preventDefault(); tabs[tabs.length - 1].focus(); }
    });
  });
  // Default to General
  activate('general');
}

// ----- API -----
async function fetchSettings() {
  const res = await fetch('/api/settings', { credentials: 'include' });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('You are not signed in or lack permission to view settings.');
    let msg = 'Failed to load settings.'; try { const j = await res.json(); msg = j.message || j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
async function saveSettings(partial) {
  const body = { ...originalSettings, ...partial };
  const res = await fetch('/api/settings', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = 'Could not save settings.'; try { const j = await res.json(); msg = j.message || j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ----- Populate -----
function populateForms(s) {
  originalSettings = { ...s };
  const emailEl = $('#admin_email');
  const freqEl  = $('#reminder_freq_minutes');
  if (emailEl) emailEl.value = s.admin_email ?? '';
  if (freqEl)  freqEl.value  = Number(s.reminder_freq_minutes ?? 180);

  // Table prefs from localStorage
  const defSel = $('#table_rows_default');
  const rememberCb = $('#table_rows_remember');
  const savedDefault = localStorage.getItem('table.pageSize.default') || '50';
  const savedRemember = localStorage.getItem('table.pageSize.rememberLast') === 'true';
  if (defSel) defSel.value = savedDefault;
  if (rememberCb) rememberCb.checked = savedRemember;
}

// ----- Forms: General -----
function wireGeneralForm() {
  const form = $('#formGeneral');
  const emailEl = $('#admin_email');
  const saveBtn = $('#saveGeneralBtn');
  const resetBtn = $('#resetGeneralBtn');
  const msgEl = $('#generalMsg');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault(); clearMsg(msgEl);
    const email = (emailEl?.value || '').trim();
    if (!isValidEmail(email)) return showMsg(msgEl, 'Please enter a valid email address.', 'error');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      const saved = await saveSettings({ admin_email: email });
      originalSettings = saved;
      showMsg(msgEl, 'Saved successfully.', 'success');
    } catch (err) { showMsg(msgEl, err.message || 'Failed to save.', 'error'); }
    finally { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; } }
  });

  resetBtn?.addEventListener('click', () => {
    clearMsg(msgEl);
    if (emailEl) { emailEl.value = originalSettings?.admin_email ?? ''; emailEl.focus(); }
  });
}

// ----- Forms: Reminders -----
function wireRemindersForm() {
  const form = $('#formReminders');
  const freqEl = $('#reminder_freq_minutes');
  const saveBtn = $('#saveRemindersBtn');
  const resetBtn = $('#resetRemindersBtn');
  const msgEl = $('#remindersMsg');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault(); clearMsg(msgEl);
    const val = Number((freqEl?.value || '').trim());
    if (!Number.isFinite(val) || val < 1 || val > 1440) return showMsg(msgEl, 'Frequency must be a number between 1 and 1440.', 'error');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      const saved = await saveSettings({ reminder_freq_minutes: val });
      originalSettings = saved;
      showMsg(msgEl, 'Saved successfully.', 'success');
    } catch (err) { showMsg(msgEl, err.message || 'Failed to save.', 'error'); }
    finally { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; } }
  });

  resetBtn?.addEventListener('click', () => {
    clearMsg(msgEl);
    if (freqEl) { freqEl.value = Number(originalSettings?.reminder_freq_minutes ?? 180); freqEl.focus(); }
  });
}

// ----- Forms: Table prefs (localStorage only) -----
function wireTableForm() {
  const form = $('#formTable');
  const defSel = $('#table_rows_default');
  const rememberCb = $('#table_rows_remember');
  const saveBtn = $('#saveTableBtn');
  const resetBtn = $('#resetTableBtn');
  const msgEl = $('#tableMsg');

  form?.addEventListener('submit', (e) => {
    e.preventDefault(); clearMsg(msgEl);
    const size = defSel?.value || '50';
    const remember = !!rememberCb?.checked;
    localStorage.setItem('table.pageSize.default', size);
    localStorage.setItem('table.pageSize.rememberLast', String(remember));
    showMsg(msgEl, 'Table preferences saved.', 'success');
  });

  resetBtn?.addEventListener('click', () => {
    clearMsg(msgEl);
    localStorage.removeItem('table.pageSize.default');
    localStorage.removeItem('table.pageSize.rememberLast');
    if (defSel) defSel.value = '50';
    if (rememberCb) rememberCb.checked = false;
    showMsg(msgEl, 'Table preferences reset to defaults (50 rows).', 'success');
  });
}

// ----- Forms: Users (Add user) -----
function wireUsersForm() {
  const form    = document.getElementById('formUsers');
  const emailEl = document.getElementById('user_email');
  const roleEl  = document.getElementById('user_role');
  const pwEl    = document.getElementById('user_password');
  const addBtn  = document.getElementById('addUserBtn');
  const resetBtn= document.getElementById('resetUserBtn');
  const msgEl   = document.getElementById('usersMsg');
  const togglePw= document.getElementById('toggleUserPw');

  // show/hide password
  togglePw?.addEventListener('click', () => {
    const isPw = pwEl.type === 'password';
    pwEl.type = isPw ? 'text' : 'password';
    togglePw.textContent = isPw ? 'Hide' : 'Show';
    togglePw.setAttribute('aria-pressed', String(isPw));
    pwEl.focus();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgEl);

    const email = (emailEl?.value || '').trim();
    const role  = (roleEl?.value  || '').trim();
    const pw    = (pwEl?.value    || '').trim();

    if (!isValidEmail(email)) {
      showMsg(msgEl, 'Please enter a valid email address.', 'error');
      return;
    }
    if (!pw || pw.length < 8) {
      showMsg(msgEl, 'Password must be at least 8 characters.', 'error');
      return;
    }
    if (!role) {
      showMsg(msgEl, 'Please choose a role.', 'error');
      return;
    }

    if (addBtn) { addBtn.disabled = true; addBtn.textContent = 'Adding…'; }
    try {
      const payload = {
        email: document.getElementById('user_email').value.trim(),
        password: document.getElementById('user_password').value.trim(),
        role: document.getElementById('user_role').value, // "admin" | "user"
        };

      const res = await fetch('/users', {
        method: 'POST', 
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        });

      if (!res.ok) {
        const text = await res.text();       // see exactly what FastAPI returned
        throw new Error(text || 'Add user failed');
        }
    

      showMsg(msgEl, 'User added successfully.', 'success');
      if (emailEl) emailEl.value = '';
      if (roleEl)  roleEl.value  = 'viewer';
      if (pwEl)    pwEl.value    = '';

    } catch (err) {
      showMsg(msgEl, err.message || 'Failed to add user.', 'error');
    } finally {
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add user'; }
    }
  });

  resetBtn?.addEventListener('click', () => {
    clearMsg(msgEl);
    if (emailEl) emailEl.value = '';
    if (roleEl)  roleEl.value  = 'viewer';
    if (pwEl)    pwEl.value    = '';
  });
}

// ----- Init -----
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();

  // Ensure at least one panel is visible
  const g = $('#tab-general'); const r = $('#tab-reminders');
  if (g && r && g.hidden && r.hidden) g.hidden = false;

  // Load server-side settings
  try {
    const s = await fetchSettings();
    populateForms(s);
  } catch (err) {
    const msgEl = $('#generalMsg') || $('#remindersMsg') || $('#tableMsg') || $('#usersMsg');
    showMsg(msgEl, err.message || 'Failed to load settings.', 'error');
    if ((err.message || '').toLowerCase().includes('not signed in')) {
      setTimeout(() => { window.location.replace('homepage.html#signin'); }, 1200);
    }
  }

  wireGeneralForm();
  wireRemindersForm();
  wireTableForm();
  wireUsersForm();
});

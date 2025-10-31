// Frontend/settings.js

// ----- Server settings -----
const adminEmailEl = document.getElementById('admin_email');
const freqEl       = document.getElementById('reminder_freq_minutes');
const serverSave   = document.getElementById('serverSaveBtn');
const serverReload = document.getElementById('serverReloadBtn');
const serverStatus = document.getElementById('serverStatus');
const serverHint   = document.getElementById('serverHint');

async function loadServerSettings() {
  serverStatus.textContent = "· loading…";
  serverStatus.className = "note";
  try {
    const res = await fetch('/api/settings', { credentials: 'include' });
    if (!res.ok) {
      const txt = await res.text();
      serverStatus.textContent = "· unavailable";
      serverStatus.className = "note danger";
      serverHint.textContent = `Server settings could not be loaded (${res.status}).`;
      return;
    }
    const data = await res.json();
    adminEmailEl.value = data.admin_email || '';
    freqEl.value       = data.reminder_freq_minutes ?? 180;
    serverStatus.textContent = "· ready";
    serverStatus.className = "note ok";
    serverHint.textContent = "Operator access required to save.";
  } catch (e) {
    serverStatus.textContent = "· offline";
    serverStatus.className = "note danger";
    serverHint.textContent = "Server not reachable from this browser.";
  }
}

async function saveServerSettings() {
  const payload = {
    admin_email: (adminEmailEl.value || '').trim(),
    reminder_freq_minutes: parseInt(freqEl.value, 10) || 180
  };

  if (!payload.admin_email) {
    alert("Please provide a notification email.");
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const txt = await res.text();
      alert(`Save failed: ${res.status}\n${txt}`);
      return;
    }
    await loadServerSettings();
    alert('Server settings saved.');
  } catch (e) {
    alert('Network error while saving server settings: ' + e.message);
  }
}

// ----- Local preferences (browser only) -----
const prefPageSizeEl    = document.getElementById('pref_page_size');
const prefStatusEl      = document.getElementById('pref_status_filter');
const prefShowDeletedEl = document.getElementById('pref_show_deleted');
const prefsSave         = document.getElementById('prefsSaveBtn');
const prefsReset        = document.getElementById('prefsResetBtn');

const LS_KEYS = {
  pageSize: 'FMS_PREF_PAGE_SIZE',
  status:   'FMS_PREF_STATUS',
  del:      'FMS_PREF_SHOW_DELETED'
};

function loadLocalPrefs() {
  const sz  = localStorage.getItem(LS_KEYS.pageSize);
  const st  = localStorage.getItem(LS_KEYS.status);
  const del = localStorage.getItem(LS_KEYS.del);

  if (sz)  prefPageSizeEl.value = sz;
  if (st !== null) prefStatusEl.value = st;
  if (del !== null) prefShowDeletedEl.value = del;
}

function saveLocalPrefs() {
  localStorage.setItem(LS_KEYS.pageSize, prefPageSizeEl.value);
  localStorage.setItem(LS_KEYS.status,   prefStatusEl.value);
  localStorage.setItem(LS_KEYS.del,      prefShowDeletedEl.value);
  alert('Preferences saved. These apply when you open the FMS table.');
}

function resetLocalPrefs() {
  localStorage.removeItem(LS_KEYS.pageSize);
  localStorage.removeItem(LS_KEYS.status);
  localStorage.removeItem(LS_KEYS.del);
  prefPageSizeEl.value    = "100";
  prefStatusEl.value      = "";
  prefShowDeletedEl.value = "false";
  alert('Preferences reset.');
}

// ----- Wire events -----
serverReload?.addEventListener('click', loadServerSettings);
serverSave?.addEventListener('click', saveServerSettings);
prefsSave?.addEventListener('click', saveLocalPrefs);
prefsReset?.addEventListener('click', resetLocalPrefs);

// ----- Init -----
loadServerSettings();
loadLocalPrefs();


// ----- Users (admin only) -----
const newUserEmailEl = document.getElementById('new_user_email');
const newUserPwdEl   = document.getElementById('new_user_password');
const newUserRoleEl  = document.getElementById('new_user_role');
const createUserBtn  = document.getElementById('createUserBtn');
const reloadUsersBtn = document.getElementById('reloadUsersBtn');
const usersTbody     = document.getElementById('usersTbody');
const usersHint      = document.getElementById('usersHint');

async function loadUsers() {
  usersTbody.innerHTML = `<tr><td colspan="3" style="padding:.5rem;color:#666;">Loading…</td></tr>`;
  try {
    const res = await fetch('/api/users', { credentials: 'include' });
    if (!res.ok) {
      usersTbody.innerHTML = `<tr><td colspan="3" style="padding:.5rem;color:#a33;">${res.status} — cannot load users</td></tr>`;
      return;
    }
    const data = await res.json(); // expect [{email, role, created_at}]
    usersTbody.innerHTML = (data.length ? data : []).map(u => `
      <tr>
        <td style="padding:.5rem;border-bottom:1px solid #f1f1f1;">${u.email}</td>
        <td style="padding:.5rem;border-bottom:1px solid #f1f1f1;">${u.role}</td>
        <td style="padding:.5rem;border-bottom:1px solid #f1f1f1;">${u.created_at || ''}</td>
      </tr>
    `).join('') || `<tr><td colspan="3" style="padding:.5rem;color:#666;">No users.</td></tr>`;
  } catch (e) {
    usersTbody.innerHTML = `<tr><td colspan="3" style="padding:.5rem;color:#a33;">Network error loading users</td></tr>`;
  }
}

async function createUser() {
  const email = (newUserEmailEl.value || '').trim();
  const password = (newUserPwdEl.value || '').trim();
  const role = newUserRoleEl.value;

  if (!email || !password) {
    alert('Email and password required.');
    return;
  }

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, role })
    });
    if (!res.ok) {
      const txt = await res.text();
      alert(`Create failed: ${res.status}\n${txt}`);
      return;
    }
    newUserEmailEl.value = '';
    newUserPwdEl.value = '';
    newUserRoleEl.value = 'user';
    await loadUsers();
    alert('User created.');
  } catch (e) {
    alert('Network error while creating user: ' + e.message);
  }
}

reloadUsersBtn?.addEventListener('click', loadUsers);
createUserBtn?.addEventListener('click', createUser);

// initialize users list (non-fatal if unauthorized)
loadUsers();

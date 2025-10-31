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

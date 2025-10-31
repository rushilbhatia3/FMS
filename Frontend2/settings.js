let originalSettings = null;

/* Vertical tabs (accessible) */
function initTabs() {
  const tabs = Array.from(document.querySelectorAll('.vtab[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('.tab-panel[role="tabpanel"]'));

  function activate(tabId) {
    tabs.forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    panels.forEach(p => {
      const isTarget = p.id === `tab-${tabId}`;
      p.hidden = !isTarget;
    });
  }

  tabs.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(btn);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        tabs[(idx + 1) % tabs.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        tabs[(idx - 1 + tabs.length) % tabs.length].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        tabs[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        tabs[tabs.length - 1].focus();
      }
    });
  });
  // default active set in HTML
}

/* API */
async function fetchSettings() {
  const res = await fetch('/api/settings', { credentials: 'include' });
  if (!res.ok) {
    let msg = 'Failed to load settings.';
    try { const j = await res.json(); msg = j.message || j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function saveSettings(partial) {
  const body = { ...originalSettings, ...partial };
  const res = await fetch('/api/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = 'Could not save settings.';
    try { const j = await res.json(); msg = j.message || j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/* Helpers */
function populateForms(s) {
  originalSettings = { ...s };
  document.getElementById('admin_email').value = s.admin_email ?? '';
  document.getElementById('reminder_freq_minutes').value = Number(s.reminder_freq_minutes ?? 180);
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function showMsg(el, text, type) {
  el.hidden = false;
  el.textContent = text;
  el.classList.remove('success', 'error');
  el.classList.add(type === 'error' ? 'error' : 'success');
}
function clearMsg(el) {
  el.hidden = true;
  el.textContent = '';
  el.classList.remove('success', 'error');
}

/* Wire forms */
function wireGeneralForm() {
  const form = document.getElementById('formGeneral');
  const emailEl = document.getElementById('admin_email');
  const saveBtn = document.getElementById('saveGeneralBtn');
  const resetBtn = document.getElementById('resetGeneralBtn');
  const msgEl = document.getElementById('generalMsg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgEl);

    const email = emailEl.value.trim();
    if (!isValidEmail(email)) {
      showMsg(msgEl, 'Please enter a valid email address.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const saved = await saveSettings({ admin_email: email });
      originalSettings = saved;
      showMsg(msgEl, 'Saved successfully.', 'success');
    } catch (err) {
      showMsg(msgEl, err.message || 'Failed to save.', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    }
  });

  resetBtn.addEventListener('click', () => {
    clearMsg(msgEl);
    emailEl.value = originalSettings?.admin_email ?? '';
    emailEl.focus();
  });
}

function wireRemindersForm() {
  const form = document.getElementById('formReminders');
  const freqEl = document.getElementById('reminder_freq_minutes');
  const saveBtn = document.getElementById('saveRemindersBtn');
  const resetBtn = document.getElementById('resetRemindersBtn');
  const msgEl = document.getElementById('remindersMsg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgEl);

    const val = Number(freqEl.value.trim());
    if (!Number.isFinite(val) || val < 1 || val > 1440) {
      showMsg(msgEl, 'Frequency must be a number between 1 and 1440.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const saved = await saveSettings({ reminder_freq_minutes: val });
      originalSettings = saved;
      showMsg(msgEl, 'Saved successfully.', 'success');
    } catch (err) {
      showMsg(msgEl, err.message || 'Failed to save.', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    }
  });

  resetBtn.addEventListener('click', () => {
    clearMsg(msgEl);
    freqEl.value = Number(originalSettings?.reminder_freq_minutes ?? 180);
    freqEl.focus();
  });
}

/* Init */
(async function init() {
  initTabs();

  try {
    const s = await fetchSettings();
    populateForms(s);
  } catch (err) {
    const msgEl = document.getElementById('generalMsg');
    showMsg(msgEl, err.message || 'Failed to load settings.', 'error');
  }

  wireGeneralForm();
  wireRemindersForm();
})();

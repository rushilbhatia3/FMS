(async function maybeForwardToApp() {
    try {
      const r = await fetch('/api/session/me', { credentials: 'include' });
      if (r.ok) {
        // already signed in -> skip homepage
        window.location.replace('index.html');
      }
    } catch (_) { /* ignore; stay on homepage */ }
  })();

  const sessionModalEl       = document.getElementById('sessionModal');
  const homeLoginBtn         = document.getElementById('homeLoginBtn');
  const sessionClose         = document.getElementById('sessionClose');

  const sessionTabOperator   = document.getElementById('sessionTabOperator');
  const sessionTabViewer     = document.getElementById('sessionTabViewer');
  const sessionPanelOperator = document.getElementById('sessionPanelOperator');
  const sessionPanelViewer   = document.getElementById('sessionPanelViewer');

  const opEmailEl    = document.getElementById('opEmail');
  const opPasswordEl = document.getElementById('opPassword');
  const opFormEl     = document.getElementById('sessionOperatorForm');
  const opErrorEl    = document.getElementById('opError');

  const viewerEmailEl    = document.getElementById('viewerEmail');
  const viewerPasswordEl = document.getElementById('viewerPassword');
  const viewerFormEl     = document.getElementById('sessionViewerForm');
  const viewerErrorEl    = document.getElementById('viewerError');

  function openModal(which = 'operator') {
    sessionModalEl.hidden = false;
    document.body.style.overflow = 'hidden';
    if (which === 'viewer') {
      sessionTabViewer.classList.add('active');
      sessionTabOperator.classList.remove('active');
      sessionPanelViewer.hidden = false;
      sessionPanelOperator.hidden = true;
    } else {
      sessionTabOperator.classList.add('active');
      sessionTabViewer.classList.remove('active');
      sessionPanelOperator.hidden = false;
      sessionPanelViewer.hidden = true;
    }
  }
  function closeModal() {
    sessionModalEl.hidden = true;
    document.body.style.overflow = '';
    if (location.hash === '#signin') history.replaceState(null, '', location.pathname);
  }

  // Open via button or deep-link (#signin or #viewer)
  if (location.hash === '#signin') openModal('operator');
  if (location.hash === '#viewer') openModal('viewer');
  homeLoginBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    openModal('operator');
  });
  sessionClose?.addEventListener('click', closeModal);

  sessionTabOperator?.addEventListener('click', () => openModal('operator'));
  sessionTabViewer?.addEventListener('click', () => openModal('viewer'));

  // Submit handlers → log in → go to app
  async function handleLogin(formEl, emailEl, passEl, errorEl) {
    errorEl.textContent = '';
    const payload = { email: emailEl.value.trim(), password: passEl.value };
    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Login failed');
      }
      window.location.replace('index.html');
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
    }
  }

  opFormEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin(opFormEl, opEmailEl, opPasswordEl, opErrorEl);
  });
  viewerFormEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin(viewerFormEl, viewerEmailEl, viewerPasswordEl, viewerErrorEl);
  });
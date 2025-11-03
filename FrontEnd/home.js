// If already signed in, skip homepage
(async function maybeForwardToApp() {
  try {
    const r = await fetch('/api/session/me', { credentials: 'include' });
    if (r.ok) window.location.replace('index.html');
  } catch (_) { /* stay on homepage */ }
})();

document.addEventListener('DOMContentLoaded', () => {
  const form       = document.getElementById('loginForm');
  const emailEl    = document.getElementById('email');
  const pwEl       = document.getElementById('password');
  const togglePw   = document.getElementById('togglePw');
  const errorEl    = document.getElementById('loginError');
  const loginBtn   = document.getElementById('homeLoginBtn');

  // Toggle password visibility (accessible)
  togglePw?.addEventListener('click', () => {
    const isPw = pwEl.type === 'password';
    pwEl.type = isPw ? 'text' : 'password';
    togglePw.textContent = isPw ? 'Hide' : 'Show';
    togglePw.setAttribute('aria-pressed', String(isPw));
    pwEl.focus();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    errorEl.textContent = '';

    const email = emailEl.value.trim();
    const password = pwEl.value;

    if (!email || !password) {
      errorEl.textContent = 'Please enter both email and password.';
      errorEl.hidden = false;
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    try {
      const res = await fetch('/api/session/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        // Try to parse error JSON; fall back to generic text
        let msg = 'Login failed. Check your credentials.';
        try {
          const err = await res.json();
          if (err && (err.message || err.detail)) {
            msg = err.message || err.detail;
          }
        } catch (_) {}
        throw new Error(msg);
      }

      // success → go to app
      window.location.replace('index.html');
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
      errorEl.hidden = false;
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in';
    }
  });
});

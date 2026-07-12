(function () {
  // Never keep credentials in the URL (browser history / logs).
  if (window.location.search) {
    history.replaceState(null, '', window.location.pathname);
  }

  document.getElementById('toggle-password').addEventListener('click', () => {
    const input = document.getElementById('password-input');
    const btn = document.getElementById('toggle-password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
      });
      if (res.ok) {
        window.location.href = '/';
        return;
      }
      const data = await res.json();
      errEl.textContent = data.error || 'Login failed';
      errEl.classList.remove('hidden');
    } catch {
      errEl.textContent = 'Network error';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
})();

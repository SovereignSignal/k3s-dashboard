document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const password = document.getElementById('password').value;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        window.location.href = '/';
      } else {
        errorEl.textContent = data.error || 'Login failed';
      }
    } catch (err) {
      errorEl.textContent = 'Connection error';
    }
  });
});

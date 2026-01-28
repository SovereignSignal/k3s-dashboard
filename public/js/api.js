const api = {
  async request(method, url, body) {
    const opts = {
      method,
      headers: {},
      credentials: 'same-origin',
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Unauthorized');
    }
    return res;
  },

  async get(url) {
    const res = await this.request('GET', url);
    return res.json();
  },

  async getText(url) {
    const res = await this.request('GET', url);
    return res.text();
  },

  async post(url, body) {
    const res = await this.request('POST', url, body);
    return res.json();
  },

  async del(url) {
    const res = await this.request('DELETE', url);
    return res.json();
  },
};

function showAlert(container, message, type = 'error') {
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = message;
  // Remove after 5 seconds
  setTimeout(() => div.remove(), 5000);
  container.prepend(div);
}

function formatBytes(gb) {
  if (gb >= 1) return gb.toFixed(1) + ' Gi';
  const mb = gb * 1024;
  if (mb >= 1) return mb.toFixed(0) + ' Mi';
  return (mb * 1024).toFixed(0) + ' Ki';
}

function formatCpu(cores) {
  if (cores >= 1) return cores.toFixed(2);
  return (cores * 1000).toFixed(0) + 'm';
}

function pctClass(pct) {
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return '';
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'running' || s === 'ready' || s === 'active' || s === 'true') return 'status-ready';
  if (s === 'pending') return 'status-pending';
  if (s === 'failed' || s === 'error' || s === 'false') return 'status-failed';
  if (s === 'succeeded') return 'status-succeeded';
  if (s === 'terminating') return 'status-terminating';
  return 'status-unknown';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

// Theme management
function getTheme() {
  return localStorage.getItem('theme') || 'dark';
}

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.querySelector('.theme-toggle-switch');
  if (toggle) {
    toggle.setAttribute('aria-checked', theme === 'light');
  }
}

function toggleTheme() {
  const current = getTheme();
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// Set active sidebar link and initialize theme
document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  setTheme(getTheme());

  // Set active nav link
  const path = window.location.pathname.replace(/\/$/, '') || '/index.html';
  document.querySelectorAll('.sidebar-nav a').forEach((a) => {
    const href = a.getAttribute('href').replace(/\/$/, '');
    if (path === href || (path === '/' && href === '/index.html')) {
      a.classList.add('active');
    }
  });

  // Setup theme toggle click handler
  const toggle = document.querySelector('.theme-toggle-switch');
  if (toggle) {
    toggle.addEventListener('click', toggleTheme);
  }
});

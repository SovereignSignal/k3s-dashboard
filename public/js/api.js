// API wrapper
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

  async patch(url, body) {
    const res = await this.request('PATCH', url, body);
    return res.json();
  },

  async del(url) {
    const res = await this.request('DELETE', url);
    return res.json();
  },
};

// ============================================================================
// Toast Notifications
// ============================================================================
const toast = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  },

  show(options) {
    this.init();
    const { type = 'info', title, message, duration = 4000 } = options;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <div class="toast-icon">
        ${this.getIcon(type)}
      </div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <div class="toast-close" role="button" aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </div>
    `;

    el.querySelector('.toast-close').addEventListener('click', () => this.dismiss(el));
    this.container.appendChild(el);

    if (duration > 0) {
      setTimeout(() => this.dismiss(el), duration);
    }

    return el;
  },

  dismiss(el) {
    if (!el || el.classList.contains('exiting')) return;
    el.classList.add('exiting');
    setTimeout(() => el.remove(), 200);
  },

  getIcon(type) {
    const icons = {
      success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
      error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
      warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>',
      info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>',
    };
    return icons[type] || icons.info;
  },

  success(title, message) { return this.show({ type: 'success', title, message }); },
  error(title, message) { return this.show({ type: 'error', title, message }); },
  warning(title, message) { return this.show({ type: 'warning', title, message }); },
  info(title, message) { return this.show({ type: 'info', title, message }); },
};

// ============================================================================
// Confirmation Dialog
// ============================================================================
function confirm(options) {
  return new Promise((resolve) => {
    const { title, message, resource, confirmText = 'Confirm', danger = false } = options;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal ${danger ? 'modal-danger' : ''}">
        <div class="modal-header">
          <h3>${title}</h3>
          <div class="modal-close" role="button" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </div>
        </div>
        <div class="modal-body">
          <p>${message}</p>
          ${resource ? `<div class="confirm-resource">${resource}</div>` : ''}
        </div>
        <div class="modal-actions">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${confirmText}</button>
        </div>
      </div>
    `;

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('.modal-close').addEventListener('click', () => close(false));
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

    // Keyboard handling
    const handleKeydown = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    document.addEventListener('keydown', handleKeydown);
    overlay.addEventListener('remove', () => document.removeEventListener('keydown', handleKeydown));

    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="confirm"]').focus();
  });
}

// ============================================================================
// Command Palette
// ============================================================================
const commandPalette = {
  overlay: null,
  input: null,
  results: null,
  selectedIndex: 0,
  commands: [],

  init() {
    if (this.overlay) return;

    this.commands = [
      { id: 'overview', title: 'Go to Overview', desc: 'Dashboard home', icon: 'home', action: () => window.location.href = '/index.html', group: 'Navigation' },
      { id: 'nodes', title: 'Go to Nodes', desc: 'View cluster nodes', icon: 'server', action: () => window.location.href = '/nodes.html', group: 'Navigation' },
      { id: 'workloads', title: 'Go to Workloads', desc: 'Manage deployments & pods', icon: 'layers', action: () => window.location.href = '/workloads.html', group: 'Navigation' },
      { id: 'storage', title: 'Go to Storage', desc: 'Manage volumes & classes', icon: 'database', action: () => window.location.href = '/storage.html', group: 'Navigation' },
      { id: 'network', title: 'Go to Network', desc: 'Network monitoring', icon: 'activity', action: () => window.location.href = '/network.html', group: 'Navigation' },
      { id: 'devices', title: 'Go to Devices', desc: 'LAN device inventory', icon: 'monitor', action: () => window.location.href = '/devices.html', group: 'Navigation' },
      { id: 'alerts', title: 'Go to Alerts', desc: 'View cluster alerts', icon: 'bell', action: () => window.location.href = '/alerts.html', group: 'Navigation' },
      { id: 'namespaces', title: 'Go to Namespaces', desc: 'Manage namespaces', icon: 'folder', action: () => window.location.href = '/namespaces.html', group: 'Navigation' },
      { id: 'deploy', title: 'Deploy YAML', desc: 'Apply Kubernetes manifests', icon: 'upload', action: () => window.location.href = '/deploy.html', group: 'Actions' },
      { id: 'logs', title: 'View Logs', desc: 'Pod log viewer', icon: 'terminal', action: () => window.location.href = '/logs.html', group: 'Actions' },
      { id: 'theme', title: 'Toggle Theme', desc: 'Switch dark/light mode', icon: 'sun', action: () => { toggleTheme(); this.close(); }, group: 'Settings' },
      { id: 'logout', title: 'Logout', desc: 'Sign out of dashboard', icon: 'log-out', action: () => api.post('/api/auth/logout').then(() => window.location.href = '/login.html'), group: 'Settings' },
    ];

    this.overlay = document.createElement('div');
    this.overlay.className = 'command-overlay';
    this.overlay.innerHTML = `
      <div class="command-palette">
        <div class="command-input-wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input type="text" class="command-input" placeholder="Search commands..." autocomplete="off" />
        </div>
        <div class="command-results"></div>
      </div>
    `;

    this.input = this.overlay.querySelector('.command-input');
    this.results = this.overlay.querySelector('.command-results');

    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });

    document.body.appendChild(this.overlay);
    this.render(this.commands);
  },

  open() {
    this.init();
    this.overlay.classList.add('active');
    this.input.value = '';
    this.selectedIndex = 0;
    this.render(this.commands);
    this.input.focus();
  },

  close() {
    if (this.overlay) {
      this.overlay.classList.remove('active');
    }
  },

  toggle() {
    if (this.overlay?.classList.contains('active')) {
      this.close();
    } else {
      this.open();
    }
  },

  filter() {
    const query = this.input.value.toLowerCase().trim();
    if (!query) {
      this.render(this.commands);
      return;
    }
    const filtered = this.commands.filter(cmd =>
      cmd.title.toLowerCase().includes(query) ||
      cmd.desc.toLowerCase().includes(query)
    );
    this.selectedIndex = 0;
    this.render(filtered);
  },

  render(commands) {
    const grouped = {};
    commands.forEach(cmd => {
      if (!grouped[cmd.group]) grouped[cmd.group] = [];
      grouped[cmd.group].push(cmd);
    });

    let html = '';
    let index = 0;
    for (const [group, cmds] of Object.entries(grouped)) {
      html += `<div class="command-group">`;
      html += `<div class="command-group-title">${group}</div>`;
      for (const cmd of cmds) {
        html += `
          <div class="command-item ${index === this.selectedIndex ? 'selected' : ''}" data-index="${index}" data-id="${cmd.id}">
            <div class="command-item-icon">${this.getIcon(cmd.icon)}</div>
            <div class="command-item-content">
              <div class="command-item-title">${cmd.title}</div>
              <div class="command-item-desc">${cmd.desc}</div>
            </div>
          </div>
        `;
        index++;
      }
      html += `</div>`;
    }

    this.results.innerHTML = html || '<div class="command-group"><div class="command-item-desc" style="padding: 1rem; text-align: center;">No commands found</div></div>';

    this.results.querySelectorAll('.command-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const cmd = this.commands.find(c => c.id === id);
        if (cmd) cmd.action();
      });
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = parseInt(item.dataset.index);
        this.updateSelection();
      });
    });
  },

  updateSelection() {
    this.results.querySelectorAll('.command-item').forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
    });
  },

  handleKeydown(e) {
    const items = this.results.querySelectorAll('.command-item');
    const count = items.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % count;
      this.updateSelection();
      items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + count) % count;
      this.updateSelection();
      items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[this.selectedIndex];
      if (item) {
        const id = item.dataset.id;
        const cmd = this.commands.find(c => c.id === id);
        if (cmd) cmd.action();
      }
    } else if (e.key === 'Escape') {
      this.close();
    }
  },

  getIcon(name) {
    const icons = {
      home: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      server: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
      layers: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
      database: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
      activity: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
      folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
      upload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
      terminal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
      sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
      'log-out': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
      monitor: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    };
    return icons[name] || '';
  },
};

// ============================================================================
// Utility Functions
// ============================================================================
function showAlert(container, message, type = 'error') {
  // Use toast instead for non-critical inline alerts
  if (type === 'error') {
    toast.error('Error', message);
  } else if (type === 'success') {
    toast.success('Success', message);
  } else {
    toast.info('Info', message);
  }
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
  if (s === 'succeeded' || s === 'completed') return 'status-succeeded';
  if (s === 'terminating') return 'status-terminating';
  return 'status-unknown';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  const months = Math.floor(days / 30);
  return months + 'mo ago';
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const relative = timeAgo(dateStr);
  const absolute = date.toLocaleString();
  return `<span class="relative-time" title="${absolute}">${relative}</span>`;
}

// ============================================================================
// Theme Management
// ============================================================================
function getTheme() {
  return localStorage.getItem('theme') || 'dark';
}

function setTheme(theme) {
  localStorage.setItem('theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  // Also update color-scheme for native elements
  document.documentElement.style.colorScheme = theme;
  const toggle = document.querySelector('.theme-toggle-switch');
  if (toggle) {
    toggle.setAttribute('aria-checked', theme === 'light');
  }
}

function toggleTheme() {
  const current = getTheme();
  setTheme(current === 'dark' ? 'light' : 'dark');
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore if user is typing in an input
    if (e.target.matches('input, textarea, select')) return;

    // Cmd/Ctrl + K - Command palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }

    // Escape - Close command palette
    if (e.key === 'Escape') {
      commandPalette.close();
      return;
    }

    // Navigation shortcuts (g + key)
    if (e.key === 'g') {
      const handleSecondKey = (e2) => {
        document.removeEventListener('keydown', handleSecondKey);
        const routes = {
          'h': '/index.html',     // g+h = home
          'n': '/nodes.html',     // g+n = nodes
          'w': '/workloads.html', // g+w = workloads
          's': '/storage.html',   // g+s = storage
          'e': '/network.html',   // g+e = network (endpoints)
          'i': '/devices.html',   // g+i = devices (inventory)
          'a': '/alerts.html',    // g+a = alerts
          'd': '/deploy.html',    // g+d = deploy
          'l': '/logs.html',      // g+l = logs
        };
        if (routes[e2.key]) {
          e2.preventDefault();
          window.location.href = routes[e2.key];
        }
      };
      document.addEventListener('keydown', handleSecondKey, { once: true });
      setTimeout(() => document.removeEventListener('keydown', handleSecondKey), 1000);
    }

    // ? - Show keyboard shortcuts help
    if (e.key === '?') {
      showKeyboardHelp();
    }
  });
}

function showKeyboardHelp() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal" style="max-width: 520px;">
      <div class="modal-header">
        <h3>Keyboard Shortcuts</h3>
        <div class="modal-close" role="button" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </div>
      </div>
      <div class="modal-body">
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 0.75rem 1.5rem; font-size: 0.875rem;">
          <div><kbd>⌘</kbd> <kbd>K</kbd></div><div>Open command palette</div>
          <div><kbd>g</kbd> <kbd>h</kbd></div><div>Go to Overview</div>
          <div><kbd>g</kbd> <kbd>n</kbd></div><div>Go to Nodes</div>
          <div><kbd>g</kbd> <kbd>w</kbd></div><div>Go to Workloads</div>
          <div><kbd>g</kbd> <kbd>s</kbd></div><div>Go to Storage</div>
          <div><kbd>g</kbd> <kbd>e</kbd></div><div>Go to Network</div>
          <div><kbd>g</kbd> <kbd>i</kbd></div><div>Go to Devices</div>
          <div><kbd>g</kbd> <kbd>a</kbd></div><div>Go to Alerts</div>
          <div><kbd>g</kbd> <kbd>d</kbd></div><div>Go to Deploy</div>
          <div><kbd>g</kbd> <kbd>l</kbd></div><div>Go to Logs</div>
          <div><kbd>?</kbd></div><div>Show this help</div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" data-action="close">Got it</button>
      </div>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { once: true });

  document.body.appendChild(overlay);
}

// ============================================================================
// Sidebar Icons
// ============================================================================
const sidebarIcons = {
  overview: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  nodes: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="18" r="1" fill="currentColor"/></svg>',
  workloads: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  storage: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  network: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  devices: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  alerts: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
  namespaces: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  deploy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  logs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  backroom: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="8" r="2"/><circle cx="19" cy="8" r="2"/><circle cx="5" cy="16" r="2"/><circle cx="19" cy="16" r="2"/><path d="M7 8h3M14 8h3M7 16h3M14 16h3"/></svg>',
};

// ============================================================================
// Mobile Menu
// ============================================================================
function initMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const menuToggle = document.querySelector('.menu-toggle');
  const backdrop = document.querySelector('.sidebar-backdrop');

  if (!sidebar || !menuToggle) return;

  // Function to close menu
  function closeMenu() {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Function to open menu
  function openMenu() {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // Function to toggle menu
  function toggleMenu() {
    if (sidebar.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  // Toggle menu on button click
  menuToggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  });

  // Close on backdrop click
  if (backdrop) {
    backdrop.addEventListener('click', closeMenu);
  }

  // Close on nav link click (mobile)
  sidebar.querySelectorAll('.sidebar-nav a').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMenu();
      }
    });
  });

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      closeMenu();
    }
  });

  // Close menu on window resize if larger than mobile
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && sidebar.classList.contains('open')) {
      closeMenu();
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  setTheme(getTheme());

  // Initialize keyboard shortcuts
  initKeyboardShortcuts();

  // Initialize mobile menu
  initMobileMenu();

  // Set active nav link and add icons
  const path = window.location.pathname.replace(/\/$/, '') || '/index.html';
  document.querySelectorAll('.sidebar-nav a').forEach((a) => {
    const href = a.getAttribute('href').replace(/\/$/, '');
    if (path === href || (path === '/' && href === '/index.html') || (path === '/index.html' && href === '/')) {
      a.classList.add('active');
    }

    // Add icon to nav link
    const iconName = a.dataset.icon;
    if (iconName && sidebarIcons[iconName]) {
      a.innerHTML = sidebarIcons[iconName] + '<span>' + a.textContent + '</span>';
    }
  });

  // Setup theme toggle click handler
  const toggle = document.querySelector('.theme-toggle-switch');
  if (toggle) {
    toggle.addEventListener('click', toggleTheme);
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('tabindex', '0');
    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTheme();
      }
    });
  }

  // Setup command palette shortcut hint
  const shortcutHint = document.querySelector('.sidebar-shortcut');
  if (shortcutHint) {
    shortcutHint.addEventListener('click', () => commandPalette.open());
  }
});

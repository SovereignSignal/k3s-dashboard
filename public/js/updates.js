document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

let pollTimer = null;
let pollInterval = 30000; // 30s idle, 2s during updates
let lastLogCount = 0;

async function loadStatus() {
  try {
    const state = await api.get('/api/updates/status');
    renderSummary(state);
    renderNodeDetails(state);
    renderActions(state);
    renderProgress(state);
    renderLogs(state);

    // Adjust polling speed
    const isActive = state.status === 'updating' || state.status === 'checking';
    const newInterval = isActive ? 2000 : 30000;
    if (newInterval !== pollInterval) {
      pollInterval = newInterval;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = setInterval(loadStatus, pollInterval);
      }
    }
  } catch (err) {
    toast.error('Error', 'Failed to load update status');
  }
}

function renderSummary(state) {
  const osTotal = Object.values(state.versions.os).reduce((sum, n) => sum + Math.max(0, n.upgradable), 0);
  const k3sCurrent = state.versions.k3s.current || '-';
  const k3sLatest = state.versions.k3s.latest || '-';

  const statusColors = {
    idle: 'var(--text-muted)',
    checking: 'var(--color-warning)',
    updating: 'var(--color-warning)',
    error: 'var(--color-error)',
    complete: 'var(--color-success)',
  };
  const statusLabel = (state.status || 'idle').charAt(0).toUpperCase() + (state.status || 'idle').slice(1);

  document.getElementById('summary-cards').innerHTML = `
    <div class="card">
      <div class="card-title">OS Packages</div>
      <div class="card-value" style="color: ${osTotal > 0 ? 'var(--color-warning)' : 'var(--color-success)'}">${osTotal > 0 ? osTotal + ' upgradable' : 'Up to date'}</div>
    </div>
    <div class="card">
      <div class="card-title">K3s Current</div>
      <div class="card-value" style="font-size: 1.1rem;">${k3sCurrent}</div>
    </div>
    <div class="card">
      <div class="card-title">K3s Latest</div>
      <div class="card-value" style="font-size: 1.1rem; color: ${k3sLatest !== '-' && k3sLatest !== k3sCurrent ? 'var(--color-warning)' : 'var(--color-success)'}">${k3sLatest}</div>
    </div>
    <div class="card">
      <div class="card-title">Status</div>
      <div class="card-value" style="color: ${statusColors[state.status] || 'var(--text-muted)'}">${statusLabel}${state.operation ? ' (' + state.operation + ')' : ''}</div>
    </div>
  `;
}

function renderNodeDetails(state) {
  const el = document.getElementById('node-details');
  const osInfo = state.versions.os || {};
  const k3sInfo = state.versions.k3s || {};

  const nodeNames = [...new Set([
    ...Object.keys(osInfo),
    ...Object.keys(k3sInfo.perNode || {}),
  ])].sort();

  if (!nodeNames.length) {
    el.innerHTML = '<p class="text-muted">Click "Check for Updates" to scan nodes.</p>';
    return;
  }

  let html = `<table class="table">
    <thead>
      <tr>
        <th>Node</th>
        <th>K3s Version</th>
        <th>OS Packages Upgradable</th>
        <th>Last Checked</th>
      </tr>
    </thead>
    <tbody>`;

  for (const name of nodeNames) {
    const os = osInfo[name] || {};
    const k3sVer = (k3sInfo.perNode || {})[name] || '-';
    const upgradable = os.upgradable != null ? (os.upgradable >= 0 ? os.upgradable : 'Error') : '-';
    const lastChecked = os.lastChecked ? formatRelativeTime(os.lastChecked) : '-';
    const upgradableStyle = os.upgradable > 0
      ? 'color: var(--color-warning); font-weight: 600;'
      : '';

    html += `<tr>
      <td><strong>${name}</strong></td>
      <td>${k3sVer}</td>
      <td style="${upgradableStyle}">${upgradable}${os.upgradable > 0 ? ` <span class="text-muted text-sm">(${os.packages.slice(0, 5).join(', ')}${os.packages.length > 5 ? '...' : ''})</span>` : ''}</td>
      <td>${lastChecked}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderActions(state) {
  const busy = state.status === 'updating' || state.status === 'checking';
  const osTotal = Object.values(state.versions.os).reduce((sum, n) => sum + Math.max(0, n.upgradable), 0);
  const k3sInfo = state.versions.k3s || {};
  const hasK3sUpdate = k3sInfo.latest && k3sInfo.current && k3sInfo.latest !== k3sInfo.current;

  document.getElementById('btn-check').disabled = busy;
  document.getElementById('btn-os-update').disabled = busy || osTotal === 0;
  document.getElementById('btn-k3s-upgrade').disabled = busy || !hasK3sUpdate;

  const label = document.getElementById('k3s-target-label');
  if (hasK3sUpdate) {
    label.textContent = `→ ${k3sInfo.latest}`;
  } else if (k3sInfo.latest) {
    label.textContent = 'Already on latest';
  } else {
    label.textContent = '';
  }
}

function renderProgress(state) {
  const section = document.getElementById('progress-section');
  const logSection = document.getElementById('log-section');

  if (state.status === 'idle' && !state.completedAt && !state.error) {
    section.style.display = 'none';
    logSection.style.display = 'none';
    return;
  }

  section.style.display = '';
  logSection.style.display = '';

  const title = document.getElementById('progress-title');
  const resetBtn = document.getElementById('btn-reset');

  if (state.operation === 'os-update') {
    title.textContent = 'OS Update Progress';
  } else if (state.operation === 'k3s-upgrade') {
    title.textContent = 'K3s Upgrade Progress';
  } else {
    title.textContent = 'Progress';
  }

  // Show reset button when complete or error
  resetBtn.style.display = (state.status === 'complete' || state.status === 'error') ? '' : 'none';

  const content = document.getElementById('progress-content');
  const order = state.nodeOrder || [];

  if (!order.length) {
    content.innerHTML = '<p class="text-muted">No operation data.</p>';
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 1rem;">';

  for (const name of order) {
    const node = state.nodes[name];
    if (!node) continue;

    const statusIcon = getNodeStatusIcon(node.status);
    const roleLabel = node.role === 'server' ? 'control-plane' : 'worker';

    html += `<div style="border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem;">
      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;">
        ${statusIcon}
        <strong>${name}</strong>
        <span class="text-sm text-muted">(${roleLabel})</span>
        ${node.error ? `<span class="text-sm" style="color: var(--color-error); margin-left: auto;">${escapeHtml(node.error)}</span>` : ''}
      </div>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">`;

    for (const step of node.steps) {
      const stepIcon = getStepIcon(step.status);
      const stepClass = step.status === 'in-progress' ? 'color: var(--color-warning);' :
                        step.status === 'complete' ? 'color: var(--color-success);' :
                        step.status === 'error' ? 'color: var(--color-error);' : 'color: var(--text-muted);';
      html += `<span style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; padding: 0.25rem 0.5rem; background: var(--bg-tertiary); border-radius: var(--radius); ${stepClass}" title="${escapeHtml(step.output || '')}">
        ${stepIcon} ${step.name}
      </span>`;
    }

    html += '</div></div>';
  }

  html += '</div>';

  // Overall timing
  if (state.startedAt) {
    const elapsed = state.completedAt
      ? Math.round((new Date(state.completedAt) - new Date(state.startedAt)) / 1000)
      : Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    html += `<p class="text-sm text-muted mt-1">Elapsed: ${mins}m ${secs}s</p>`;
  }

  content.innerHTML = html;
}

function renderLogs(state) {
  const el = document.getElementById('log-output');
  if (!state.logs || !state.logs.length) {
    el.textContent = 'No log entries yet.';
    return;
  }

  const shouldScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;

  el.innerHTML = state.logs.map((log) => {
    const ts = new Date(log.timestamp).toLocaleTimeString();
    const levelColor = log.level === 'error' ? 'var(--color-error)' :
                       log.level === 'warn' ? 'var(--color-warning)' : 'var(--text-secondary)';
    const nodePrefix = log.node ? `[${log.node}] ` : '';
    return `<div style="color: ${levelColor}"><span class="text-muted">${ts}</span> ${nodePrefix}${escapeHtml(log.message)}</div>`;
  }).join('');

  // Auto-scroll if near bottom or new logs appeared
  if (shouldScroll || state.logs.length > lastLogCount) {
    el.scrollTop = el.scrollHeight;
  }
  lastLogCount = state.logs.length;
}

function getNodeStatusIcon(status) {
  switch (status) {
    case 'complete':
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>';
    case 'in-progress':
      return '<span class="spinner" style="width: 18px; height: 18px;"></span>';
    case 'error':
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
    case 'skipped':
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>';
    default:
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
  }
}

function getStepIcon(status) {
  switch (status) {
    case 'complete':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
    case 'in-progress':
      return '<span class="spinner" style="width: 12px; height: 12px;"></span>';
    case 'error':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    default:
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="4"/></svg>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function checkForUpdates() {
  const btn = document.getElementById('btn-check');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px;"></span> Checking...';

  try {
    await api.post('/api/updates/check');
    toast.success('Check Complete', 'Update information refreshed');
    await loadStatus();
  } catch (err) {
    toast.error('Check Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg> Check for Updates`;
  }
}

async function startOsUpdate() {
  const confirmed = await window.confirm({
    title: 'Start Rolling OS Update',
    message: 'This will update OS packages on each node one at a time. Each node will be cordoned and drained before updating. This may take several minutes.',
    confirmText: 'Start Update',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api.post('/api/updates/start/os');
    toast.info('OS Update Started', 'Rolling update is in progress');
    pollInterval = 2000;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(loadStatus, pollInterval);
    await loadStatus();
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function startK3sUpgrade() {
  let state;
  try {
    state = await api.get('/api/updates/status');
  } catch (_) {}

  const version = state?.versions?.k3s?.latest;
  if (!version) {
    toast.error('Error', 'Latest k3s version not known. Run "Check for Updates" first.');
    return;
  }

  const confirmed = await window.confirm({
    title: 'Start K3s Upgrade',
    message: `This will upgrade k3s to <strong>${version}</strong> on all nodes. The server node is upgraded first, then agent nodes. The API server will briefly be unavailable during the server upgrade.`,
    confirmText: 'Start Upgrade',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api.post('/api/updates/start/k3s', { version });
    toast.info('K3s Upgrade Started', `Upgrading to ${version}`);
    pollInterval = 2000;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(loadStatus, pollInterval);
    await loadStatus();
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function resetState() {
  try {
    await api.post('/api/updates/reset');
    toast.success('Reset', 'Update state cleared');
    await loadStatus();
  } catch (err) {
    toast.error('Reset Failed', err.message);
  }
}

// Initial load and polling
loadStatus();
pollTimer = setInterval(loadStatus, pollInterval);

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

let currentApps = [];
let scaleAppId = null;

async function loadApps() {
  try {
    currentApps = await api.get('/api/apps');
    renderSummary(currentApps);
    renderApps(currentApps);
  } catch (err) {
    toast.error('Error', err.message);
  }
}

function renderSummary(apps) {
  const total = apps.length;
  const running = apps.filter(a => a.status === 'running').length;
  const stopped = apps.filter(a => a.status === 'stopped').length;
  const errors = apps.filter(a => a.status === 'error' || a.status === 'not_found').length;

  document.getElementById('summary-cards').innerHTML = `
    <div class="card">
      <div class="card-title">Total Apps</div>
      <div class="card-value">${total}</div>
    </div>
    <div class="card">
      <div class="card-title">Running</div>
      <div class="card-value" style="color: var(--color-success)">${running}</div>
    </div>
    <div class="card">
      <div class="card-title">Stopped</div>
      <div class="card-value text-muted">${stopped}</div>
    </div>
    <div class="card">
      <div class="card-title">Errors</div>
      <div class="card-value" style="color: var(--color-error)">${errors}</div>
    </div>
  `;
}

function appStatusBadge(status) {
  const map = {
    running: 'status-ready',
    degraded: 'status-pending',
    stopped: 'status-unknown',
    error: 'status-failed',
    not_found: 'status-failed',
    unknown: 'status-unknown',
  };
  const cls = map[status] || 'status-unknown';
  const label = status === 'not_found' ? 'Not Found' : status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function renderApps(apps) {
  const el = document.getElementById('apps-grid');

  if (!apps.length) {
    el.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 3rem;">
        <div style="font-size: 2rem; margin-bottom: 1rem;">No apps installed</div>
        <p class="text-muted">Deploy an app template to get started.</p>
        <a href="/deploy.html" class="btn btn-primary mt-2">Go to Deploy</a>
      </div>
    `;
    return;
  }

  el.innerHTML = '<div class="grid grid-3">' + apps.map(app => {
    const podInfo = app.pods && app.pods.length
      ? `${app.pods.filter(p => p.ready).length}/${app.pods.length} pods ready`
      : 'No pods';

    const totalRestarts = (app.pods || []).reduce((sum, p) => sum + (p.restarts || 0), 0);

    const configBtn = app.hasConfig
      ? `<button class="btn btn-sm" onclick="reconfigureApp('${app.instanceId}')" title="Reconfigure">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
           </svg>
           Configure
         </button>`
      : '';

    // Find deployment resource for logs link
    const deployRes = (app.resources || []).find(r => r.kind === 'Deployment');
    const firstPod = (app.pods || [])[0];
    const logsLink = firstPod
      ? `<a href="/logs.html?namespace=${app.namespace}&pod=${firstPod.name}" class="btn btn-sm" title="View Logs">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
           </svg>
           Logs
         </a>`
      : '';

    return `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1.5rem;">${app.icon || ''}</span>
            <div>
              <div style="font-weight: 600; font-size: 1.05rem;">${app.templateName}</div>
              <div class="text-sm text-muted">${app.namespace}</div>
            </div>
          </div>
          ${appStatusBadge(app.status)}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.85rem;">
          <div>
            <span class="text-muted">Replicas:</span> ${app.replicas.ready}/${app.replicas.desired}
          </div>
          <div>
            <span class="text-muted">Pods:</span> ${podInfo}
          </div>
          <div>
            <span class="text-muted">Restarts:</span> ${totalRestarts}
          </div>
          <div>
            <span class="text-muted">Installed:</span> ${formatRelativeTime(app.installedAt)}
          </div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; border-top: 1px solid var(--border); padding-top: 0.75rem;">
          <button class="btn btn-sm" onclick="restartApp('${app.instanceId}')" title="Restart">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Restart
          </button>
          <button class="btn btn-sm" onclick="showScaleModal('${app.instanceId}', ${app.replicas.desired})" title="Scale">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="20" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            Scale
          </button>
          ${configBtn}
          ${logsLink}
          <button class="btn btn-sm btn-danger" onclick="uninstallApp('${app.instanceId}')" title="Uninstall" style="margin-left: auto;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
            Uninstall
          </button>
        </div>
      </div>
    `;
  }).join('') + '</div>';
}

async function restartApp(instanceId) {
  const app = currentApps.find(a => a.instanceId === instanceId);
  if (!app) return;

  const confirmed = await window.confirm({
    title: 'Restart App',
    message: `This will delete all pods for <strong>${app.templateName}</strong> and let Kubernetes recreate them.`,
    confirmText: 'Restart',
  });
  if (!confirmed) return;

  try {
    await api.post(`/api/apps/${instanceId}/restart`);
    toast.success('Restarting', `${app.templateName} pods are being recreated`);
    setTimeout(loadApps, 3000);
  } catch (err) {
    toast.error('Restart failed', err.message);
  }
}

function showScaleModal(instanceId, currentReplicas) {
  scaleAppId = instanceId;
  const app = currentApps.find(a => a.instanceId === instanceId);
  document.getElementById('scale-app-name').textContent = app ? app.templateName : instanceId;
  document.getElementById('scale-replicas').value = currentReplicas;
  document.getElementById('scale-modal').classList.add('active');
  document.getElementById('scale-replicas').focus();
}

function closeScaleModal() {
  document.getElementById('scale-modal').classList.remove('active');
  scaleAppId = null;
}

async function doScale() {
  if (!scaleAppId) return;
  const replicas = parseInt(document.getElementById('scale-replicas').value, 10);
  if (isNaN(replicas) || replicas < 0) {
    toast.error('Invalid', 'Please enter a valid number of replicas');
    return;
  }

  try {
    await api.post(`/api/apps/${scaleAppId}/scale`, { replicas });
    toast.success('Scaled', `Replicas set to ${replicas}`);
    closeScaleModal();
    setTimeout(loadApps, 2000);
  } catch (err) {
    toast.error('Scale failed', err.message);
  }
}

async function reconfigureApp(instanceId) {
  try {
    const appDetail = await api.get(`/api/apps/${instanceId}`);
    if (!appDetail.templateConfig || !appDetail.templateConfig.length) {
      toast.info('No Config', 'This app has no configurable options');
      return;
    }

    showReconfigureModal(appDetail);
  } catch (err) {
    toast.error('Error', err.message);
  }
}

function showReconfigureModal(app) {
  const existing = document.getElementById('reconfig-modal');
  if (existing) existing.remove();

  const fields = app.templateConfig.map(item => {
    const currentVal = app.configValues[item.id] ?? item.default;
    let input;
    if (item.type === 'select') {
      const options = item.options.map(opt => {
        if (typeof opt === 'string') {
          return `<option value="${opt}" ${opt === currentVal ? 'selected' : ''}>${opt}</option>`;
        }
        return `<option value="${opt.value}" ${opt.value === currentVal ? 'selected' : ''}>${opt.label}</option>`;
      }).join('');
      input = `<select class="form-control" name="${item.id}">${options}</select>`;
    } else if (item.type === 'number') {
      input = `<input type="number" class="form-control" name="${item.id}" value="${currentVal}">`;
    } else {
      input = `<input type="text" class="form-control" name="${item.id}" value="${currentVal}">`;
    }
    const hint = item.hint ? `<div class="hint">${item.hint}</div>` : '';
    return `<div class="form-group"><label>${item.label}</label>${input}${hint}</div>`;
  }).join('');

  const html = `
    <div class="modal-overlay active" id="reconfig-modal">
      <div class="modal modal-config">
        <div class="modal-header">
          <div class="modal-title-group">
            <span class="modal-icon">${app.icon || ''}</span>
            <div>
              <h3>Reconfigure ${app.templateName}</h3>
              <div class="modal-subtitle">Update settings and re-apply manifests</div>
            </div>
          </div>
          <div class="modal-close" onclick="closeReconfigModal()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </div>
        </div>
        <div class="modal-body">
          <form id="reconfig-form">${fields}</form>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" onclick="closeReconfigModal()">Cancel</button>
          <button type="button" class="btn btn-primary" onclick="submitReconfig('${app.instanceId}')">Apply Changes</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('reconfig-modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeReconfigModal();
  });
  document.getElementById('reconfig-modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeReconfigModal();
  });
}

function closeReconfigModal() {
  const modal = document.getElementById('reconfig-modal');
  if (modal) modal.remove();
}

async function submitReconfig(instanceId) {
  const form = document.getElementById('reconfig-form');
  const formData = new FormData(form);
  const config = {};
  for (const [key, value] of formData.entries()) {
    config[key] = value;
  }

  closeReconfigModal();

  try {
    await api.post(`/api/apps/${instanceId}/reconfigure`, { config });
    toast.success('Reconfigured', 'App settings have been updated');
    setTimeout(loadApps, 2000);
  } catch (err) {
    toast.error('Reconfigure failed', err.message);
  }
}

async function uninstallApp(instanceId) {
  const app = currentApps.find(a => a.instanceId === instanceId);
  if (!app) return;

  const hasPVC = (app.resources || []).some(r => r.kind === 'PersistentVolumeClaim');

  // Build confirmation dialog with PVC checkbox
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal modal-danger">
      <div class="modal-header">
        <h3>Uninstall ${app.templateName}</h3>
        <div class="modal-close" role="button" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </div>
      </div>
      <div class="modal-body">
        <p>This will delete all Kubernetes resources for <strong>${app.templateName}</strong>.</p>
        ${hasPVC ? `
          <div class="form-group mt-2">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" id="delete-pvc-check">
              <span>Also delete persistent data (volumes)</span>
            </label>
            <div class="hint">Warning: This permanently deletes all stored data.</div>
          </div>
        ` : ''}
      </div>
      <div class="modal-actions">
        <button class="btn" data-action="cancel">Cancel</button>
        <button class="btn btn-danger" data-action="confirm">Uninstall</button>
      </div>
    </div>
  `;

  const result = await new Promise(resolve => {
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.modal-close').addEventListener('click', () => close(null));
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      const deletePVC = hasPVC ? overlay.querySelector('#delete-pvc-check')?.checked : false;
      close({ deletePVC });
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-action="confirm"]').focus();
  });

  if (!result) return;

  try {
    const url = `/api/apps/${instanceId}${result.deletePVC ? '?deletePVC=true' : ''}`;
    const res = await api.request('DELETE', url);
    const data = await res.json();
    toast.success('Uninstalled', `${app.templateName} has been removed`);
    setTimeout(loadApps, 1000);
  } catch (err) {
    toast.error('Uninstall failed', err.message);
  }
}

// Initial load and auto-refresh
loadApps();
setInterval(loadApps, 15000);

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

async function loadAlerts() {
  try {
    const [alertData, rules] = await Promise.all([
      api.get('/api/alerts'),
      api.get('/api/alerts/rules'),
    ]);
    renderSummary(alertData);
    renderAlerts(alertData.alerts);
    renderRules(rules);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

async function runCheck() {
  try {
    const alertData = await api.post('/api/alerts/check');
    renderSummary(alertData);
    renderAlerts(alertData.alerts);
    showAlert(document.querySelector('.main-content'), 'Alert check completed', 'success');
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

function renderSummary(data) {
  const el = document.getElementById('alert-summary');
  const total = data.counts.critical + data.counts.warning + data.counts.info;
  const healthClass = data.counts.critical > 0 ? 'status-failed' : (data.counts.warning > 0 ? 'status-pending' : 'status-ready');
  const healthText = data.counts.critical > 0 ? 'Critical' : (data.counts.warning > 0 ? 'Warning' : 'Healthy');

  el.innerHTML = `
    <div class="card">
      <div class="card-title">Status</div>
      <div class="card-value"><span class="status-badge ${healthClass}">${healthText}</span></div>
      <div class="text-sm text-muted mt-1">Last check: ${data.lastCheck ? timeAgo(data.lastCheck) : 'never'}</div>
    </div>
    <div class="card">
      <div class="card-title">Critical</div>
      <div class="card-value" style="color: var(--red);">${data.counts.critical}</div>
    </div>
    <div class="card">
      <div class="card-title">Warning</div>
      <div class="card-value" style="color: var(--orange);">${data.counts.warning}</div>
    </div>
    <div class="card">
      <div class="card-title">Total Alerts</div>
      <div class="card-value">${total}</div>
    </div>
  `;
}

function renderAlerts(alerts) {
  const tbody = document.getElementById('alerts-body');
  if (!alerts.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No active alerts - all systems healthy</td></tr>';
    return;
  }

  tbody.innerHTML = alerts.map((a, i) => {
    const sevClass = a.severity === 'critical' ? 'status-failed' : (a.severity === 'warning' ? 'status-pending' : 'status-unknown');
    return `
      <tr>
        <td><span class="status-badge ${sevClass}">${a.severity}</span></td>
        <td>${a.ruleName}</td>
        <td class="mono text-sm">${a.resource}</td>
        <td class="text-sm">${a.message}</td>
        <td class="text-sm text-muted">${timeAgo(a.timestamp)}</td>
        <td><button class="btn btn-sm" onclick="dismissAlert(${i})">Dismiss</button></td>
      </tr>
    `;
  }).join('');
}

function renderRules(rules) {
  const tbody = document.getElementById('rules-body');
  tbody.innerHTML = rules.map(r => {
    const sevClass = r.severity === 'critical' ? 'status-failed' : (r.severity === 'warning' ? 'status-pending' : 'status-unknown');
    return `
      <tr>
        <td>
          <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleRule('${r.id}', this.checked)">
        </td>
        <td>${r.name}</td>
        <td class="text-sm text-muted">${r.description}</td>
        <td><span class="status-badge ${sevClass}">${r.severity}</span></td>
        <td class="text-sm">${r.threshold !== undefined ? r.threshold + '%' : '-'}</td>
      </tr>
    `;
  }).join('');
}

async function toggleRule(ruleId, enabled) {
  try {
    await api.request('PATCH', `/api/alerts/rules/${ruleId}`, { enabled });
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
    loadAlerts(); // Reload to reset checkbox
  }
}

async function dismissAlert(index) {
  try {
    await api.del(`/api/alerts/${index}`);
    loadAlerts();
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

loadAlerts();
// Auto-refresh every 30 seconds
setInterval(loadAlerts, 30000);

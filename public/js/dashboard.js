document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

async function loadDashboard() {
  try {
    const [overview, events] = await Promise.all([
      api.get('/api/cluster/overview'),
      api.get('/api/cluster/events'),
    ]);
    renderSummary(overview);
    renderNodes(overview.nodes.items);
    renderEvents(events);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

function renderSummary(data) {
  const el = document.getElementById('summary-cards');
  const allReady = data.nodes.ready === data.nodes.total;
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Nodes</div>
      <div class="card-value">${data.nodes.ready}<span class="unit"> / ${data.nodes.total} ready</span></div>
    </div>
    <div class="card">
      <div class="card-title">Pods</div>
      <div class="card-value">${data.pods.running}<span class="unit"> / ${data.pods.total} running</span></div>
    </div>
    <div class="card">
      <div class="card-title">Deployments</div>
      <div class="card-value">${data.deployments.total}</div>
    </div>
    <div class="card">
      <div class="card-title">Namespaces</div>
      <div class="card-value">${data.namespaces.total}</div>
    </div>
    <div class="card">
      <div class="card-title">Cluster Health</div>
      <div class="card-value"><span class="status-badge ${allReady ? 'status-ready' : 'status-not-ready'}">${allReady ? 'Healthy' : 'Degraded'}</span></div>
    </div>
  `;
}

function renderNodes(nodes) {
  const el = document.getElementById('node-cards');
  el.innerHTML = nodes.map((n) => {
    const cpuPct = n.cpu.total > 0 ? (n.cpu.used / n.cpu.total * 100) : 0;
    const memPct = n.memory.total > 0 ? (n.memory.used / n.memory.total * 100) : 0;
    return `
      <div class="node-card">
        <div class="node-card-header">
          <h3>${n.name}</h3>
          <span class="status-badge ${n.ready ? 'status-ready' : 'status-not-ready'}">${n.ready ? 'Ready' : 'NotReady'}</span>
        </div>
        <div class="progress-group">
          <div class="progress-label"><span>CPU</span><span>${formatCpu(n.cpu.used)} / ${n.cpu.total.toFixed(0)} cores (${cpuPct.toFixed(0)}%)</span></div>
          <div class="progress-bar"><div class="progress-fill ${pctClass(cpuPct)}" style="width:${Math.min(cpuPct,100)}%"></div></div>
        </div>
        <div class="progress-group">
          <div class="progress-label"><span>Memory</span><span>${formatBytes(n.memory.used)} / ${formatBytes(n.memory.total)} (${memPct.toFixed(0)}%)</span></div>
          <div class="progress-bar"><div class="progress-fill ${pctClass(memPct)}" style="width:${Math.min(memPct,100)}%"></div></div>
        </div>
        <div class="node-meta">
          ${n.roles.length ? n.roles.join(', ') : 'worker'} &middot; ${n.kubeletVersion} &middot; ${n.arch}
        </div>
      </div>
    `;
  }).join('');
}

function renderEvents(events) {
  const tbody = document.getElementById('events-body');
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No recent events</td></tr>';
    return;
  }
  tbody.innerHTML = events.slice(0, 20).map((e) => `
    <tr>
      <td><span class="status-badge ${e.type === 'Warning' ? 'status-not-ready' : 'status-ready'}">${e.type}</span></td>
      <td>${e.reason}</td>
      <td class="mono text-sm">${e.involvedObject}</td>
      <td class="text-sm">${e.message || ''}</td>
      <td class="text-sm text-muted">${timeAgo(e.lastTimestamp)}</td>
    </tr>
  `).join('');
}

loadDashboard();
// Auto-refresh every 30 seconds
setInterval(loadDashboard, 30000);

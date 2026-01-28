document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

async function loadNodes() {
  const container = document.getElementById('nodes-container');
  try {
    const nodes = await api.get('/api/nodes');
    container.innerHTML = '';

    nodes.forEach((n) => {
      const cpuPct = n.cpu.total > 0 ? (n.cpu.used / n.cpu.total * 100) : 0;
      const memPct = n.memory.total > 0 ? (n.memory.used / n.memory.total * 100) : 0;

      const card = document.createElement('div');
      card.className = 'node-card';
      card.style.marginBottom = '1rem';
      card.innerHTML = `
        <div class="node-card-header">
          <h3>${n.name}</h3>
          <span class="status-badge ${n.ready ? 'status-ready' : 'status-not-ready'}">${n.ready ? 'Ready' : 'NotReady'}</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.75rem;">
          <div>
            <div class="progress-group">
              <div class="progress-label"><span>CPU</span><span>${formatCpu(n.cpu.used)} / ${n.cpu.total.toFixed(0)} cores (${cpuPct.toFixed(0)}%)</span></div>
              <div class="progress-bar"><div class="progress-fill ${pctClass(cpuPct)}" style="width:${Math.min(cpuPct,100)}%"></div></div>
            </div>
            <div class="progress-group">
              <div class="progress-label"><span>Memory</span><span>${formatBytes(n.memory.used)} / ${formatBytes(n.memory.total)} (${memPct.toFixed(0)}%)</span></div>
              <div class="progress-bar"><div class="progress-fill ${pctClass(memPct)}" style="width:${Math.min(memPct,100)}%"></div></div>
            </div>
          </div>
          <div class="text-sm">
            <p><strong>Roles:</strong> ${n.roles.length ? n.roles.join(', ') : 'worker'}</p>
            <p><strong>Version:</strong> ${n.kubeletVersion}</p>
            <p><strong>OS:</strong> ${n.os}</p>
            <p><strong>Arch:</strong> ${n.arch}</p>
            <p><strong>Created:</strong> ${timeAgo(n.createdAt)}</p>
            ${n.addresses ? '<p><strong>Addresses:</strong> ' + n.addresses.map(a => a.address).join(', ') + '</p>' : ''}
          </div>
        </div>
        <details>
          <summary class="text-sm" style="cursor:pointer; color:var(--accent);">Conditions</summary>
          <table style="margin-top:0.5rem;">
            <thead><tr><th>Type</th><th>Status</th><th>Message</th></tr></thead>
            <tbody>
              ${n.conditions.map(c => `<tr>
                <td>${c.type}</td>
                <td><span class="status-badge ${statusClass(c.status)}">${c.status}</span></td>
                <td class="text-sm">${c.message || ''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </details>
        <div class="node-pods" id="pods-${n.name}">
          <p class="text-sm text-muted mt-1" style="cursor:pointer; color:var(--accent);" onclick="loadNodePods('${n.name}')">Show pods on this node</p>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

async function loadNodePods(nodeName) {
  const container = document.getElementById(`pods-${nodeName}`);
  try {
    const data = await api.get(`/api/nodes/${nodeName}`);
    if (!data.pods.length) {
      container.innerHTML = '<p class="text-sm text-muted mt-1">No pods on this node</p>';
      return;
    }
    container.innerHTML = `
      <table style="margin-top:0.5rem;">
        <thead><tr><th>Pod</th><th>Namespace</th><th>Status</th><th>Restarts</th></tr></thead>
        <tbody>
          ${data.pods.map(p => `<tr>
            <td class="mono text-sm">${p.name}</td>
            <td>${p.namespace}</td>
            <td><span class="status-badge ${statusClass(p.status)}">${p.status}</span></td>
            <td>${p.restarts}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p class="text-sm" style="color:var(--red);">${err.message}</p>`;
  }
}

loadNodes();

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

async function loadNetwork() {
  try {
    const [stats, ping, services, endpoints] = await Promise.all([
      api.get('/api/network/stats'),
      api.get('/api/network/ping'),
      api.get('/api/network/services'),
      api.get('/api/network/endpoints'),
    ]);
    renderPing(ping);
    renderInterfaces(stats);
    renderServices(services, endpoints);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

function renderPing(results) {
  const el = document.getElementById('ping-cards');
  el.innerHTML = results.map(p => {
    const latencyClass = p.reachable
      ? (p.latency < 5 ? 'status-ready' : (p.latency < 20 ? 'status-pending' : 'status-not-ready'))
      : 'status-failed';
    const latencyText = p.reachable
      ? (p.latency === 0 ? 'local' : p.latency.toFixed(1) + ' ms')
      : 'unreachable';
    return `
      <div class="card">
        <div class="card-title">${p.to}</div>
        <div class="card-value"><span class="status-badge ${latencyClass}">${latencyText}</span></div>
        <div class="text-sm text-muted mt-1">${p.ip || 'localhost'}</div>
      </div>
    `;
  }).join('');
}

function formatRate(bytesPerSec) {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
}

function formatTotal(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function renderInterfaces(nodes) {
  const el = document.getElementById('interface-cards');
  el.innerHTML = nodes.map(node => {
    const ifaceRows = node.interfaces.map(iface => `
      <tr>
        <td class="mono">${iface.name}</td>
        <td class="text-sm">${formatRate(iface.rxRate)}</td>
        <td class="text-sm">${formatRate(iface.txRate)}</td>
        <td class="text-sm text-muted">${formatTotal(iface.rxBytes)}</td>
        <td class="text-sm text-muted">${formatTotal(iface.txBytes)}</td>
      </tr>
    `).join('');

    const ips = node.ips.map(ip => `<span class="mono text-sm">${ip.address}</span>`).join(', ');

    return `
      <div class="card" style="margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 style="font-size: 1rem;">${node.node}</h3>
          <span class="status-badge ${node.reachable ? 'status-ready' : 'status-failed'}">${node.reachable ? 'Online' : 'Offline'}</span>
        </div>
        ${ips ? `<div class="text-sm text-muted mb-1">IPs: ${ips}</div>` : ''}
        ${node.interfaces.length > 0 ? `
          <table style="margin-top: 0.5rem;">
            <thead>
              <tr><th>Interface</th><th>RX Rate</th><th>TX Rate</th><th>RX Total</th><th>TX Total</th></tr>
            </thead>
            <tbody>${ifaceRows}</tbody>
          </table>
        ` : '<div class="text-sm text-muted">No interface data available</div>'}
      </div>
    `;
  }).join('');
}

function renderServices(services, endpoints) {
  const tbody = document.getElementById('services-body');
  if (!services.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No services</td></tr>';
    return;
  }

  // Build endpoint map
  const epMap = {};
  for (const ep of endpoints) {
    epMap[`${ep.namespace}/${ep.name}`] = ep;
  }

  tbody.innerHTML = services.map(svc => {
    const ep = epMap[`${svc.namespace}/${svc.name}`];
    const epStatus = ep
      ? `${ep.ready}/${ep.total}`
      : '-';
    const epClass = ep && ep.total > 0
      ? (ep.ready === ep.total ? 'status-ready' : (ep.ready > 0 ? 'status-pending' : 'status-failed'))
      : 'status-unknown';

    const ports = svc.ports.map(p =>
      `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol}`
    ).join(', ');

    return `
      <tr>
        <td class="mono">${svc.name}</td>
        <td>${svc.namespace}</td>
        <td><span class="status-badge ${svc.type === 'LoadBalancer' ? 'status-ready' : 'status-unknown'}">${svc.type}</span></td>
        <td class="mono text-sm">${svc.clusterIP || '-'}</td>
        <td class="mono text-sm">${svc.externalIP || '-'}</td>
        <td class="text-sm">${ports}</td>
        <td><span class="status-badge ${epClass}">${epStatus}</span></td>
      </tr>
    `;
  }).join('');
}

loadNetwork();
// Auto-refresh every 10 seconds for live rates
setInterval(loadNetwork, 10000);

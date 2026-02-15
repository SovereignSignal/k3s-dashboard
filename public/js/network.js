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

// =============================================
// Network Manager Functions
// =============================================

let currentDevices = [];

// Load network info
async function loadNetworkInfo() {
  try {
    const info = await api.get('/api/network/info');
    document.getElementById('localIP').textContent = info.interfaces[0]?.address || '-';
    document.getElementById('subnet').textContent = info.subnet || '-';
    document.getElementById('gateway').textContent = info.gateway || '-';
  } catch (err) {
    console.error('Failed to load network info:', err);
  }
}

// Scan network for devices
async function scanNetwork(thorough = false) {
  const scanBtn = document.getElementById('scanBtn');
  const deepScanBtn = document.getElementById('deepScanBtn');
  const tbody = document.getElementById('devices-body');

  scanBtn.disabled = true;
  deepScanBtn.disabled = true;
  tbody.innerHTML = '<tr><td colspan="7" class="loading-state"><span class="spinner"></span><p>Scanning network...</p></td></tr>';

  try {
    const result = await api.get(`/api/network/discover?thorough=${thorough}`);
    currentDevices = result.devices;

    document.getElementById('onlineCount').textContent = result.count.online;
    document.getElementById('totalCount').textContent = result.count.total;
    document.getElementById('localIP').textContent = result.localIP || '-';
    document.getElementById('subnet').textContent = result.subnet || '-';

    renderDevices(result.devices);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-error">${err.message}</td></tr>`;
  } finally {
    scanBtn.disabled = false;
    deepScanBtn.disabled = false;
  }
}

// Device type icons
const deviceTypeIcons = {
  computer: '💻',
  server: '🖥️',
  phone: '📱',
  iot: '🔌',
  printer: '🖨️',
  camera: '📷',
  router: '🌐',
  storage: '💾',
  tv: '📺',
  other: '📦',
  '': '❓',
};

// Render devices table
function renderDevices(devices) {
  const tbody = document.getElementById('devices-body');

  if (!devices.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-secondary">No devices found</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(d => {
    const statusClass = d.state === 'online' ? 'online' : 'offline';
    const name = d.customName || d.hostname || '-';
    const lastSeen = d.lastSeen ? formatTimeAgo(d.lastSeen) : '-';
    const typeIcon = deviceTypeIcons[d.deviceType] || deviceTypeIcons[''];

    return `
      <tr>
        <td>
          <span class="device-status">
            <span class="status-dot ${statusClass}"></span>
            ${d.state}
          </span>
        </td>
        <td class="mono">${d.ip}</td>
        <td>${name}</td>
        <td class="mono text-sm">${d.mac || '-'}</td>
        <td><span class="device-type-icon" title="${d.deviceType || 'unknown'}">${typeIcon}</span></td>
        <td class="text-sm text-muted">${lastSeen}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn-sm btn-icon" onclick="pingDevice('${d.ip}')" title="Ping">📡</button>
            <button class="btn btn-sm btn-icon" onclick="portScan('${d.ip}')" title="Port Scan">🔍</button>
            <button class="btn btn-sm btn-icon" onclick="editDevice('${d.ip}')" title="Edit">✏️</button>
            ${d.mac ? `<button class="btn btn-sm btn-icon" onclick="wakeDevice('${d.mac}')" title="Wake-on-LAN">⚡</button>` : ''}
            <button class="btn btn-sm btn-icon" onclick="deleteDevice('${d.ip}')" title="Remove">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Format time ago
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// Ping a device
async function pingDevice(ip) {
  const modal = document.getElementById('pingModal');
  const results = document.getElementById('pingResults');

  modal.classList.add('active');
  results.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Pinging ' + ip + '...</p></div>';

  try {
    const data = await api.post('/api/network/ping-device', { ip });

    const resultLines = data.results.map(r => `
      <div class="ping-result ${r.success ? 'ping-success' : 'ping-fail'}">
        <span>${r.success ? '✓' : '✗'}</span>
        <span>seq=${r.seq}</span>
        ${r.success ? `<span>time=${r.latency}ms</span><span>ttl=${r.ttl}</span>` : '<span>Request timeout</span>'}
      </div>
    `).join('');

    const summary = data.summary;
    results.innerHTML = `
      <div style="margin-bottom: 0.5rem; font-weight: 600;">Pinging ${ip}</div>
      ${resultLines}
      <div class="ping-summary">
        <strong>Summary:</strong><br>
        Packets: ${summary.sent} sent, ${summary.received} received, ${summary.lossPercent}% loss<br>
        ${summary.avgLatency !== null ? `Latency: min=${summary.minLatency}ms, avg=${summary.avgLatency}ms, max=${summary.maxLatency}ms` : 'Host unreachable'}
      </div>
    `;
  } catch (err) {
    results.innerHTML = `<div class="text-error">${err.message}</div>`;
  }
}

function closePingModal() {
  document.getElementById('pingModal').classList.remove('active');
}

// Port scan a device
async function portScan(ip) {
  const modal = document.getElementById('portModal');
  const results = document.getElementById('portResults');

  modal.classList.add('active');
  results.innerHTML = '<div class="loading-state"><span class="spinner"></span><p>Scanning ports on ' + ip + '...</p></div>';

  try {
    const data = await api.post('/api/network/port-scan', { ip });

    const openPorts = data.openPorts.map(p => `
      <div class="port-item port-open">
        <strong>${p.port}</strong> ${p.service}
      </div>
    `).join('');

    const closedPorts = data.closedPorts.map(p => `
      <div class="port-item port-closed">
        <span>${p.port}</span> ${p.service}
      </div>
    `).join('');

    results.innerHTML = `
      <div style="margin-bottom: 1rem;">
        <strong>Open Ports (${data.openPorts.length})</strong>
        <div class="port-list" style="margin-top: 0.5rem;">
          ${openPorts || '<div class="text-muted">No open ports found</div>'}
        </div>
      </div>
      <div>
        <strong>Closed Ports (${data.closedPorts.length})</strong>
        <div class="port-list" style="margin-top: 0.5rem;">
          ${closedPorts}
        </div>
      </div>
    `;
  } catch (err) {
    results.innerHTML = `<div class="text-error">${err.message}</div>`;
  }
}

function closePortModal() {
  document.getElementById('portModal').classList.remove('active');
}

// Edit device
function editDevice(ip) {
  const device = currentDevices.find(d => d.ip === ip);
  if (!device) return;

  document.getElementById('editDeviceIP').value = ip;
  document.getElementById('editDeviceName').value = device.customName || '';
  document.getElementById('editDeviceType').value = device.deviceType || '';
  document.getElementById('editDeviceNotes').value = device.notes || '';

  document.getElementById('editDeviceModal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('editDeviceModal').classList.remove('active');
}

async function saveDevice() {
  const ip = document.getElementById('editDeviceIP').value;
  const customName = document.getElementById('editDeviceName').value.trim();
  const deviceType = document.getElementById('editDeviceType').value;
  const notes = document.getElementById('editDeviceNotes').value.trim();

  try {
    await api.patch(`/api/network/device/${ip}`, {
      customName: customName || null,
      deviceType: deviceType || null,
      notes: notes || null,
    });

    closeEditModal();
    // Update local data
    const device = currentDevices.find(d => d.ip === ip);
    if (device) {
      device.customName = customName || null;
      device.deviceType = deviceType || null;
      device.notes = notes || null;
      renderDevices(currentDevices);
    }
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

// Delete device from tracking
async function deleteDevice(ip) {
  if (!confirm(`Remove ${ip} from tracked devices?`)) return;

  try {
    await api.del(`/api/network/device/${ip}`);
    currentDevices = currentDevices.filter(d => d.ip !== ip);
    renderDevices(currentDevices);
    document.getElementById('totalCount').textContent = currentDevices.length;
    document.getElementById('onlineCount').textContent = currentDevices.filter(d => d.state === 'online').length;
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

// Wake-on-LAN
async function wakeDevice(mac) {
  try {
    const result = await api.post('/api/network/wake', { mac });
    alert(result.message);
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

// Load network info on page load
loadNetworkInfo();

// Initialize scan button event listeners
document.getElementById('scanBtn').addEventListener('click', () => scanNetwork(false));
document.getElementById('deepScanBtn').addEventListener('click', () => scanNetwork(true));

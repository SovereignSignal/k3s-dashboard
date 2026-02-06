document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

let currentSort = { field: 'ip', dir: 'asc' };
let devicesData = [];

// Device type icons
const typeIcons = {
  computer: '\u{1F4BB}',
  server: '\u{1F5A5}\uFE0F',
  phone: '\u{1F4F1}',
  iot: '\u{1F4E1}',
  printer: '\u{1F5A8}\uFE0F',
  camera: '\u{1F4F7}',
  router: '\u{1F310}',
  storage: '\u{1F4BE}',
  tv: '\u{1F4FA}',
  other: '\u{1F4E6}',
};

function ipToNum(ip) {
  if (!ip) return 0;
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return d.toLocaleDateString();
}

function formatAbsoluteTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function sortDevices(devices, field, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  return [...devices].sort((a, b) => {
    let va, vb;
    switch (field) {
      case 'status':
        va = a.status === 'online' ? 0 : 1;
        vb = b.status === 'online' ? 0 : 1;
        break;
      case 'ip':
        va = ipToNum(a.ip);
        vb = ipToNum(b.ip);
        break;
      case 'name':
        va = (a.customName || a.hostname || '').toLowerCase();
        vb = (b.customName || b.hostname || '').toLowerCase();
        break;
      case 'type':
        va = a.deviceType || '';
        vb = b.deviceType || '';
        break;
      case 'firstSeen':
        va = a.firstSeen || 0;
        vb = b.firstSeen || 0;
        break;
      case 'lastSeen':
        va = a.lastSeen || 0;
        vb = b.lastSeen || 0;
        break;
      default:
        return 0;
    }
    if (va < vb) return -1 * mul;
    if (va > vb) return 1 * mul;
    return 0;
  });
}

function renderDevices(devices) {
  const tbody = document.getElementById('devices-body');

  if (!devices.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-secondary">No devices discovered yet. Waiting for background scan...</td></tr>';
    return;
  }

  const sorted = sortDevices(devices, currentSort.field, currentSort.dir);

  tbody.innerHTML = sorted.map(d => {
    const displayName = d.customName || d.hostname || '-';
    const typeIcon = typeIcons[d.deviceType] || '';
    const typeLabel = d.deviceType || '-';

    return `
      <tr>
        <td>
          <span class="device-status">
            <span class="status-dot ${d.status}"></span>
            ${d.status}
          </span>
        </td>
        <td class="mono">${d.ip || '-'}</td>
        <td>${escapeHtml(displayName)}</td>
        <td class="mono text-sm">${d.mac || '-'}</td>
        <td><span class="device-type-icon">${typeIcon}</span> ${escapeHtml(typeLabel)}</td>
        <td title="${formatAbsoluteTime(d.firstSeen)}">${formatTime(d.firstSeen)}</td>
        <td title="${formatAbsoluteTime(d.lastSeen)}">${formatTime(d.lastSeen)}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn-sm btn-icon" title="Edit" onclick="editDevice('${d.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn btn-sm btn-icon" title="Remove" onclick="removeDevice('${d.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderStats(stats) {
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-online').textContent = stats.online;
  document.getElementById('stat-offline').textContent = stats.offline;
  document.getElementById('stat-new').textContent = stats.newToday;
}

function renderScanStatus(lastScan, scanning) {
  const el = document.getElementById('scan-status-text');
  if (scanning) {
    el.textContent = 'Scanning...';
  } else if (lastScan) {
    el.textContent = `Last scan: ${formatTime(lastScan)} \u2022 Scans every 2 minutes`;
  } else {
    el.textContent = 'Waiting for first scan...';
  }
}

async function loadDevices() {
  try {
    const data = await api.get('/api/devices');
    devicesData = data.devices || [];
    renderDevices(devicesData);
    renderStats(data.stats);
    renderScanStatus(data.lastScan, data.scanning);
  } catch (err) {
    toast.error('Error', 'Failed to load devices: ' + err.message);
  }
}

// Sort header click handling
function initSortHeaders() {
  document.querySelectorAll('.sortable-header').forEach(th => {
    const field = th.dataset.sort;
    // Add sort indicator
    th.innerHTML += ' <span class="sort-indicator">\u2195</span>';

    th.addEventListener('click', () => {
      if (currentSort.field === field) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.field = field;
        currentSort.dir = 'asc';
      }

      // Update header visuals
      document.querySelectorAll('.sortable-header').forEach(h => {
        h.classList.remove('sort-active');
        const indicator = h.querySelector('.sort-indicator');
        if (indicator) indicator.textContent = '\u2195';
      });
      th.classList.add('sort-active');
      const indicator = th.querySelector('.sort-indicator');
      if (indicator) indicator.textContent = currentSort.dir === 'asc' ? '\u2191' : '\u2193';

      renderDevices(devicesData);
    });
  });
}

// Scan Now button
document.getElementById('scanNowBtn').addEventListener('click', async () => {
  const btn = document.getElementById('scanNowBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  try {
    await api.post('/api/devices/scan');
    await loadDevices();
    toast.success('Scan Complete', 'Device scan finished');
  } catch (err) {
    toast.error('Scan Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      Scan Now
    `;
  }
});

// Edit device
function editDevice(id) {
  const device = devicesData.find(d => d.id === id);
  if (!device) return;

  document.getElementById('editDeviceId').value = id;
  document.getElementById('editDeviceIP').value = device.ip || '';
  document.getElementById('editDeviceName').value = device.customName || '';
  document.getElementById('editDeviceType').value = device.deviceType || '';
  document.getElementById('editDeviceNotes').value = device.notes || '';

  document.getElementById('editModal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

document.getElementById('editModalClose').addEventListener('click', closeEditModal);
document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
document.getElementById('editModal').addEventListener('click', (e) => {
  if (e.target.id === 'editModal') closeEditModal();
});

document.getElementById('editSaveBtn').addEventListener('click', async () => {
  const id = document.getElementById('editDeviceId').value;
  const customName = document.getElementById('editDeviceName').value.trim();
  const deviceType = document.getElementById('editDeviceType').value;
  const notes = document.getElementById('editDeviceNotes').value.trim();

  try {
    await api.patch(`/api/devices/${encodeURIComponent(id)}`, { customName, deviceType, notes });
    closeEditModal();
    await loadDevices();
    toast.success('Saved', 'Device updated');
  } catch (err) {
    toast.error('Error', 'Failed to save: ' + err.message);
  }
});

// Remove device
async function removeDevice(id) {
  const device = devicesData.find(d => d.id === id);
  const name = device?.customName || device?.hostname || device?.ip || id;
  const confirmed = await window.confirm({
    title: 'Remove Device',
    message: `Remove this device from tracking? It will reappear on the next scan if still online.`,
    resource: name,
    confirmText: 'Remove',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api.del(`/api/devices/${encodeURIComponent(id)}`);
    await loadDevices();
    toast.success('Removed', 'Device removed from tracking');
  } catch (err) {
    toast.error('Error', 'Failed to remove: ' + err.message);
  }
}

// Initialize
initSortHeaders();
loadDevices();

// Auto-refresh every 30s
setInterval(loadDevices, 30000);

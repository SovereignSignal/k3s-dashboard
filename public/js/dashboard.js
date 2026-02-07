document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

// Chart instances
let cpuChart = null;
let memoryChart = null;
let networkChart = null;

// Node colors for charts
const nodeColors = [
  { border: 'rgb(0, 112, 243)', background: 'rgba(0, 112, 243, 0.1)' },   // accent blue
  { border: 'rgb(0, 168, 84)', background: 'rgba(0, 168, 84, 0.1)' },     // green
  { border: 'rgb(139, 92, 246)', background: 'rgba(139, 92, 246, 0.1)' }, // purple
  { border: 'rgb(245, 166, 35)', background: 'rgba(245, 166, 35, 0.1)' }, // orange
  { border: 'rgb(238, 0, 0)', background: 'rgba(238, 0, 0, 0.1)' },       // red
  { border: 'rgb(6, 182, 212)', background: 'rgba(6, 182, 212, 0.1)' },   // cyan
];

async function loadDashboard() {
  try {
    const [overview, events, storage, templates, metricsHistory, installedApps] = await Promise.all([
      api.get('/api/cluster/overview'),
      api.get('/api/cluster/events'),
      api.get('/api/storage/nodes'),
      api.get('/api/templates'),
      api.get('/api/metrics/history'),
      api.get('/api/apps').catch(() => []),
    ]);
    renderSummary(overview);
    renderNodes(overview.nodes.items);
    renderCharts(metricsHistory);
    renderStorage(storage);
    renderTemplates(templates, installedApps);
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

function renderStorage(nodes) {
  const el = document.getElementById('storage-cards');

  // Calculate totals
  let totalSD = 0, totalSSD = 0;
  let nodesWithSSD = [];

  nodes.forEach(node => {
    (node.devices || []).forEach(dev => {
      const sizeGB = parseFloat(dev.size) || 0;
      if (dev.type === 'SSD') {
        totalSSD += sizeGB;
        if (!nodesWithSSD.includes(node.name)) nodesWithSSD.push(node.name);
      } else if (dev.type === 'SD Card') {
        totalSD += sizeGB;
      }
    });
  });

  el.innerHTML = `
    <div class="card">
      <div class="card-title">SD Card Storage</div>
      <div class="card-value">${totalSD.toFixed(0)}<span class="unit"> GB total</span></div>
      <div class="text-sm text-muted mt-1">All nodes (local-path)</div>
    </div>
    <div class="card">
      <div class="card-title">SSD Storage</div>
      <div class="card-value">${totalSSD.toFixed(0)}<span class="unit"> GB total</span></div>
      <div class="text-sm text-muted mt-1">${nodesWithSSD.length ? nodesWithSSD.join(', ') : 'None'} (local-path-ssd)</div>
    </div>
    <div class="card">
      <div class="card-title">Storage Classes</div>
      <div class="card-value">2</div>
      <div class="text-sm text-muted mt-1"><a href="/storage.html">Manage storage</a></div>
    </div>
  `;
}

function renderTemplates(templates, installedApps) {
  const el = document.getElementById('template-cards');

  // Build set of installed template IDs
  const installedSet = new Set((installedApps || []).map(a => a.templateId));

  // Group templates by category, prioritizing AI
  const aiTemplates = templates.filter(t => t.category === 'AI');
  const otherTemplates = templates.filter(t => t.category !== 'AI');

  // Show all AI templates + 2 popular infrastructure ones
  const featured = [...aiTemplates, ...otherTemplates.slice(0, 2)];

  el.innerHTML = featured.map(t => {
    const badge = installedSet.has(t.id)
      ? '<span class="status-badge status-ready" style="font-size: 0.7rem;">Installed</span>'
      : '';
    return `
      <div class="card card-clickable" onclick="deployTemplate('${t.id}')">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <div class="card-title">${t.category} ${badge}</div>
            <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem;">${t.name}</div>
            <div class="text-sm text-muted">${t.description}</div>
          </div>
          <span style="font-size: 1.5rem;">${t.icon || ''}</span>
        </div>
      </div>
    `;
  }).join('') + `
    <div class="card card-clickable" onclick="window.location.href='/deploy.html'" style="display: flex; align-items: center; justify-content: center;">
      <div class="text-muted" style="text-align: center;">
        <div style="font-size: 1.5rem;">+</div>
        <div class="text-sm">Custom YAML</div>
      </div>
    </div>
  `;
}

async function deployTemplate(templateId) {
  try {
    // Fetch full template details to check for config
    const template = await api.get(`/api/templates/${templateId}`);

    if (template.config && template.config.length > 0) {
      showTemplateConfigModal(template);
    } else {
      // No config - use simple confirm
      if (!confirm('Deploy this template to the cluster?')) return;
      await executeTemplateDeploy(templateId);
    }
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message, 'error');
  }
}

async function executeTemplateDeploy(templateId, config = {}) {
  try {
    const res = await api.post(`/api/templates/${templateId}/deploy`, { config });
    if (res.error) {
      showAlert(document.querySelector('.main-content'), res.error, 'error');
      return;
    }
    showAlert(document.querySelector('.main-content'), `Deployed ${templateId} successfully!`, 'success');
    setTimeout(loadDashboard, 2000);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message, 'error');
  }
}

function showTemplateConfigModal(template) {
  // Remove any existing modal
  const existing = document.getElementById('template-config-modal');
  if (existing) existing.remove();

  // Build form fields
  const fields = template.config.map(item => {
    let input;
    if (item.type === 'select') {
      const options = item.options.map(opt => {
        if (typeof opt === 'string') {
          return `<option value="${opt}" ${opt === item.default ? 'selected' : ''}>${opt}</option>`;
        }
        return `<option value="${opt.value}" ${opt.value === item.default ? 'selected' : ''}>${opt.label}</option>`;
      }).join('');
      input = `<select class="form-control" name="${item.id}">${options}</select>`;
    } else if (item.type === 'number') {
      input = `<input type="number" class="form-control" name="${item.id}" value="${item.default}">`;
    } else {
      input = `<input type="text" class="form-control" name="${item.id}" value="${item.default}">`;
    }
    const hint = item.hint ? `<div class="hint">${item.hint}</div>` : '';
    return `<div class="form-group"><label>${item.label}</label>${input}${hint}</div>`;
  }).join('');

  const modalHTML = `
    <div class="modal-overlay active" id="template-config-modal">
      <div class="modal modal-config">
        <div class="modal-header">
          <div class="modal-title-group">
            <span class="modal-icon">${template.icon || '📦'}</span>
            <div>
              <h3>${template.name}</h3>
              <div class="modal-subtitle">${template.description}</div>
            </div>
          </div>
          <div class="modal-close" onclick="closeConfigModal()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </div>
        </div>
        <div class="modal-body">
          <form id="template-config-form">
            ${fields}
          </form>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" onclick="closeConfigModal()">Cancel</button>
          <button type="button" class="btn btn-accent" onclick="submitTemplateConfig('${template.id}')">Deploy</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Focus first input
  const firstInput = document.querySelector('#template-config-form input, #template-config-form select');
  if (firstInput) firstInput.focus();

  // Handle Escape key
  document.getElementById('template-config-modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeConfigModal();
  });

  // Close on backdrop click
  document.getElementById('template-config-modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeConfigModal();
  });
}

function closeConfigModal() {
  const modal = document.getElementById('template-config-modal');
  if (modal) modal.remove();
}

async function submitTemplateConfig(templateId) {
  const form = document.getElementById('template-config-form');
  const formData = new FormData(form);
  const config = {};
  for (const [key, value] of formData.entries()) {
    config[key] = value;
  }
  closeConfigModal();
  await executeTemplateDeploy(templateId, config);
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

// Chart.js configuration
function getChartConfig(type = 'percentage') {
  const isDark = getTheme() === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const textColor = isDark ? '#a1a1a1' : '#666666';

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 300,
    },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: textColor,
          padding: 15,
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: isDark ? '#1a1a1a' : '#ffffff',
        titleColor: isDark ? '#ededed' : '#171717',
        bodyColor: isDark ? '#a1a1a1' : '#666666',
        borderColor: isDark ? '#262626' : '#eaeaea',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: function(context) {
            let label = context.dataset.label || '';
            if (label) label += ': ';
            if (type === 'percentage') {
              label += context.parsed.y.toFixed(1) + '%';
            } else if (type === 'bytes') {
              label += formatBytesPerSec(context.parsed.y);
            }
            return label;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: gridColor,
          drawBorder: false,
        },
        ticks: {
          color: textColor,
          maxTicksLimit: 6,
          maxRotation: 0,
        },
      },
      y: {
        min: 0,
        max: type === 'percentage' ? 100 : undefined,
        grid: {
          color: gridColor,
          drawBorder: false,
        },
        ticks: {
          color: textColor,
          callback: function(value) {
            if (type === 'percentage') return value + '%';
            return formatBytesPerSec(value);
          },
        },
      },
    },
  };
}

function formatBytesPerSec(bytes) {
  if (bytes >= 1000000) return (bytes / 1000000).toFixed(1) + ' MB/s';
  if (bytes >= 1000) return (bytes / 1000).toFixed(0) + ' KB/s';
  return bytes.toFixed(0) + ' B/s';
}

function formatTimeLabel(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderCharts(history) {
  if (!history || !history.timestamps || history.timestamps.length === 0) {
    return;
  }

  const labels = history.timestamps.map(formatTimeLabel);
  const nodeNames = Object.keys(history.nodes);

  // CPU Chart
  const cpuCtx = document.getElementById('cpu-chart');
  if (cpuCtx) {
    const cpuDatasets = nodeNames.map((name, idx) => ({
      label: name,
      data: history.nodes[name].cpu,
      borderColor: nodeColors[idx % nodeColors.length].border,
      backgroundColor: nodeColors[idx % nodeColors.length].background,
      borderWidth: 2,
      tension: 0.3,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
    }));

    if (cpuChart) {
      cpuChart.data.labels = labels;
      cpuChart.data.datasets = cpuDatasets;
      cpuChart.options = getChartConfig('percentage');
      cpuChart.update('none');
    } else {
      cpuChart = new Chart(cpuCtx, {
        type: 'line',
        data: { labels, datasets: cpuDatasets },
        options: getChartConfig('percentage'),
      });
    }
  }

  // Memory Chart
  const memCtx = document.getElementById('memory-chart');
  if (memCtx) {
    const memDatasets = nodeNames.map((name, idx) => ({
      label: name,
      data: history.nodes[name].memory,
      borderColor: nodeColors[idx % nodeColors.length].border,
      backgroundColor: nodeColors[idx % nodeColors.length].background,
      borderWidth: 2,
      tension: 0.3,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
    }));

    if (memoryChart) {
      memoryChart.data.labels = labels;
      memoryChart.data.datasets = memDatasets;
      memoryChart.options = getChartConfig('percentage');
      memoryChart.update('none');
    } else {
      memoryChart = new Chart(memCtx, {
        type: 'line',
        data: { labels, datasets: memDatasets },
        options: getChartConfig('percentage'),
      });
    }
  }

  // Network Chart
  const netCtx = document.getElementById('network-chart');
  if (netCtx) {
    const netDatasets = [];
    nodeNames.forEach((name, idx) => {
      netDatasets.push({
        label: `${name} RX`,
        data: history.nodes[name].networkRx,
        borderColor: nodeColors[idx % nodeColors.length].border,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      });
      netDatasets.push({
        label: `${name} TX`,
        data: history.nodes[name].networkTx,
        borderColor: nodeColors[idx % nodeColors.length].border,
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [5, 5],
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      });
    });

    if (networkChart) {
      networkChart.data.labels = labels;
      networkChart.data.datasets = netDatasets;
      networkChart.options = getChartConfig('bytes');
      networkChart.update('none');
    } else {
      networkChart = new Chart(netCtx, {
        type: 'line',
        data: { labels, datasets: netDatasets },
        options: getChartConfig('bytes'),
      });
    }
  }
}

loadDashboard();
// Auto-refresh every 30 seconds
setInterval(loadDashboard, 30000);

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

const nsFilter = document.getElementById('ns-filter');
let scaleNs = '', scaleName = '';

nsFilter.addEventListener('change', loadWorkloads);

async function loadWorkloads() {
  const ns = nsFilter.value;
  const qs = ns ? `?namespace=${encodeURIComponent(ns)}` : '';
  try {
    const [deployments, pods, namespaces] = await Promise.all([
      api.get(`/api/deployments${qs}`),
      api.get(`/api/pods${qs}`),
      api.get('/api/namespaces'),
    ]);
    updateNsFilter(namespaces);
    renderDeployments(deployments);
    renderPods(pods);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

function updateNsFilter(namespaces) {
  const current = nsFilter.value;
  const opts = '<option value="">All namespaces</option>' +
    namespaces.map(ns => `<option value="${ns.name}" ${ns.name === current ? 'selected' : ''}>${ns.name}</option>`).join('');
  nsFilter.innerHTML = opts;
}

function renderDeployments(deployments) {
  const tbody = document.getElementById('deployments-body');
  if (!deployments.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No deployments</td></tr>';
    return;
  }
  tbody.innerHTML = deployments.map(d => `
    <tr>
      <td class="mono text-sm">${d.name}</td>
      <td>${d.namespace}</td>
      <td>${d.readyReplicas}/${d.replicas}</td>
      <td class="text-sm">${d.images.join(', ')}</td>
      <td class="text-sm text-muted">${timeAgo(d.createdAt)}</td>
      <td class="table-actions">
        <button class="btn btn-sm" onclick="openScaleModal('${d.namespace}','${d.name}',${d.replicas})">Scale</button>
        ${d.protected ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteDeployment('${d.namespace}','${d.name}')">Delete</button>`}
      </td>
    </tr>
  `).join('');
}

function renderPods(pods) {
  const tbody = document.getElementById('pods-body');
  if (!pods.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No pods</td></tr>';
    return;
  }
  tbody.innerHTML = pods.map(p => `
    <tr>
      <td class="mono text-sm">${p.name}</td>
      <td>${p.namespace}</td>
      <td><span class="status-badge ${statusClass(p.status)}">${p.status}</span></td>
      <td>${p.ready}</td>
      <td>${p.restarts}</td>
      <td class="text-sm">${p.nodeName || ''}</td>
      <td class="text-sm text-muted">${timeAgo(p.createdAt)}</td>
      <td class="table-actions">
        <a href="/logs.html?namespace=${p.namespace}&pod=${p.name}" class="btn btn-sm">Logs</a>
        <button class="btn btn-sm btn-danger" onclick="deletePod('${p.namespace}','${p.name}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function openScaleModal(ns, name, current) {
  scaleNs = ns;
  scaleName = name;
  document.getElementById('scale-target').textContent = `${ns}/${name}`;
  document.getElementById('scale-replicas').value = current;
  document.getElementById('scale-modal').classList.add('active');
}

function closeScaleModal() {
  document.getElementById('scale-modal').classList.remove('active');
}

async function doScale() {
  const replicas = parseInt(document.getElementById('scale-replicas').value, 10);
  try {
    await api.post(`/api/deployments/${scaleNs}/${scaleName}/scale`, { replicas });
    closeScaleModal();
    showAlert(document.querySelector('.main-content'), `Scaled ${scaleNs}/${scaleName} to ${replicas}`, 'success');
    setTimeout(loadWorkloads, 1000);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

async function deleteDeployment(ns, name) {
  if (!confirm(`Delete deployment ${ns}/${name}?`)) return;
  try {
    await api.del(`/api/deployments/${ns}/${name}`);
    showAlert(document.querySelector('.main-content'), `Deleted deployment ${ns}/${name}`, 'success');
    setTimeout(loadWorkloads, 1000);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

async function deletePod(ns, name) {
  if (!confirm(`Delete pod ${ns}/${name}?`)) return;
  try {
    await api.del(`/api/pods/${ns}/${name}`);
    showAlert(document.querySelector('.main-content'), `Deleted pod ${ns}/${name}`, 'success');
    setTimeout(loadWorkloads, 1000);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

loadWorkloads();

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

async function loadStorage() {
  try {
    const [nodeStorage, storageClasses, pvs, pvcs] = await Promise.all([
      api.get('/api/storage/nodes'),
      api.get('/api/storage/classes'),
      api.get('/api/storage/pv'),
      api.get('/api/storage/pvc'),
    ]);
    renderNodeStorage(nodeStorage);
    renderStorageClasses(storageClasses);
    renderPVs(pvs);
    renderPVCs(pvcs);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

function renderNodeStorage(nodes) {
  const container = document.getElementById('node-storage');
  container.innerHTML = nodes.map(node => {
    let devicesHtml = '';
    if (node.devices && node.devices.length > 0) {
      devicesHtml = node.devices.map(dev => {
        const typeClass = dev.type === 'SSD' ? 'status-ready' : (dev.type === 'SD Card' ? 'status-pending' : 'status-unknown');
        const mountsHtml = dev.mountPoints.length > 0
          ? dev.mountPoints.map(m => `<div class="text-sm text-muted" style="margin-left:1rem;">${m.partition} → ${m.mountpoint} (${m.size})</div>`).join('')
          : '<div class="text-sm text-muted" style="margin-left:1rem;">Not mounted</div>';
        return `
          <div style="margin-bottom: 0.5rem; padding: 0.5rem; background: var(--bg-tertiary); border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="mono">/dev/${dev.name}</span>
              <span class="status-badge ${typeClass}">${dev.type}</span>
            </div>
            <div class="text-sm" style="margin-top: 0.25rem;">
              <strong>${dev.size}</strong> - ${dev.model}
            </div>
            ${mountsHtml}
          </div>
        `;
      }).join('');
    } else if (node.sshError) {
      devicesHtml = `<div class="text-sm text-muted">${node.sshError}</div>`;
    } else {
      devicesHtml = '<div class="text-sm text-muted">No block devices found</div>';
    }

    return `
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h3 style="font-size: 1rem; font-weight: 600;">${node.name}</h3>
          <span class="text-sm text-muted">k8s ephemeral: ${node.ephemeralStorage}</span>
        </div>
        ${devicesHtml}
      </div>
    `;
  }).join('');
}

function renderStorageClasses(classes) {
  const tbody = document.getElementById('sc-body');
  if (!classes.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No storage classes</td></tr>';
    return;
  }
  tbody.innerHTML = classes.map(sc => `
    <tr>
      <td class="mono">${sc.name}</td>
      <td class="text-sm">${sc.provisioner}</td>
      <td>${sc.reclaimPolicy}</td>
      <td class="text-sm">${sc.volumeBindingMode}</td>
      <td>${sc.allowVolumeExpansion ? 'Yes' : 'No'}</td>
      <td>${sc.isDefault ? '<span class="status-badge status-ready">Default</span>' : ''}</td>
    </tr>
  `).join('');
}

function renderPVs(pvs) {
  const tbody = document.getElementById('pv-body');
  if (!pvs.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No persistent volumes</td></tr>';
    return;
  }
  tbody.innerHTML = pvs.map(pv => `
    <tr>
      <td class="mono">${pv.name}</td>
      <td>${pv.capacity || '-'}</td>
      <td class="text-sm">${(pv.accessModes || []).join(', ')}</td>
      <td><span class="status-badge ${statusClass(pv.status)}">${pv.status}</span></td>
      <td class="mono text-sm">${pv.claim || '-'}</td>
      <td>${pv.storageClass || '-'}</td>
      <td>${pv.node || '-'}</td>
      <td class="mono text-sm">${pv.path || '-'}</td>
    </tr>
  `).join('');
}

function renderPVCs(pvcs) {
  const tbody = document.getElementById('pvc-body');
  if (!pvcs.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No persistent volume claims</td></tr>';
    return;
  }
  tbody.innerHTML = pvcs.map(pvc => `
    <tr>
      <td class="mono">${pvc.name}</td>
      <td>${pvc.namespace}</td>
      <td><span class="status-badge ${statusClass(pvc.status)}">${pvc.status}</span></td>
      <td class="mono text-sm">${pvc.volume || '-'}</td>
      <td>${pvc.capacity || '-'}</td>
      <td>${pvc.storageClass || '-'}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="deletePVC('${pvc.namespace}', '${pvc.name}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function deletePVC(namespace, name) {
  if (!confirm(`Delete PVC ${namespace}/${name}? Any data stored will be lost.`)) return;
  try {
    await api.del(`/api/storage/pvc/${namespace}/${name}`);
    showAlert(document.querySelector('.main-content'), `PVC ${namespace}/${name} deleted`, 'success');
    setTimeout(loadStorage, 1000);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

loadStorage();

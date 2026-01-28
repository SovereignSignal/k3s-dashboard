document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

async function loadNamespaces() {
  try {
    const namespaces = await api.get('/api/namespaces');
    const tbody = document.getElementById('ns-body');
    if (!namespaces.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No namespaces</td></tr>';
      return;
    }
    tbody.innerHTML = namespaces.map(ns => `
      <tr>
        <td class="mono">${ns.name}</td>
        <td><span class="status-badge ${statusClass(ns.status)}">${ns.status}</span></td>
        <td class="text-sm text-muted">${timeAgo(ns.createdAt)}</td>
        <td>
          ${ns.protected
            ? '<span class="text-sm text-muted">protected</span>'
            : `<button class="btn btn-sm btn-danger" onclick="deleteNamespace('${ns.name}')">Delete</button>`
          }
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

async function createNamespace() {
  const input = document.getElementById('new-ns-name');
  const name = input.value.trim();
  if (!name) return;
  try {
    const res = await api.post('/api/namespaces', { name });
    if (res.error) {
      showAlert(document.querySelector('.main-content'), res.error);
      return;
    }
    input.value = '';
    showAlert(document.querySelector('.main-content'), `Namespace "${name}" created`, 'success');
    loadNamespaces();
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

async function deleteNamespace(name) {
  if (!confirm(`Delete namespace "${name}"? This will delete ALL resources within it.`)) return;
  try {
    await api.del(`/api/namespaces/${name}`);
    showAlert(document.querySelector('.main-content'), `Namespace "${name}" deleted`, 'success');
    setTimeout(loadNamespaces, 1000);
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

loadNamespaces();

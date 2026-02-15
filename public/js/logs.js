document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

const nsSelect = document.getElementById('log-ns');
const podSelect = document.getElementById('log-pod');
const containerSelect = document.getElementById('log-container');
let allPods = [];

nsSelect.addEventListener('change', () => {
  updatePodList();
});

podSelect.addEventListener('change', () => {
  updateContainerList();
});

async function init() {
  try {
    const [namespaces, pods] = await Promise.all([
      api.get('/api/namespaces'),
      api.get('/api/pods'),
    ]);
    allPods = pods;

    nsSelect.innerHTML = '<option value="">Select...</option>' +
      namespaces.map(ns => `<option value="${ns.name}">${ns.name}</option>`).join('');

    // Check URL params for pre-selection
    const params = new URLSearchParams(window.location.search);
    const preNs = params.get('namespace');
    const prePod = params.get('pod');

    if (preNs) {
      nsSelect.value = preNs;
      updatePodList();
      if (prePod) {
        podSelect.value = prePod;
        updateContainerList();
        fetchLogs();
      }
    }
  } catch (err) {
    showAlert(document.querySelector('.main-content'), err.message);
  }
}

function updatePodList() {
  const ns = nsSelect.value;
  const filtered = ns ? allPods.filter(p => p.namespace === ns) : allPods;
  podSelect.innerHTML = '<option value="">Select...</option>' +
    filtered.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  containerSelect.innerHTML = '<option value="">All</option>';
}

function updateContainerList() {
  const podName = podSelect.value;
  const pod = allPods.find(p => p.name === podName && p.namespace === nsSelect.value);
  if (pod && pod.containers) {
    containerSelect.innerHTML = '<option value="">All</option>' +
      pod.containers.map(c => `<option value="${c}">${c}</option>`).join('');
  }
}

async function fetchLogs() {
  const ns = nsSelect.value;
  const pod = podSelect.value;
  const container = containerSelect.value;
  const lines = document.getElementById('log-lines').value;
  const output = document.getElementById('log-output');

  if (!ns || !pod) {
    output.textContent = 'Please select a namespace and pod.';
    return;
  }

  output.textContent = 'Loading logs...';

  try {
    const qs = new URLSearchParams();
    if (container) qs.set('container', container);
    qs.set('tailLines', lines);
    const logs = await api.getText(`/api/pods/${ns}/${pod}/logs?${qs}`);
    output.textContent = logs || '(no logs)';
    // Scroll to bottom
    output.scrollTop = output.scrollHeight;
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  }
}

init();

// Fetch logs button event listener
document.getElementById('fetch-logs-btn').addEventListener('click', fetchLogs);

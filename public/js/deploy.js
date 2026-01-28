document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  window.location.href = '/login.html';
});

// Allow tab key in textarea
document.getElementById('yaml-input').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + 2;
  }
});

function validateYaml() {
  const alerts = document.getElementById('deploy-alerts');
  const yaml = document.getElementById('yaml-input').value.trim();
  if (!yaml) {
    showAlert(alerts, 'YAML input is empty', 'error');
    return false;
  }
  try {
    // Basic client-side validation: check it looks like YAML with required fields
    const lines = yaml.split('\n');
    let hasApiVersion = false, hasKind = false, hasName = false;
    for (const line of lines) {
      if (line.match(/^apiVersion:/)) hasApiVersion = true;
      if (line.match(/^kind:/)) hasKind = true;
      if (line.match(/^\s+name:/)) hasName = true;
    }
    if (!hasApiVersion || !hasKind) {
      showAlert(alerts, 'YAML must contain apiVersion and kind fields', 'error');
      return false;
    }
    if (!hasName) {
      showAlert(alerts, 'YAML must contain metadata.name', 'error');
      return false;
    }
    showAlert(alerts, 'YAML looks valid (full validation happens server-side on apply)', 'success');
    return true;
  } catch (err) {
    showAlert(alerts, `Validation error: ${err.message}`, 'error');
    return false;
  }
}

async function applyYaml() {
  const alerts = document.getElementById('deploy-alerts');
  const results = document.getElementById('apply-results');
  const yaml = document.getElementById('yaml-input').value.trim();

  if (!yaml) {
    showAlert(alerts, 'YAML input is empty', 'error');
    return;
  }

  try {
    const res = await api.post('/api/apply', { manifest: yaml });
    if (res.error) {
      showAlert(alerts, res.error, 'error');
      return;
    }
    if (res.results) {
      let html = '<div class="table-wrap" style="margin-top:1rem;"><table><thead><tr><th>Kind</th><th>Name</th><th>Namespace</th><th>Result</th></tr></thead><tbody>';
      for (const r of res.results) {
        const cls = r.action === 'error' ? 'status-failed' : 'status-ready';
        html += `<tr>
          <td>${r.kind}</td>
          <td class="mono">${r.name}</td>
          <td>${r.namespace || '-'}</td>
          <td><span class="status-badge ${cls}">${r.action}</span>${r.error ? ' <span class="text-sm" style="color:var(--red)">' + r.error + '</span>' : ''}</td>
        </tr>`;
      }
      html += '</tbody></table></div>';
      results.innerHTML = html;

      const hasErrors = res.results.some(r => r.action === 'error');
      showAlert(alerts, hasErrors ? 'Some resources failed to apply' : 'All resources applied successfully', hasErrors ? 'error' : 'success');
    }
  } catch (err) {
    showAlert(alerts, `Apply failed: ${err.message}`, 'error');
  }
}

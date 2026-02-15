const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('../utils/logger');
const k8s = require('./k8s-client');

const DATA_FILE = path.join(__dirname, '..', 'data', 'update-state.json');
const MAX_LOGS = 500;
const LOCAL_HOSTNAME = os.hostname();

// In-memory state
let state = createFreshState();

function createFreshState() {
  return {
    status: 'idle',
    operation: null,
    startedAt: null,
    completedAt: null,
    error: null,
    nodes: {},
    nodeOrder: [],
    currentNodeIndex: -1,
    versions: {
      os: {},
      k3s: { current: null, latest: null, perNode: {} },
    },
    logs: [],
  };
}

// ---- Persistence ----

function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data && typeof data === 'object') {
        state = { ...createFreshState(), ...data };
        // If was mid-update when process died, mark as error
        if (state.status === 'updating' || state.status === 'checking') {
          state.status = 'error';
          state.error = 'Process restarted during operation';
        }
        logger.info('Update manager: loaded state from disk');
      }
    }
  } catch (err) {
    logger.warn('Update manager: failed to load state:', err.message);
  }
}

function saveToDisk() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.warn('Update manager: failed to save state:', err.message);
  }
}

// ---- Logging ----

function addLog(node, message, level = 'info') {
  state.logs.push({
    timestamp: new Date().toISOString(),
    node: node || null,
    message,
    level,
  });
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
  logger[level] ? logger[level](`[update-manager] ${node ? `[${node}] ` : ''}${message}`) : logger.info(`[update-manager] ${node ? `[${node}] ` : ''}${message}`);
}

// ---- Exec helper (local or SSH) ----

function remoteExec(nodeName, host, command, timeoutMs = 120_000) {
  const isLocal = nodeName === LOCAL_HOSTNAME;
  return new Promise((resolve, reject) => {
    if (isLocal) {
      execFile('bash', ['-c', command], {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Local exec failed: ${err.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    } else {
      const args = [
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        host,
        command,
      ];
      execFile('ssh', args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`SSH to ${host} failed: ${err.message}\n${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    }
  });
}

// ---- Node info helpers ----

async function getNodeInfo() {
  const nodes = await k8s.listNodes();
  return nodes.map((n) => {
    const roles = Object.keys(n.metadata.labels || {})
      .filter((l) => l.startsWith('node-role.kubernetes.io/'))
      .map((l) => l.split('/')[1]);
    const isServer = roles.includes('control-plane') || roles.includes('master');
    const internalIP = (n.status.addresses || []).find((a) => a.type === 'InternalIP')?.address;
    return {
      name: n.metadata.name,
      role: isServer ? 'server' : 'agent',
      ip: internalIP,
      kubeletVersion: n.status.nodeInfo?.kubeletVersion,
    };
  });
}

// ---- Check OS Updates ----

async function checkOsUpdates() {
  if (state.status === 'updating') {
    throw new Error('An update operation is already in progress');
  }

  state.status = 'checking';
  addLog(null, 'Checking for OS updates on all nodes...');
  saveToDisk();

  try {
    const nodes = await getNodeInfo();

    for (const node of nodes) {
      try {
        addLog(node.name, 'Checking for upgradable packages...');
        const output = await remoteExec(node.name, node.ip, 'sudo apt update -qq 2>/dev/null && apt list --upgradable 2>/dev/null');
        const lines = output.trim().split('\n').filter((l) => {
          if (!l || l.startsWith('Listing') || l.startsWith('WARNING')) return false;
          // Only keep lines that look like package entries (name/repo format)
          return l.includes('/') && !l.startsWith('N:') && !l.match(/^\d+ packages? can be upgraded/);
        });
        const packages = lines.map((l) => l.split('/')[0]).filter(Boolean);

        state.versions.os[node.name] = {
          upgradable: packages.length,
          packages,
          lastChecked: new Date().toISOString(),
        };
        addLog(node.name, `${packages.length} package(s) upgradable`);
      } catch (err) {
        addLog(node.name, `Failed to check OS updates: ${err.message}`, 'warn');
        state.versions.os[node.name] = {
          upgradable: -1,
          packages: [],
          lastChecked: new Date().toISOString(),
          error: err.message,
        };
      }
    }

    state.status = 'idle';
    saveToDisk();
    addLog(null, 'OS update check complete');
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
    addLog(null, `OS update check failed: ${err.message}`, 'error');
    saveToDisk();
    throw err;
  }
}

// ---- Check K3s Version ----

async function checkK3sVersion() {
  if (state.status === 'updating') {
    throw new Error('An update operation is already in progress');
  }

  state.status = 'checking';
  addLog(null, 'Checking k3s versions...');
  saveToDisk();

  try {
    const nodes = await getNodeInfo();

    // Get per-node k3s version from kubelet
    const perNode = {};
    let current = null;
    for (const node of nodes) {
      perNode[node.name] = node.kubeletVersion;
      if (!current) current = node.kubeletVersion;
    }

    // Fetch latest stable version from k3s channel
    let latest = null;
    try {
      const output = await new Promise((resolve, reject) => {
        execFile('curl', ['-sf', 'https://update.k3s.io/v1-release/channels'], {
          timeout: 15_000,
        }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      const channels = JSON.parse(output);
      const stable = channels.data?.find((ch) => ch.id === 'stable');
      if (stable) {
        latest = stable.latest;
      }
    } catch (err) {
      addLog(null, `Failed to fetch latest k3s version: ${err.message}`, 'warn');
    }

    state.versions.k3s = { current, latest, perNode };
    state.status = 'idle';
    saveToDisk();
    addLog(null, `K3s version check complete. Current: ${current}, Latest: ${latest || 'unknown'}`);
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
    addLog(null, `K3s version check failed: ${err.message}`, 'error');
    saveToDisk();
    throw err;
  }
}

// ---- Start OS Update (rolling) ----

async function startOsUpdate() {
  if (state.status === 'updating') {
    throw new Error('An update operation is already in progress');
  }

  const nodes = await getNodeInfo();
  // Workers first, then server
  const sorted = [...nodes].sort((a, b) => {
    if (a.role === 'agent' && b.role === 'server') return -1;
    if (a.role === 'server' && b.role === 'agent') return 1;
    return a.name.localeCompare(b.name);
  });

  state.status = 'updating';
  state.operation = 'os-update';
  state.startedAt = new Date().toISOString();
  state.completedAt = null;
  state.error = null;
  state.nodeOrder = sorted.map((n) => n.name);
  state.currentNodeIndex = -1;
  state.nodes = {};
  for (const node of sorted) {
    state.nodes[node.name] = {
      status: 'pending',
      role: node.role,
      steps: [
        { name: 'Cordon', status: 'pending', output: '' },
        { name: 'Drain', status: 'pending', output: '' },
        { name: 'Apt Full-Upgrade', status: 'pending', output: '' },
        { name: 'Uncordon', status: 'pending', output: '' },
        { name: 'Wait Ready', status: 'pending', output: '' },
      ],
      error: null,
    };
  }
  state.logs = [];
  saveToDisk();

  addLog(null, `Starting rolling OS update. Order: ${state.nodeOrder.join(' → ')}`);

  // Fire and forget
  runOsUpdate(sorted).catch((err) => {
    addLog(null, `OS update failed: ${err.message}`, 'error');
  });
}

async function runOsUpdate(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    state.currentNodeIndex = i;
    state.nodes[node.name].status = 'in-progress';
    saveToDisk();

    try {
      // Step 1: Cordon
      await runStep(node.name, 0, async () => {
        addLog(node.name, 'Cordoning node...');
        await k8s.cordonNode(node.name);
        return 'Node cordoned';
      });

      // Step 2: Drain
      await runStep(node.name, 1, async () => {
        addLog(node.name, 'Draining pods...');
        await k8s.drainNode(node.name);
        return 'Pods drained';
      });

      // Step 3: Apt upgrade
      await runStep(node.name, 2, async () => {
        addLog(node.name, 'Running apt full-upgrade...');
        const output = await remoteExec(
          node.name, node.ip,
          'sudo apt update -qq 2>/dev/null && sudo DEBIAN_FRONTEND=noninteractive apt full-upgrade -y 2>&1',
          300_000
        );
        addLog(node.name, 'Apt full-upgrade completed');
        return output.slice(-500); // Keep last 500 chars
      });

      // Step 4: Uncordon
      await runStep(node.name, 3, async () => {
        addLog(node.name, 'Uncordoning node...');
        await k8s.uncordonNode(node.name);
        return 'Node uncordoned';
      });

      // Step 5: Wait Ready
      await runStep(node.name, 4, async () => {
        addLog(node.name, 'Waiting for node to be Ready...');
        await k8s.waitForNodeReady(node.name, 120);
        return 'Node is Ready';
      });

      state.nodes[node.name].status = 'complete';
      addLog(node.name, 'OS update complete');
      saveToDisk();
    } catch (err) {
      state.nodes[node.name].status = 'error';
      state.nodes[node.name].error = err.message;
      addLog(node.name, `Error: ${err.message}`, 'error');

      // Best effort uncordon
      try { await k8s.uncordonNode(node.name); } catch (_) {}

      state.status = 'error';
      state.error = `Failed on node ${node.name}: ${err.message}`;
      state.completedAt = new Date().toISOString();

      // Mark remaining nodes as skipped
      for (let j = i + 1; j < nodes.length; j++) {
        state.nodes[nodes[j].name].status = 'skipped';
      }
      saveToDisk();
      return;
    }
  }

  state.status = 'complete';
  state.completedAt = new Date().toISOString();
  addLog(null, 'Rolling OS update complete on all nodes');
  saveToDisk();
}

// ---- Start K3s Upgrade ----

async function startK3sUpgrade(targetVersion) {
  if (state.status === 'updating') {
    throw new Error('An update operation is already in progress');
  }

  if (!targetVersion) {
    throw new Error('Target version is required');
  }

  const nodes = await getNodeInfo();
  // Server first, then agents
  const sorted = [...nodes].sort((a, b) => {
    if (a.role === 'server' && b.role === 'agent') return -1;
    if (a.role === 'agent' && b.role === 'server') return 1;
    return a.name.localeCompare(b.name);
  });

  state.status = 'updating';
  state.operation = 'k3s-upgrade';
  state.startedAt = new Date().toISOString();
  state.completedAt = null;
  state.error = null;
  state.nodeOrder = sorted.map((n) => n.name);
  state.currentNodeIndex = -1;
  state.nodes = {};

  for (const node of sorted) {
    const steps = node.role === 'server'
      ? [
          { name: 'Upgrade K3s Server', status: 'pending', output: '' },
          { name: 'Wait API Ready', status: 'pending', output: '' },
        ]
      : [
          { name: 'Cordon', status: 'pending', output: '' },
          { name: 'Drain', status: 'pending', output: '' },
          { name: 'Upgrade K3s Agent', status: 'pending', output: '' },
          { name: 'Uncordon', status: 'pending', output: '' },
          { name: 'Wait Ready', status: 'pending', output: '' },
        ];

    state.nodes[node.name] = {
      status: 'pending',
      role: node.role,
      steps,
      error: null,
    };
  }
  state.logs = [];
  saveToDisk();

  addLog(null, `Starting k3s upgrade to ${targetVersion}. Order: ${state.nodeOrder.join(' → ')}`);

  // Fire and forget
  runK3sUpgrade(sorted, targetVersion).catch((err) => {
    addLog(null, `K3s upgrade failed: ${err.message}`, 'error');
  });
}

async function runK3sUpgrade(nodes, version) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    state.currentNodeIndex = i;
    state.nodes[node.name].status = 'in-progress';
    saveToDisk();

    try {
      if (node.role === 'server') {
        // Server upgrade
        await runStep(node.name, 0, async () => {
          addLog(node.name, `Upgrading k3s server to ${version}...`);
          const output = await remoteExec(
            node.name, node.ip,
            `curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=${version} sh -`,
            300_000
          );
          addLog(node.name, 'K3s server upgrade script completed');
          return output.slice(-500);
        });

        // Wait for API to come back
        await runStep(node.name, 1, async () => {
          addLog(node.name, 'Waiting for k3s API server to come back...');
          // Give it a moment to restart
          await new Promise((r) => setTimeout(r, 10_000));
          await k8s.waitForNodeReady(node.name, 180);
          return 'API server is back';
        });
      } else {
        // Agent upgrade: cordon, drain, upgrade binary, uncordon, wait ready
        let stepIdx = 0;

        // Step 1: Cordon
        await runStep(node.name, stepIdx++, async () => {
          addLog(node.name, 'Cordoning node...');
          await k8s.cordonNode(node.name);
          return 'Node cordoned';
        });

        // Step 2: Drain
        await runStep(node.name, stepIdx++, async () => {
          addLog(node.name, 'Draining pods...');
          await k8s.drainNode(node.name);
          return 'Pods drained';
        });

        // Step 3: Upgrade agent binary
        await runStep(node.name, stepIdx++, async () => {
          addLog(node.name, `Upgrading k3s agent binary to ${version}...`);
          const cmd = [
            'sudo systemctl stop k3s-agent',
            `curl -sfL https://github.com/k3s-io/k3s/releases/download/${version}/k3s-arm64 -o /tmp/k3s-new`,
            'sudo mv /tmp/k3s-new /usr/local/bin/k3s && sudo chmod +x /usr/local/bin/k3s',
            'sudo systemctl start k3s-agent',
          ].join(' && ');
          const output = await remoteExec(node.name, node.ip, cmd, 300_000);
          addLog(node.name, 'K3s agent binary upgraded');
          return output.slice(-500) || 'Binary replaced and agent restarted';
        });

        // Step 4: Uncordon
        await runStep(node.name, stepIdx++, async () => {
          addLog(node.name, 'Uncordoning node...');
          await k8s.uncordonNode(node.name);
          return 'Node uncordoned';
        });

        // Step 5: Wait Ready
        await runStep(node.name, stepIdx++, async () => {
          addLog(node.name, 'Waiting for node to be Ready...');
          await k8s.waitForNodeReady(node.name, 120);
          return 'Node is Ready';
        });
      }

      state.nodes[node.name].status = 'complete';
      addLog(node.name, 'K3s upgrade complete');
      saveToDisk();
    } catch (err) {
      state.nodes[node.name].status = 'error';
      state.nodes[node.name].error = err.message;
      addLog(node.name, `Error: ${err.message}`, 'error');

      // Best effort uncordon for agents
      if (node.role === 'agent') {
        try { await k8s.uncordonNode(node.name); } catch (_) {}
      }

      state.status = 'error';
      state.error = `Failed on node ${node.name}: ${err.message}`;
      state.completedAt = new Date().toISOString();

      // Mark remaining as skipped
      for (let j = i + 1; j < nodes.length; j++) {
        state.nodes[nodes[j].name].status = 'skipped';
      }
      saveToDisk();
      return;
    }
  }

  state.status = 'complete';
  state.completedAt = new Date().toISOString();
  addLog(null, `K3s upgrade to ${version} complete on all nodes`);
  saveToDisk();
}

// ---- Step runner helper ----

async function runStep(nodeName, stepIndex, fn) {
  state.nodes[nodeName].steps[stepIndex].status = 'in-progress';
  saveToDisk();
  try {
    const output = await fn();
    state.nodes[nodeName].steps[stepIndex].status = 'complete';
    state.nodes[nodeName].steps[stepIndex].output = output || '';
    saveToDisk();
  } catch (err) {
    state.nodes[nodeName].steps[stepIndex].status = 'error';
    state.nodes[nodeName].steps[stepIndex].output = err.message;
    saveToDisk();
    throw err;
  }
}

// ---- Reset ----

function resetState() {
  if (state.status === 'updating') {
    throw new Error('Cannot reset while an operation is in progress');
  }
  const versions = state.versions; // preserve version info
  state = createFreshState();
  state.versions = versions;
  saveToDisk();
  addLog(null, 'State reset to idle');
}

// ---- Public API ----

function start() {
  loadFromDisk();
  logger.info('Update manager started');
}

function getState() {
  return { ...state };
}

module.exports = {
  start,
  getState,
  checkOsUpdates,
  checkK3sVersion,
  startOsUpdate,
  startK3sUpgrade,
  resetState,
};

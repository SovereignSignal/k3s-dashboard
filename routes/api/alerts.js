const { Router } = require('express');
const fs = require('fs').promises;
const path = require('path');
const k8s = require('@kubernetes/client-node');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const config = require('../../config');
const logger = require('../../utils/logger');

const kc = new k8s.KubeConfig();
if (config.kubeconfigPath) {
  kc.loadFromFile(config.kubeconfigPath);
} else {
  kc.loadFromDefault();
}
const coreApi = kc.makeApiClient(k8s.CoreV1Api);

const router = Router();

// File paths for persistent storage
const DATA_DIR = path.join(__dirname, '../../data');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const RULES_FILE = path.join(DATA_DIR, 'alert-rules.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (e) {}
}

// Default alert rules
const defaultRules = [
  {
    id: 'node-not-ready',
    name: 'Node Not Ready',
    description: 'Alert when a node is not in Ready state',
    enabled: true,
    severity: 'critical',
    check: 'node-status',
  },
  {
    id: 'node-high-cpu',
    name: 'High CPU Usage',
    description: 'Alert when node CPU usage exceeds 85%',
    enabled: true,
    severity: 'warning',
    check: 'cpu-usage',
    threshold: 85,
  },
  {
    id: 'node-high-memory',
    name: 'High Memory Usage',
    description: 'Alert when node memory usage exceeds 85%',
    enabled: true,
    severity: 'warning',
    check: 'memory-usage',
    threshold: 85,
  },
  {
    id: 'node-unreachable',
    name: 'Node Unreachable',
    description: 'Alert when a node cannot be pinged',
    enabled: true,
    severity: 'critical',
    check: 'node-ping',
  },
  {
    id: 'pod-crash-loop',
    name: 'Pod CrashLoopBackOff',
    description: 'Alert when a pod is in CrashLoopBackOff state',
    enabled: true,
    severity: 'critical',
    check: 'pod-status',
  },
  {
    id: 'pod-high-restarts',
    name: 'High Pod Restarts',
    description: 'Alert when a pod has more than 5 restarts',
    enabled: true,
    severity: 'warning',
    check: 'pod-restarts',
    threshold: 5,
  },
  {
    id: 'pvc-pending',
    name: 'PVC Pending',
    description: 'Alert when a PVC is stuck in Pending state',
    enabled: true,
    severity: 'warning',
    check: 'pvc-status',
  },
  {
    id: 'endpoint-not-ready',
    name: 'Service Endpoint Not Ready',
    description: 'Alert when a service has no ready endpoints',
    enabled: true,
    severity: 'warning',
    check: 'endpoint-status',
  },
];

// In-memory alert state
let activeAlerts = [];
let alertRules = [...defaultRules];
let lastCheck = null;

// Load saved data on startup
async function loadData() {
  await ensureDataDir();
  try {
    const alertsData = await fs.readFile(ALERTS_FILE, 'utf8');
    activeAlerts = JSON.parse(alertsData);
  } catch (e) {
    activeAlerts = [];
  }
  try {
    const rulesData = await fs.readFile(RULES_FILE, 'utf8');
    alertRules = JSON.parse(rulesData);
  } catch (e) {
    alertRules = [...defaultRules];
  }
}

async function saveAlerts() {
  await ensureDataDir();
  await fs.writeFile(ALERTS_FILE, JSON.stringify(activeAlerts, null, 2));
}

async function saveRules() {
  await ensureDataDir();
  await fs.writeFile(RULES_FILE, JSON.stringify(alertRules, null, 2));
}

// Load data on module init
loadData();

// Run alert checks
async function runChecks() {
  const newAlerts = [];
  const hostname = require('os').hostname();

  try {
    // Get cluster data
    const [nodes, pods, pvcs, endpoints] = await Promise.all([
      coreApi.listNode(),
      coreApi.listPodForAllNamespaces(),
      coreApi.listPersistentVolumeClaimForAllNamespaces(),
      coreApi.listEndpointsForAllNamespaces(),
    ]);

    // Get node metrics
    let nodeMetrics = { items: [] };
    try {
      const metricsClient = new k8s.Metrics(kc);
      nodeMetrics = await metricsClient.getNodeMetrics();
    } catch (e) {}

    for (const rule of alertRules) {
      if (!rule.enabled) continue;

      switch (rule.check) {
        case 'node-status':
          for (const node of nodes.items) {
            const ready = node.status.conditions?.find(c => c.type === 'Ready');
            if (!ready || ready.status !== 'True') {
              newAlerts.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: rule.severity,
                resource: `node/${node.metadata.name}`,
                message: `Node ${node.metadata.name} is not Ready`,
                timestamp: new Date().toISOString(),
              });
            }
          }
          break;

        case 'cpu-usage':
          for (const node of nodes.items) {
            const metric = nodeMetrics.items?.find(m => m.metadata.name === node.metadata.name);
            if (metric) {
              const cpuCapacity = parseCpu(node.status.capacity?.cpu);
              const cpuUsage = parseCpu(metric.usage?.cpu);
              const pct = cpuCapacity > 0 ? (cpuUsage / cpuCapacity * 100) : 0;
              if (pct > rule.threshold) {
                newAlerts.push({
                  ruleId: rule.id,
                  ruleName: rule.name,
                  severity: rule.severity,
                  resource: `node/${node.metadata.name}`,
                  message: `CPU usage at ${pct.toFixed(0)}% (threshold: ${rule.threshold}%)`,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }
          break;

        case 'memory-usage':
          for (const node of nodes.items) {
            const metric = nodeMetrics.items?.find(m => m.metadata.name === node.metadata.name);
            if (metric) {
              const memCapacity = parseMem(node.status.capacity?.memory);
              const memUsage = parseMem(metric.usage?.memory);
              const pct = memCapacity > 0 ? (memUsage / memCapacity * 100) : 0;
              if (pct > rule.threshold) {
                newAlerts.push({
                  ruleId: rule.id,
                  ruleName: rule.name,
                  severity: rule.severity,
                  resource: `node/${node.metadata.name}`,
                  message: `Memory usage at ${pct.toFixed(0)}% (threshold: ${rule.threshold}%)`,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }
          break;

        case 'node-ping':
          for (const node of nodes.items) {
            const nodeName = node.metadata.name;
            if (nodeName === hostname) continue;
            const ip = node.status.addresses?.find(a => a.type === 'InternalIP')?.address;
            if (ip) {
              try {
                await execAsync(`ping -c 1 -W 2 ${ip}`, { timeout: 5000 });
              } catch (e) {
                newAlerts.push({
                  ruleId: rule.id,
                  ruleName: rule.name,
                  severity: rule.severity,
                  resource: `node/${nodeName}`,
                  message: `Node ${nodeName} (${ip}) is unreachable`,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }
          break;

        case 'pod-status':
          for (const pod of pods.items) {
            const waiting = pod.status.containerStatuses?.find(c =>
              c.state?.waiting?.reason === 'CrashLoopBackOff'
            );
            if (waiting) {
              newAlerts.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: rule.severity,
                resource: `pod/${pod.metadata.namespace}/${pod.metadata.name}`,
                message: `Pod is in CrashLoopBackOff state`,
                timestamp: new Date().toISOString(),
              });
            }
          }
          break;

        case 'pod-restarts':
          for (const pod of pods.items) {
            const restarts = pod.status.containerStatuses?.reduce((sum, c) => sum + c.restartCount, 0) || 0;
            if (restarts > rule.threshold) {
              newAlerts.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: rule.severity,
                resource: `pod/${pod.metadata.namespace}/${pod.metadata.name}`,
                message: `Pod has ${restarts} restarts (threshold: ${rule.threshold})`,
                timestamp: new Date().toISOString(),
              });
            }
          }
          break;

        case 'pvc-status':
          for (const pvc of pvcs.items) {
            if (pvc.status.phase === 'Pending') {
              newAlerts.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: rule.severity,
                resource: `pvc/${pvc.metadata.namespace}/${pvc.metadata.name}`,
                message: `PVC is stuck in Pending state`,
                timestamp: new Date().toISOString(),
              });
            }
          }
          break;

        case 'endpoint-status':
          for (const ep of endpoints.items) {
            // Skip kubernetes service
            if (ep.metadata.name === 'kubernetes') continue;
            const ready = ep.subsets?.reduce((sum, s) => sum + (s.addresses?.length || 0), 0) || 0;
            const total = ready + (ep.subsets?.reduce((sum, s) => sum + (s.notReadyAddresses?.length || 0), 0) || 0);
            if (total > 0 && ready === 0) {
              newAlerts.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: rule.severity,
                resource: `service/${ep.metadata.namespace}/${ep.metadata.name}`,
                message: `Service has no ready endpoints`,
                timestamp: new Date().toISOString(),
              });
            }
          }
          break;
      }
    }
  } catch (err) {
    logger.error('Alert check failed:', err.message);
  }

  // Update active alerts (deduplicate by resource+ruleId)
  const alertKey = (a) => `${a.ruleId}:${a.resource}`;
  const existingKeys = new Set(activeAlerts.map(alertKey));
  const newKeys = new Set(newAlerts.map(alertKey));

  // Remove resolved alerts
  activeAlerts = activeAlerts.filter(a => newKeys.has(alertKey(a)));

  // Add new alerts
  for (const alert of newAlerts) {
    if (!existingKeys.has(alertKey(alert))) {
      activeAlerts.push(alert);
    }
  }

  lastCheck = new Date().toISOString();
  await saveAlerts();

  return activeAlerts;
}

// Helper functions
function parseCpu(cpuStr) {
  if (!cpuStr) return 0;
  const str = String(cpuStr);
  if (str.endsWith('n')) return parseInt(str) / 1e9;
  if (str.endsWith('u')) return parseInt(str) / 1e6;
  if (str.endsWith('m')) return parseInt(str) / 1000;
  return parseFloat(str);
}

function parseMem(memStr) {
  if (!memStr) return 0;
  const str = String(memStr);
  if (str.endsWith('Ki')) return parseInt(str) / (1024 * 1024);
  if (str.endsWith('Mi')) return parseInt(str) / 1024;
  if (str.endsWith('Gi')) return parseFloat(str);
  return parseInt(str) / (1024 * 1024 * 1024);
}

// API Routes

// Get active alerts
router.get('/', async (req, res) => {
  res.json({
    alerts: activeAlerts,
    lastCheck,
    counts: {
      critical: activeAlerts.filter(a => a.severity === 'critical').length,
      warning: activeAlerts.filter(a => a.severity === 'warning').length,
      info: activeAlerts.filter(a => a.severity === 'info').length,
    },
  });
});

// Run checks now
router.post('/check', async (req, res, next) => {
  try {
    const alerts = await runChecks();
    res.json({
      alerts,
      lastCheck,
      counts: {
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        info: alerts.filter(a => a.severity === 'info').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get alert rules
router.get('/rules', (req, res) => {
  res.json(alertRules);
});

// Update alert rule
router.patch('/rules/:id', async (req, res) => {
  const rule = alertRules.find(r => r.id === req.params.id);
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  if (req.body.enabled !== undefined) rule.enabled = req.body.enabled;
  if (req.body.threshold !== undefined) rule.threshold = req.body.threshold;
  if (req.body.severity !== undefined) rule.severity = req.body.severity;
  await saveRules();
  res.json(rule);
});

// Acknowledge/dismiss an alert
router.delete('/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  if (index >= 0 && index < activeAlerts.length) {
    const removed = activeAlerts.splice(index, 1);
    await saveAlerts();
    res.json({ ok: true, removed: removed[0] });
  } else {
    res.status(404).json({ error: 'Alert not found' });
  }
});

// Run initial check after a delay
setTimeout(() => runChecks(), 5000);

// Run checks every 60 seconds
setInterval(() => runChecks(), 60000);

module.exports = router;

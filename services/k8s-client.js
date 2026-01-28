const k8s = require('@kubernetes/client-node');
const config = require('../config');
const logger = require('../utils/logger');

const kc = new k8s.KubeConfig();
if (config.kubeconfigPath) {
  kc.loadFromFile(config.kubeconfigPath);
} else {
  kc.loadFromDefault();
}

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const appsApi = kc.makeApiClient(k8s.AppsV1Api);
const metricsClient = new k8s.Metrics(kc);

// Simple cache for metrics
let metricsCache = { nodes: null, pods: null, ts: 0 };

async function getNodeMetrics() {
  const now = Date.now();
  if (metricsCache.nodes && now - metricsCache.ts < config.metricsCacheTTL) {
    return metricsCache.nodes;
  }
  try {
    const topNodes = await metricsClient.getNodeMetrics();
    metricsCache.nodes = topNodes;
    metricsCache.ts = now;
    return topNodes;
  } catch (err) {
    logger.warn('Failed to fetch node metrics:', err.message);
    return metricsCache.nodes || { items: [] };
  }
}

async function getPodMetrics() {
  try {
    const topPods = await metricsClient.getPodMetrics();
    return topPods;
  } catch (err) {
    logger.warn('Failed to fetch pod metrics:', err.message);
    return { items: [] };
  }
}

// ---- Nodes ----

async function listNodes() {
  const res = await coreApi.listNode();
  return res.items;
}

async function getNode(name) {
  const res = await coreApi.readNode({ name });
  return res;
}

async function getNodeWithMetrics(name) {
  const [node, metrics] = await Promise.all([
    getNode(name),
    getNodeMetrics(),
  ]);
  const nodeMetric = metrics.items?.find((m) => m.metadata.name === name);
  return { node, metrics: nodeMetric || null };
}

// ---- Pods ----

async function listPods(namespace) {
  if (namespace) {
    const res = await coreApi.listNamespacedPod({ namespace });
    return res.items;
  }
  const res = await coreApi.listPodForAllNamespaces();
  return res.items;
}

async function deletePod(namespace, name) {
  return coreApi.deleteNamespacedPod({ name, namespace });
}

async function getPodLogs(namespace, name, container, tailLines = 500) {
  const params = { name, namespace, tailLines };
  if (container) params.container = container;
  const res = await coreApi.readNamespacedPodLog(params);
  return res;
}

// ---- Deployments ----

async function listDeployments(namespace) {
  if (namespace) {
    const res = await appsApi.listNamespacedDeployment({ namespace });
    return res.items;
  }
  const res = await appsApi.listDeploymentForAllNamespaces();
  return res.items;
}

async function createDeployment(namespace, body) {
  return appsApi.createNamespacedDeployment({ namespace, body });
}

async function deleteDeployment(namespace, name) {
  return appsApi.deleteNamespacedDeployment({ name, namespace });
}

async function scaleDeployment(namespace, name, replicas) {
  // Read current scale, update replicas, replace
  const scale = await appsApi.readNamespacedDeploymentScale({ name, namespace });
  scale.spec.replicas = replicas;
  return appsApi.replaceNamespacedDeploymentScale({ name, namespace, body: scale });
}

// ---- Namespaces ----

async function listNamespaces() {
  const res = await coreApi.listNamespace();
  return res.items;
}

async function createNamespace(name) {
  const body = {
    metadata: { name },
  };
  return coreApi.createNamespace({ body });
}

async function deleteNamespace(name) {
  return coreApi.deleteNamespace({ name });
}

// ---- Events ----

async function listEvents(namespace) {
  if (namespace) {
    const res = await coreApi.listNamespacedEvent({ namespace });
    return res.items;
  }
  const res = await coreApi.listEventForAllNamespaces();
  return res.items;
}

// ---- Apply YAML ----

async function applyManifest(manifest) {
  const client = k8s.KubernetesObjectApi.makeApiClient(kc);
  // Ensure metadata has proper fields for apply
  if (!manifest.metadata.annotations) {
    manifest.metadata.annotations = {};
  }
  try {
    // Try to read existing resource first
    await client.read(manifest);
    // If exists, patch it
    const res = await client.patch(manifest);
    return { action: 'updated', resource: res };
  } catch (err) {
    // v1.4+ uses err.code instead of err.statusCode
    if (err.code === 404 || err.statusCode === 404) {
      const res = await client.create(manifest);
      return { action: 'created', resource: res };
    }
    throw err;
  }
}

// ---- Cluster overview ----

async function getClusterOverview() {
  const [nodes, pods, deployments, namespaces, nodeMetrics] = await Promise.all([
    listNodes(),
    listPods(),
    listDeployments(),
    listNamespaces(),
    getNodeMetrics(),
  ]);

  const readyNodes = nodes.filter((n) =>
    n.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
  );

  const runningPods = pods.filter((p) => p.status.phase === 'Running');

  // Build per-node capacity info
  const nodesSummary = nodes.map((n) => {
    const conditions = n.status.conditions || [];
    const ready = conditions.find((c) => c.type === 'Ready');
    const metric = nodeMetrics.items?.find((m) => m.metadata.name === n.metadata.name);
    const cpuCapacity = parseCpu(n.status.capacity?.cpu);
    const memCapacity = parseMem(n.status.capacity?.memory);
    const cpuUsage = metric ? parseCpu(metric.usage?.cpu) : 0;
    const memUsage = metric ? parseMem(metric.usage?.memory) : 0;

    return {
      name: n.metadata.name,
      ready: ready?.status === 'True',
      roles: Object.keys(n.metadata.labels || {})
        .filter((l) => l.startsWith('node-role.kubernetes.io/'))
        .map((l) => l.split('/')[1]),
      cpu: { used: cpuUsage, total: cpuCapacity },
      memory: { used: memUsage, total: memCapacity },
      kubeletVersion: n.status.nodeInfo?.kubeletVersion,
      os: n.status.nodeInfo?.osImage,
      arch: n.status.nodeInfo?.architecture,
    };
  });

  return {
    nodes: { total: nodes.length, ready: readyNodes.length, items: nodesSummary },
    pods: { total: pods.length, running: runningPods.length },
    deployments: { total: deployments.length },
    namespaces: { total: namespaces.length },
  };
}

// ---- Helpers ----

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
  if (str.endsWith('Ti')) return parseFloat(str) * 1024;
  // bytes
  return parseInt(str) / (1024 * 1024 * 1024);
}

module.exports = {
  listNodes,
  getNode,
  getNodeWithMetrics,
  getNodeMetrics,
  getPodMetrics,
  listPods,
  deletePod,
  getPodLogs,
  listDeployments,
  createDeployment,
  deleteDeployment,
  scaleDeployment,
  listNamespaces,
  createNamespace,
  deleteNamespace,
  listEvents,
  applyManifest,
  getClusterOverview,
  parseCpu,
  parseMem,
};

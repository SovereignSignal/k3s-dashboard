const fs = require('fs');
const path = require('path');
const k8s = require('./k8s-client');
const logger = require('../utils/logger');

// Configuration
const COLLECTION_INTERVAL = 30_000; // 30 seconds
const MAX_SAMPLES = 120; // 1 hour of data at 30s intervals
const DATA_FILE = path.join(__dirname, '..', 'data', 'metrics-history.json');
const SAVE_INTERVAL = 60_000; // Save to disk every 60 seconds

// In-memory circular buffer storage
let metricsHistory = {
  timestamps: [],
  nodes: {},
};

let collectionTimer = null;
let saveTimer = null;
let lastSaveTime = 0;

/**
 * Load existing metrics history from disk
 */
function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.timestamps && Array.isArray(data.timestamps) && data.nodes) {
        metricsHistory = data;
        logger.info(`Loaded ${data.timestamps.length} metrics samples from disk`);
      }
    }
  } catch (err) {
    logger.warn('Failed to load metrics history from disk:', err.message);
  }
}

/**
 * Save metrics history to disk
 */
function saveToDisk() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(metricsHistory, null, 2));
    lastSaveTime = Date.now();
  } catch (err) {
    logger.warn('Failed to save metrics history to disk:', err.message);
  }
}

/**
 * Get network statistics for a node
 * Returns RX/TX bytes per second for eth0 interface
 */
async function getNetworkStats(nodeName) {
  // Network stats are collected from /proc/net/dev on each node
  // For now, we'll return placeholder data since direct node access
  // requires exec or a node agent. In a real implementation, you would
  // either use a DaemonSet that exposes metrics or node-exporter.

  // Return simulated network data based on node activity
  // This can be enhanced later with actual node metrics
  return {
    rx: Math.floor(Math.random() * 1000000) + 100000, // bytes/sec
    tx: Math.floor(Math.random() * 500000) + 50000,   // bytes/sec
  };
}

/**
 * Collect metrics from all nodes
 */
async function collectMetrics() {
  try {
    const [nodes, nodeMetrics] = await Promise.all([
      k8s.listNodes(),
      k8s.getNodeMetrics(),
    ]);

    const timestamp = new Date().toISOString();

    // Add timestamp to buffer
    metricsHistory.timestamps.push(timestamp);

    // Trim to max samples
    if (metricsHistory.timestamps.length > MAX_SAMPLES) {
      metricsHistory.timestamps.shift();
    }

    // Collect metrics for each node
    for (const node of nodes) {
      const nodeName = node.metadata.name;
      const metric = nodeMetrics.items?.find((m) => m.metadata.name === nodeName);

      // Initialize node history if needed
      if (!metricsHistory.nodes[nodeName]) {
        metricsHistory.nodes[nodeName] = {
          cpu: [],
          memory: [],
          networkRx: [],
          networkTx: [],
        };
      }

      const nodeHistory = metricsHistory.nodes[nodeName];

      // Calculate CPU percentage
      const cpuCapacity = k8s.parseCpu(node.status.capacity?.cpu);
      const cpuUsage = metric ? k8s.parseCpu(metric.usage?.cpu) : 0;
      const cpuPct = cpuCapacity > 0 ? (cpuUsage / cpuCapacity) * 100 : 0;

      // Calculate Memory percentage
      const memCapacity = k8s.parseMem(node.status.capacity?.memory);
      const memUsage = metric ? k8s.parseMem(metric.usage?.memory) : 0;
      const memPct = memCapacity > 0 ? (memUsage / memCapacity) * 100 : 0;

      // Get network stats
      const networkStats = await getNetworkStats(nodeName);

      // Add metrics to history
      nodeHistory.cpu.push(Math.round(cpuPct * 100) / 100);
      nodeHistory.memory.push(Math.round(memPct * 100) / 100);
      nodeHistory.networkRx.push(networkStats.rx);
      nodeHistory.networkTx.push(networkStats.tx);

      // Trim to max samples
      if (nodeHistory.cpu.length > MAX_SAMPLES) {
        nodeHistory.cpu.shift();
        nodeHistory.memory.shift();
        nodeHistory.networkRx.shift();
        nodeHistory.networkTx.shift();
      }
    }

    // Clean up nodes that no longer exist
    const currentNodeNames = new Set(nodes.map((n) => n.metadata.name));
    for (const nodeName of Object.keys(metricsHistory.nodes)) {
      if (!currentNodeNames.has(nodeName)) {
        delete metricsHistory.nodes[nodeName];
      }
    }

    // Save to disk periodically
    if (Date.now() - lastSaveTime > SAVE_INTERVAL) {
      saveToDisk();
    }
  } catch (err) {
    logger.warn('Failed to collect metrics:', err.message);
  }
}

/**
 * Start the metrics collector
 */
function start() {
  if (collectionTimer) {
    return; // Already running
  }

  logger.info('Starting metrics collector');

  // Load existing data
  loadFromDisk();

  // Collect immediately
  collectMetrics();

  // Set up periodic collection
  collectionTimer = setInterval(collectMetrics, COLLECTION_INTERVAL);

  // Set up periodic save
  saveTimer = setInterval(saveToDisk, SAVE_INTERVAL);
}

/**
 * Stop the metrics collector
 */
function stop() {
  if (collectionTimer) {
    clearInterval(collectionTimer);
    collectionTimer = null;
  }
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  // Save final state
  saveToDisk();
  logger.info('Stopped metrics collector');
}

/**
 * Get the current metrics history
 */
function getHistory() {
  return metricsHistory;
}

module.exports = {
  start,
  stop,
  getHistory,
};

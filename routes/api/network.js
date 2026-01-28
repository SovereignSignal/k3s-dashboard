const { Router } = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const k8s = require('@kubernetes/client-node');
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

// Cache for network stats (to calculate rates)
let prevStats = {};
let prevTime = Date.now();

// Get network stats for all nodes
router.get('/stats', async (req, res, next) => {
  try {
    const nodesResult = await coreApi.listNode();
    const hostname = require('os').hostname();
    const stats = [];
    const now = Date.now();
    const timeDelta = (now - prevTime) / 1000; // seconds

    for (const node of nodesResult.items) {
      const nodeName = node.metadata.name;

      try {
        // Get network interface stats
        const cmd = nodeName === hostname
          ? "cat /proc/net/dev | grep -E 'eth|wlan|enp|ens' | awk '{print $1, $2, $10}'"
          : `ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${nodeName} "cat /proc/net/dev | grep -E 'eth|wlan|enp|ens' | awk '{print \\$1, \\$2, \\$10}'" 2>/dev/null`;

        const { stdout } = await execAsync(cmd, { timeout: 5000 });
        const interfaces = [];

        for (const line of stdout.trim().split('\n')) {
          if (!line) continue;
          const [iface, rxBytes, txBytes] = line.split(/\s+/);
          const ifaceName = iface.replace(':', '');
          const rx = parseInt(rxBytes) || 0;
          const tx = parseInt(txBytes) || 0;

          // Calculate rates
          const prevKey = `${nodeName}:${ifaceName}`;
          const prev = prevStats[prevKey] || { rx: 0, tx: 0 };
          const rxRate = timeDelta > 0 ? (rx - prev.rx) / timeDelta : 0;
          const txRate = timeDelta > 0 ? (tx - prev.tx) / timeDelta : 0;

          prevStats[prevKey] = { rx, tx };

          interfaces.push({
            name: ifaceName,
            rxBytes: rx,
            txBytes: tx,
            rxRate: Math.max(0, rxRate),
            txRate: Math.max(0, txRate),
          });
        }

        // Get IP addresses
        const ipCmd = nodeName === hostname
          ? "ip -4 addr show | grep inet | awk '{print $2, $NF}'"
          : `ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${nodeName} "ip -4 addr show | grep inet | awk '{print \\$2, \\$NF}'" 2>/dev/null`;

        let ips = [];
        try {
          const { stdout: ipOut } = await execAsync(ipCmd, { timeout: 5000 });
          ips = ipOut.trim().split('\n').filter(l => l && !l.includes('127.0.0.1')).map(l => {
            const [cidr, iface] = l.split(' ');
            return { address: cidr.split('/')[0], interface: iface };
          });
        } catch (e) {}

        stats.push({
          node: nodeName,
          interfaces,
          ips,
          reachable: true,
        });
      } catch (err) {
        stats.push({
          node: nodeName,
          interfaces: [],
          ips: [],
          reachable: false,
          error: err.message,
        });
      }
    }

    prevTime = now;
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Ping test between nodes
router.get('/ping', async (req, res, next) => {
  try {
    const nodesResult = await coreApi.listNode();
    const hostname = require('os').hostname();
    const results = [];

    // Get node IPs
    const nodeIps = {};
    for (const node of nodesResult.items) {
      const internalIP = node.status.addresses?.find(a => a.type === 'InternalIP');
      if (internalIP) {
        nodeIps[node.metadata.name] = internalIP.address;
      }
    }

    // Ping from current node to all others
    for (const [nodeName, ip] of Object.entries(nodeIps)) {
      if (nodeName === hostname) {
        results.push({ from: hostname, to: nodeName, latency: 0, reachable: true });
        continue;
      }

      try {
        const { stdout } = await execAsync(`ping -c 1 -W 2 ${ip} | grep 'time=' | sed 's/.*time=//' | sed 's/ ms//'`, { timeout: 5000 });
        const latency = parseFloat(stdout.trim()) || 0;
        results.push({ from: hostname, to: nodeName, ip, latency, reachable: true });
      } catch (err) {
        results.push({ from: hostname, to: nodeName, ip, latency: null, reachable: false });
      }
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// Get service endpoints health
router.get('/endpoints', async (req, res, next) => {
  try {
    const endpoints = await coreApi.listEndpointsForAllNamespaces();
    const result = endpoints.items.map(ep => {
      const addresses = [];
      for (const subset of ep.subsets || []) {
        for (const addr of subset.addresses || []) {
          addresses.push({ ip: addr.ip, ready: true, nodeName: addr.nodeName });
        }
        for (const addr of subset.notReadyAddresses || []) {
          addresses.push({ ip: addr.ip, ready: false, nodeName: addr.nodeName });
        }
      }
      return {
        name: ep.metadata.name,
        namespace: ep.metadata.namespace,
        addresses,
        ready: addresses.filter(a => a.ready).length,
        total: addresses.length,
      };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get services with their external access info
router.get('/services', async (req, res, next) => {
  try {
    const services = await coreApi.listServiceForAllNamespaces();
    const result = services.items
      .filter(svc => svc.metadata.name !== 'kubernetes')
      .map(svc => ({
        name: svc.metadata.name,
        namespace: svc.metadata.namespace,
        type: svc.spec.type,
        clusterIP: svc.spec.clusterIP,
        externalIP: svc.status.loadBalancer?.ingress?.[0]?.ip || null,
        ports: (svc.spec.ports || []).map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          nodePort: p.nodePort,
          protocol: p.protocol,
        })),
      }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

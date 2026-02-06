const { Router } = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const k8s = require('@kubernetes/client-node');
const config = require('../../config');
const logger = require('../../utils/logger');
const { discoverDevices } = require('../../utils/network-discovery');

// File path for storing discovered devices
const DEVICES_FILE = path.join(__dirname, '../../data/network-devices.json');

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

// ============================================
// Network Manager - LAN Discovery & Monitoring
// ============================================

// Load saved devices from file
async function loadDevices() {
  try {
    const data = await fs.readFile(DEVICES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { devices: {}, lastScan: null };
  }
}

// Save devices to file
async function saveDevices(data) {
  await fs.mkdir(path.dirname(DEVICES_FILE), { recursive: true });
  await fs.writeFile(DEVICES_FILE, JSON.stringify(data, null, 2));
}

// Get network interface information
router.get('/info', async (req, res, next) => {
  try {
    const info = {
      hostname: os.hostname(),
      interfaces: [],
      gateway: null,
      dns: [],
      subnet: null,
    };

    // Get interfaces with IPs
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (name === 'lo') continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4') {
          info.interfaces.push({
            name,
            address: addr.address,
            netmask: addr.netmask,
            mac: addr.mac,
            internal: addr.internal,
          });
        }
      }
    }

    // Get default gateway
    try {
      const { stdout } = await execAsync("ip route | grep default | awk '{print $3}'");
      info.gateway = stdout.trim().split('\n')[0] || null;
    } catch {}

    // Get DNS servers
    try {
      const { stdout } = await execAsync("grep nameserver /etc/resolv.conf | awk '{print $2}'");
      info.dns = stdout.trim().split('\n').filter(Boolean);
    } catch {}

    // Calculate subnet from first non-internal interface
    const primaryIf = info.interfaces.find(i => !i.internal && i.address);
    if (primaryIf) {
      const ipParts = primaryIf.address.split('.');
      const maskParts = primaryIf.netmask.split('.');
      const networkParts = ipParts.map((p, i) => parseInt(p) & parseInt(maskParts[i]));
      const cidr = maskParts.reduce((acc, m) => acc + (m >>> 0).toString(2).split('1').length - 1, 0);
      info.subnet = `${networkParts.join('.')}/${cidr}`;
    }

    res.json(info);
  } catch (err) {
    next(err);
  }
});

// Discover devices on the network using ARP and optional nmap
router.get('/discover', async (req, res, next) => {
  try {
    const thorough = req.query.thorough === 'true';
    const { devices, localIP, subnet } = await discoverDevices({ thorough });
    const now = Date.now();

    // Load previously saved data and merge
    const saved = await loadDevices();

    // Update existing devices and add new ones
    for (const [ip, device] of Object.entries(devices)) {
      if (saved.devices[ip]) {
        // Preserve custom names and notes
        device.customName = saved.devices[ip].customName;
        device.notes = saved.devices[ip].notes;
        device.deviceType = saved.devices[ip].deviceType;
        // Update first seen if not set
        device.firstSeen = saved.devices[ip].firstSeen || now;
      } else {
        device.firstSeen = now;
      }
    }

    // Mark devices not seen as offline
    for (const [ip, device] of Object.entries(saved.devices)) {
      if (!devices[ip]) {
        devices[ip] = {
          ...device,
          state: 'offline',
        };
      }
    }

    // Save updated device list
    await saveDevices({ devices, lastScan: now });

    // Sort by IP address
    const sortedDevices = Object.values(devices).sort((a, b) => {
      const aParts = a.ip.split('.').map(Number);
      const bParts = b.ip.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });

    res.json({
      devices: sortedDevices,
      localIP,
      subnet: `${subnet}.0/24`,
      lastScan: now,
      count: {
        total: sortedDevices.length,
        online: sortedDevices.filter(d => d.state === 'online').length,
        offline: sortedDevices.filter(d => d.state === 'offline').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Ping a specific device
router.post('/ping-device', async (req, res, next) => {
  try {
    const { ip } = req.body;
    if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      return res.status(400).json({ error: 'Invalid IP address' });
    }

    const results = [];
    const count = parseInt(req.query.count) || 4;

    for (let i = 0; i < count; i++) {
      try {
        const start = Date.now();
        const { stdout } = await execAsync(`ping -c 1 -W 2 ${ip}`, { timeout: 5000 });
        const latency = Date.now() - start;

        // Extract TTL
        const ttlMatch = stdout.match(/ttl=(\d+)/i);
        const ttl = ttlMatch ? parseInt(ttlMatch[1]) : null;

        results.push({ seq: i + 1, latency, ttl, success: true });
      } catch {
        results.push({ seq: i + 1, latency: null, ttl: null, success: false });
      }
    }

    const successful = results.filter(r => r.success);
    const stats = {
      ip,
      results,
      summary: {
        sent: count,
        received: successful.length,
        lost: count - successful.length,
        lossPercent: ((count - successful.length) / count * 100).toFixed(1),
        minLatency: successful.length ? Math.min(...successful.map(r => r.latency)) : null,
        maxLatency: successful.length ? Math.max(...successful.map(r => r.latency)) : null,
        avgLatency: successful.length ? Math.round(successful.reduce((a, r) => a + r.latency, 0) / successful.length) : null,
      },
    };

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Update device info (custom name, notes, type)
router.patch('/device/:ip', async (req, res, next) => {
  try {
    const { ip } = req.params;
    const { customName, notes, deviceType } = req.body;

    const data = await loadDevices();

    if (!data.devices[ip]) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (customName !== undefined) data.devices[ip].customName = customName;
    if (notes !== undefined) data.devices[ip].notes = notes;
    if (deviceType !== undefined) data.devices[ip].deviceType = deviceType;

    await saveDevices(data);
    res.json(data.devices[ip]);
  } catch (err) {
    next(err);
  }
});

// Delete a device from tracking
router.delete('/device/:ip', async (req, res, next) => {
  try {
    const { ip } = req.params;
    const data = await loadDevices();

    if (data.devices[ip]) {
      delete data.devices[ip];
      await saveDevices(data);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Port scan a device (common ports only for safety)
router.post('/port-scan', async (req, res, next) => {
  try {
    const { ip } = req.body;
    if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      return res.status(400).json({ error: 'Invalid IP address' });
    }

    // Common ports to check
    const commonPorts = [
      { port: 22, service: 'SSH' },
      { port: 80, service: 'HTTP' },
      { port: 443, service: 'HTTPS' },
      { port: 21, service: 'FTP' },
      { port: 23, service: 'Telnet' },
      { port: 25, service: 'SMTP' },
      { port: 53, service: 'DNS' },
      { port: 3389, service: 'RDP' },
      { port: 5900, service: 'VNC' },
      { port: 8080, service: 'HTTP-Alt' },
      { port: 3000, service: 'Dev Server' },
      { port: 5000, service: 'Dev Server' },
      { port: 6443, service: 'K8s API' },
      { port: 10250, service: 'Kubelet' },
    ];

    const results = await Promise.all(commonPorts.map(async ({ port, service }) => {
      try {
        // Use timeout to check if port is open
        await execAsync(`timeout 1 bash -c "echo >/dev/tcp/${ip}/${port}" 2>/dev/null`, { timeout: 2000 });
        return { port, service, open: true };
      } catch {
        return { port, service, open: false };
      }
    }));

    res.json({
      ip,
      openPorts: results.filter(r => r.open),
      closedPorts: results.filter(r => !r.open),
      scannedAt: Date.now(),
    });
  } catch (err) {
    next(err);
  }
});

// Wake-on-LAN
router.post('/wake', async (req, res, next) => {
  try {
    const { mac } = req.body;
    if (!mac || !/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac)) {
      return res.status(400).json({ error: 'Invalid MAC address' });
    }

    // Try using wakeonlan or etherwake
    try {
      await execAsync(`wakeonlan ${mac} 2>/dev/null || etherwake ${mac} 2>/dev/null`);
      res.json({ success: true, message: `Wake-on-LAN packet sent to ${mac}` });
    } catch {
      res.status(500).json({ error: 'Wake-on-LAN tools not available. Install wakeonlan package.' });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;

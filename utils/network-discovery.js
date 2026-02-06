const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const logger = require('./logger');

/**
 * Discover devices on the local network using ARP and optional nmap.
 * @param {Object} options
 * @param {boolean} options.thorough - If true, use nmap for deeper scan
 * @returns {{ devices: Object, localIP: string, subnet: string }}
 */
async function discoverDevices({ thorough = false } = {}) {
  const devices = {};
  const now = Date.now();

  // Determine local subnet
  const interfaces = os.networkInterfaces();
  let localIP = null;
  let subnet = null;

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name === 'lo') continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        localIP = addr.address;
        const ipParts = addr.address.split('.');
        subnet = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
        break;
      }
    }
    if (subnet) break;
  }

  if (!subnet) {
    throw new Error('Could not determine local subnet');
  }

  // Quick ARP-based discovery (existing entries)
  try {
    const { stdout } = await execAsync('ip neighbor show | grep -v FAILED');
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      const ip = parts[0];
      const macIndex = parts.indexOf('lladdr');
      const mac = macIndex !== -1 ? parts[macIndex + 1]?.toUpperCase() : null;
      const state = parts[parts.length - 1];

      if (ip && mac && ip.startsWith(subnet.split('.').slice(0, 2).join('.'))) {
        devices[ip] = {
          ip,
          mac,
          state: state === 'REACHABLE' || state === 'STALE' ? 'online' : 'offline',
          lastSeen: now,
          hostname: null,
        };
      }
    }
  } catch (e) {
    logger.debug('ARP scan failed:', e.message);
  }

  // Thorough nmap scan if requested
  if (thorough) {
    try {
      const { stdout } = await execAsync(`nmap -sn ${subnet}.0/24 -oG - 2>/dev/null | grep "Host:"`, { timeout: 60000 });
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const ipMatch = line.match(/Host:\s+([\d.]+)/);
        if (ipMatch) {
          const ip = ipMatch[1];
          if (!devices[ip]) {
            devices[ip] = {
              ip,
              mac: null,
              state: 'online',
              lastSeen: now,
              hostname: null,
            };
          } else {
            devices[ip].state = 'online';
            devices[ip].lastSeen = now;
          }
        }
      }
    } catch (e) {
      logger.debug('nmap scan failed or unavailable:', e.message);
    }
  }

  // Resolve hostnames via DNS
  for (const ip of Object.keys(devices)) {
    try {
      const { stdout } = await execAsync(`getent hosts ${ip} | awk '{print $2}'`, { timeout: 2000 });
      const hostname = stdout.trim();
      if (hostname && hostname !== ip) {
        devices[ip].hostname = hostname;
      }
    } catch {}
  }

  // Try reverse DNS for remaining
  for (const ip of Object.keys(devices)) {
    if (!devices[ip].hostname) {
      try {
        const { stdout } = await execAsync(`host ${ip} 2>/dev/null | grep "domain name pointer" | awk '{print $NF}' | sed 's/\\.$//'`, { timeout: 2000 });
        const hostname = stdout.trim();
        if (hostname) {
          devices[ip].hostname = hostname;
        }
      } catch {}
    }
  }

  return { devices, localIP, subnet };
}

module.exports = { discoverDevices };

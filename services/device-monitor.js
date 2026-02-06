const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { discoverDevices } = require('../utils/network-discovery');

// Configuration
const SCAN_INTERVAL = 120_000; // 2 minutes
const SAVE_INTERVAL = 60_000; // Save to disk every 60 seconds
const MAX_HISTORY = 72; // ~2.4 hours at 2-min intervals
const DATA_FILE = path.join(__dirname, '..', 'data', 'device-monitor.json');

// In-memory state
let devices = {}; // keyed by MAC address (or IP as fallback)
let lastScan = null;
let scanTimer = null;
let saveTimer = null;
let lastSaveTime = 0;
let scanning = false;

/**
 * Generate a stable device key (MAC preferred, IP fallback)
 */
function deviceKey(device) {
  return device.mac || `ip:${device.ip}`;
}

/**
 * Load persisted state from disk
 */
function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.devices && typeof data.devices === 'object') {
        devices = data.devices;
        lastScan = data.lastScan || null;
        logger.info(`Device monitor: loaded ${Object.keys(devices).length} devices from disk`);
      }
    }
  } catch (err) {
    logger.warn('Device monitor: failed to load from disk:', err.message);
  }
}

/**
 * Persist state to disk
 */
function saveToDisk() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify({ devices, lastScan }, null, 2));
    lastSaveTime = Date.now();
  } catch (err) {
    logger.warn('Device monitor: failed to save to disk:', err.message);
  }
}

/**
 * Run a scan and update device state
 */
async function scan() {
  if (scanning) return;
  scanning = true;

  try {
    const { devices: discovered } = await discoverDevices({ thorough: false });
    const now = Date.now();

    // Track which existing devices were seen this scan
    const seenKeys = new Set();

    for (const [ip, dev] of Object.entries(discovered)) {
      const key = deviceKey(dev);
      seenKeys.add(key);

      if (devices[key]) {
        // Existing device — update
        const existing = devices[key];
        existing.ip = dev.ip;
        if (dev.mac) existing.mac = dev.mac;
        if (dev.hostname) existing.hostname = dev.hostname;
        existing.lastSeen = now;

        // Status transition
        const wasOnline = existing.status === 'online';
        const isOnline = dev.state === 'online';
        existing.status = isOnline ? 'online' : 'offline';

        if (wasOnline !== isOnline) {
          existing.lastStateChange = now;
          existing.statusHistory.push({ status: existing.status, at: now });
          if (existing.statusHistory.length > MAX_HISTORY) {
            existing.statusHistory.shift();
          }
        }
      } else {
        // New device
        devices[key] = {
          ip: dev.ip,
          mac: dev.mac || null,
          hostname: dev.hostname || null,
          customName: null,
          deviceType: null,
          notes: null,
          status: dev.state === 'online' ? 'online' : 'offline',
          firstSeen: now,
          lastSeen: now,
          lastStateChange: now,
          statusHistory: [{ status: dev.state === 'online' ? 'online' : 'offline', at: now }],
        };
      }
    }

    // Mark unseen devices as offline
    for (const [key, device] of Object.entries(devices)) {
      if (!seenKeys.has(key) && device.status === 'online') {
        device.status = 'offline';
        device.lastStateChange = now;
        device.statusHistory.push({ status: 'offline', at: now });
        if (device.statusHistory.length > MAX_HISTORY) {
          device.statusHistory.shift();
        }
      }
    }

    lastScan = now;

    // Save periodically
    if (Date.now() - lastSaveTime > SAVE_INTERVAL) {
      saveToDisk();
    }

    logger.debug(`Device monitor: scan complete, ${Object.keys(devices).length} devices tracked`);
  } catch (err) {
    logger.warn('Device monitor: scan failed:', err.message);
  } finally {
    scanning = false;
  }
}

/**
 * Start the device monitor
 */
function start() {
  if (scanTimer) return;

  logger.info('Starting device monitor');
  loadFromDisk();

  // Run first scan immediately
  scan();

  // Schedule periodic scans
  scanTimer = setInterval(scan, SCAN_INTERVAL);
  saveTimer = setInterval(saveToDisk, SAVE_INTERVAL);
}

/**
 * Stop the device monitor
 */
function stop() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  saveToDisk();
  logger.info('Stopped device monitor');
}

/**
 * Get current state for API consumers
 */
function getState() {
  return { devices, lastScan, scanning };
}

/**
 * Get a single device by key
 */
function getDevice(id) {
  return devices[id] || null;
}

/**
 * Update device metadata
 */
function updateDevice(id, updates) {
  const device = devices[id];
  if (!device) return null;

  if (updates.customName !== undefined) device.customName = updates.customName;
  if (updates.deviceType !== undefined) device.deviceType = updates.deviceType;
  if (updates.notes !== undefined) device.notes = updates.notes;

  saveToDisk();
  return device;
}

/**
 * Remove a device from tracking
 */
function removeDevice(id) {
  if (devices[id]) {
    delete devices[id];
    saveToDisk();
    return true;
  }
  return false;
}

/**
 * Trigger an immediate scan (returns a promise)
 */
function triggerScan() {
  return scan();
}

module.exports = {
  start,
  stop,
  getState,
  getDevice,
  updateDevice,
  removeDevice,
  triggerScan,
};

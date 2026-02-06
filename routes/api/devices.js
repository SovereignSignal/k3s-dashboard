const { Router } = require('express');
const deviceMonitor = require('../../services/device-monitor');

const router = Router();

// GET /api/devices — All devices + summary stats
router.get('/', (req, res) => {
  const { devices, lastScan, scanning } = deviceMonitor.getState();
  const list = Object.entries(devices).map(([id, d]) => ({ id, ...d }));

  // Sort by IP address
  list.sort((a, b) => {
    const aParts = (a.ip || '0.0.0.0').split('.').map(Number);
    const bParts = (b.ip || '0.0.0.0').split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
    }
    return 0;
  });

  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);

  const stats = {
    total: list.length,
    online: list.filter(d => d.status === 'online').length,
    offline: list.filter(d => d.status === 'offline').length,
    newToday: list.filter(d => d.firstSeen >= todayStart).length,
  };

  res.json({ devices: list, stats, lastScan, scanning });
});

// GET /api/devices/:id — Single device detail
router.get('/:id', (req, res) => {
  const device = deviceMonitor.getDevice(req.params.id);
  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }
  res.json({ id: req.params.id, ...device });
});

// PATCH /api/devices/:id — Update customName, deviceType, notes
router.patch('/:id', (req, res) => {
  const { customName, deviceType, notes } = req.body;
  const updated = deviceMonitor.updateDevice(req.params.id, { customName, deviceType, notes });
  if (!updated) {
    return res.status(404).json({ error: 'Device not found' });
  }
  res.json({ id: req.params.id, ...updated });
});

// DELETE /api/devices/:id — Remove device from tracking
router.delete('/:id', (req, res) => {
  deviceMonitor.removeDevice(req.params.id);
  res.json({ success: true });
});

// POST /api/devices/scan — Trigger immediate scan
router.post('/scan', async (req, res) => {
  await deviceMonitor.triggerScan();
  const { devices, lastScan } = deviceMonitor.getState();
  const count = Object.keys(devices).length;
  res.json({ success: true, lastScan, deviceCount: count });
});

module.exports = router;

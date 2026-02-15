const { Router } = require('express');
const updateManager = require('../../services/update-manager');

const router = Router();

// GET /api/updates/status — Full state for UI polling
router.get('/status', (req, res) => {
  res.json(updateManager.getState());
});

// POST /api/updates/check — Check both OS + k3s updates
router.post('/check', async (req, res, next) => {
  try {
    await Promise.all([
      updateManager.checkOsUpdates(),
      updateManager.checkK3sVersion(),
    ]);
    res.json(updateManager.getState());
  } catch (err) {
    next(err);
  }
});

// POST /api/updates/start/os — Start rolling OS update
router.post('/start/os', async (req, res, next) => {
  try {
    await updateManager.startOsUpdate();
    res.json({ ok: true, message: 'OS update started' });
  } catch (err) {
    if (err.message.includes('already in progress')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/updates/start/k3s — Start k3s upgrade
router.post('/start/k3s', async (req, res, next) => {
  try {
    const { version } = req.body || {};
    await updateManager.startK3sUpgrade(version);
    res.json({ ok: true, message: `K3s upgrade to ${version} started` });
  } catch (err) {
    if (err.message.includes('already in progress')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/updates/reset — Clear state back to idle
router.post('/reset', (req, res) => {
  try {
    updateManager.resetState();
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

module.exports = router;

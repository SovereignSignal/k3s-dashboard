const { Router } = require('express');
const k8s = require('../../services/k8s-client');

const router = Router();

router.get('/overview', async (req, res, next) => {
  try {
    const overview = await k8s.getClusterOverview();
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    const { namespace } = req.query;
    const events = await k8s.listEvents(namespace || undefined);
    // Return most recent first, limit to 100
    const sorted = events
      .sort((a, b) => {
        const ta = a.lastTimestamp || a.eventTime || '';
        const tb = b.lastTimestamp || b.eventTime || '';
        return new Date(tb) - new Date(ta);
      })
      .slice(0, 100)
      .map((e) => ({
        type: e.type,
        reason: e.reason,
        message: e.message,
        namespace: e.metadata.namespace,
        involvedObject: e.involvedObject
          ? `${e.involvedObject.kind}/${e.involvedObject.name}`
          : '',
        count: e.count,
        lastTimestamp: e.lastTimestamp || e.eventTime,
      }));
    res.json(sorted);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

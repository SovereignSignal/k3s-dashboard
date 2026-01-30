const { Router } = require('express');
const metricsCollector = require('../../services/metrics-collector');

const router = Router();

/**
 * GET /api/metrics/history
 * Returns historical metrics data for all nodes
 */
router.get('/history', (_req, res) => {
  const history = metricsCollector.getHistory();
  res.json(history);
});

module.exports = router;

const { Router } = require('express');
const { requireAuth } = require('../../middleware/auth');

const router = Router();

// Auth routes are public
router.use('/auth', require('./auth'));

// All other API routes require authentication
router.use(requireAuth);

router.use('/cluster', require('./cluster'));
router.use('/nodes', require('./nodes'));
router.use('/pods', require('./pods'));
router.use('/deployments', require('./deployments'));
router.use('/namespaces', require('./namespaces'));
router.use('/storage', require('./storage'));
router.use('/network', require('./network'));
router.use('/alerts', require('./alerts'));
router.use('/templates', require('./templates'));
router.use('/apply', require('./apply'));
router.use('/metrics', require('./metrics'));

module.exports = router;

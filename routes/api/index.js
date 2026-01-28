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
router.use('/apply', require('./apply'));

module.exports = router;

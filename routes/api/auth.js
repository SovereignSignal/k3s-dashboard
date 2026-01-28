const { Router } = require('express');
const { login, logout, status } = require('../../middleware/auth');

const router = Router();

router.post('/login', login);
router.post('/logout', logout);
router.get('/status', status);

module.exports = router;

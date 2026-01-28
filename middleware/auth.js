const bcrypt = require('bcrypt');
const config = require('../config');
const logger = require('../utils/logger');

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

async function login(req, res) {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  try {
    const match = await bcrypt.compare(password, config.passwordHash);
    if (match) {
      req.session.authenticated = true;
      logger.info('Login successful from', req.ip);
      return res.json({ ok: true });
    }
    logger.warn('Failed login attempt from', req.ip);
    res.status(401).json({ error: 'Invalid password' });
  } catch (err) {
    logger.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
}

function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout error:', err.message);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
}

function status(req, res) {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
}

module.exports = { requireAuth, login, logout, status };

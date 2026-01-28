const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  logger.error(`${req.method} ${req.path} -`, err.message);
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;

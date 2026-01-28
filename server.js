const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const { requireAuth } = require('./middleware/auth');
const errorHandler = require('./middleware/error-handler');
const apiRouter = require('./routes/api');

const app = express();

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
  );
  next();
});

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Session
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: config.sessionTTLHours * 60 * 60 * 1000,
    },
  })
);

// Static files - login page is always accessible
app.get('/login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Static assets (css/js) are always accessible for login page to work
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// Protect all other static pages behind auth
app.use((req, res, next) => {
  // Allow API auth routes without session check
  if (req.path.startsWith('/api/auth')) return next();
  // Allow API routes to use their own auth middleware
  if (req.path.startsWith('/api/')) return next();

  // For HTML pages, redirect to login if not authenticated
  if (!req.session || !req.session.authenticated) {
    return res.redirect('/login.html');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRouter);

// Fallback - serve index.html for authenticated users
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.redirect('/login.html');
});

// Error handler
app.use(errorHandler);

app.listen(config.port, config.bindAddress, () => {
  logger.info(`K3s Dashboard running on http://${config.bindAddress}:${config.port}`);
});

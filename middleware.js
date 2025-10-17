const jwt = require('jsonwebtoken');

// TEMPORARY: disable auth for all requests when true.
// This is intended for quick local testing only. Remove or set to false
// before deploying or sharing this environment.
// NOTE: Prefer using the env-driven DEV_ALLOW_PUBLIC_DASHBOARD for targeted bypass.
const TEMP_DISABLE_AUTH = false; // <-- set to false to re-enable auth checks

// Verify JWT token middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  const devBypass = process.env.DEV_AUTH_BYPASS === 'true';
  // New: allow exposing dashboard routes publicly when explicitly enabled via env var
  const allowPublicDashboard = process.env.DEV_ALLOW_PUBLIC_DASHBOARD === 'true';

  // If session-based user exists, use it (session auth takes precedence)
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  if (!token) {
    // Global temporary bypass (overrides token requirement)
    if (TEMP_DISABLE_AUTH) {
      console.warn('⚠️ TEMP_DISABLE_AUTH enabled: skipping token checks and injecting temporary viewer user');
      req.user = { id: 1, email: 'dev@localhost', role: 'viewer', name: 'Dev User (temp)' };
      return next();
    }

    // Allow public access to dashboard routes when explicitly enabled.
    // This is safer than disabling auth globally because it only affects UI dashboard endpoints.
    if (allowPublicDashboard && process.env.NODE_ENV !== 'production') {
      // Inject a minimal viewer user so frontend can render dashboard UI without auth.
      console.warn('⚠️ DEV_ALLOW_PUBLIC_DASHBOARD enabled: allowing public access to dashboard endpoints (dev only)');
      req.user = { id: 1, email: 'dev@localhost', role: 'viewer', name: 'Dev Viewer' };
      return next();
    }

    if (devBypass && process.env.NODE_ENV !== 'production') {
      // For development only: allow requests without token but inject a minimal user.
      // Use a limited role ('viewer') to avoid accidental admin-level access during dev.
      console.warn('⚠️ DEV_AUTH_BYPASS enabled: allowing request without token (dev only) - injecting viewer user');
      req.user = { id: 1, email: 'dev@localhost', role: 'viewer', name: 'Dev User' };
      return next();
    }

    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (devBypass && process.env.NODE_ENV !== 'production') {
        console.warn('⚠️ DEV_AUTH_BYPASS enabled: token invalid but allowing request (dev only) - injecting viewer user');
        req.user = { id: 1, email: 'dev@localhost', role: 'viewer', name: 'Theo' };
        return next();
      }
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = (req, res, next) => {
  // Prefer session-based user when available
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (err) {
      // ignore invalid token for optional auth
    }
  }
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth
};
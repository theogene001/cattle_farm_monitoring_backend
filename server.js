const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Provide safe defaults for JWT config in development
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'dev-jwt-secret-change-me';
  console.warn('⚠️ JWT_SECRET not set. Using a development default. Set JWT_SECRET in your .env for production.');
}
if (!process.env.JWT_EXPIRES_IN) {
  process.env.JWT_EXPIRES_IN = '24h';
}

const { testConnection, executeQuery } = require('./database');
const { authenticateToken, optionalAuth } = require('./middleware');
const {
  login,
  getDashboardSummary,
  getAnimals,
  getAnimalById,
  getVirtualFences,
  createVirtualFence,
  updateVirtualFence,
  deleteVirtualFence,
  getAnimalLocations,
  updateAnimalLocation,
  getAlerts,
  deleteAllAlerts,
  getCurrentUser,
  markAlertRead,
  addAnimal,
  updateAnimal,
  deleteAnimal,
  resolveAlert
} = require('./controllers');
const gpsRoute = require('./routes/gps');
const gpsStreamRoute = require('./routes/gps_stream');
const usersRoute = require('./routes/users');
const deviceAlertsRoute = require('./routes/device_alerts');

// Create Express app
const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001', 
    'http://localhost:3002',
    'http://localhost:3003'
  ],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session middleware - simple in-memory store for development only.
// For production, use a persistent store like Redis, connect-mongo, or similar.
app.use(session({
  name: process.env.SESSION_NAME || 'cattlefarm.sid',
  secret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Routes
const router = express.Router();

// Public routes
router.post('/auth/login', login);
// Return current user (session or token)
router.get('/auth/me', optionalAuth, getCurrentUser);

// Protected routes
router.get('/dashboard/summary', optionalAuth, getDashboardSummary);
router.get('/dashboard/animals', optionalAuth, getAnimals);
router.post('/dashboard/animals', authenticateToken, addAnimal);
router.get('/dashboard/animals/:id', optionalAuth, getAnimalById);
router.put('/dashboard/animals/:id', authenticateToken, updateAnimal);
router.patch('/dashboard/animals/:id', authenticateToken, updateAnimal);
router.delete('/dashboard/animals/:id', authenticateToken, deleteAnimal);
router.get('/dashboard/fences', optionalAuth, getVirtualFences);
router.post('/dashboard/fences', authenticateToken, createVirtualFence);
router.put('/dashboard/fences/:id', authenticateToken, updateVirtualFence);
router.delete('/dashboard/fences/:id', authenticateToken, deleteVirtualFence);
router.get('/dashboard/locations', optionalAuth, getAnimalLocations);
// Use property access to avoid ReferenceError if the symbol isn't available in the local scope
router.post('/dashboard/animals/:id/location', optionalAuth, require('./controllers').updateAnimalLocation);
router.get('/alerts', optionalAuth, getAlerts);
router.patch('/alerts/:id/read', optionalAuth, markAlertRead);
router.patch('/alerts/:id/resolve', authenticateToken, resolveAlert);
// Admin-only: delete all alerts
router.delete('/alerts', authenticateToken, deleteAllAlerts);
// GPS route (public endpoint for devices)
router.use('/gps', gpsRoute);
// GPS stream (Server-Sent Events) for live updates
router.use('/gps', gpsStreamRoute);
// Users management
router.use('/users', usersRoute);
// Device alerts route (public)
router.use('/device', deviceAlertsRoute);
console.log('🔔 Device alerts route mounted at /api/v1/device');

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Cattle Farm API is running',
    timestamp: new Date().toISOString()
  });
});

// Debug: list registered routes (development only)
router.get('/_routes', (req, res) => {
  try {
    const routes = [];
    // router.stack contains layers with route definitions
    router.stack.forEach((layer) => {
      if (layer && layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
        routes.push({ path: '/api/v1' + layer.route.path, methods });
      }
    });
    res.json({ success: true, routes });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to list routes', error: err.message });
  }
});

// Dev-only helper to check if a user exists (enable by setting DEBUG_DEV_ENDPOINTS=1)
router.get('/_debug/user-exists', async (req, res) => {
  try {
    if (process.env.DEBUG_DEV_ENDPOINTS !== '1') return res.status(404).json({ success: false, message: 'Not found' });
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, message: 'email query param required' });
    const r = await executeQuery('SELECT id, email, is_active FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
    if (!r.success) return res.status(500).json({ success: false, message: 'DB error' });
    if (r.data.length === 0) return res.json({ success: true, exists: false });
    return res.json({ success: true, exists: true, active: !!r.data[0].is_active });
  } catch (err) {
    console.error('Debug user-exists error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Use router
app.use('/api/v1', router);

// Also mount device route at root as a compatibility fallback
app.use('/device', deviceAlertsRoute);
console.log('🔔 Device alerts route also mounted at /device (fallback)');

// Note: we mount the device alerts router under both /api/v1/device and /device
// and provide an app-level fallback handler below that will forward to the
// router's handler when necessary. Avoid mounting the same handler twice to
// prevent duplicate registrations and confusing log output.

// Additional robust fallbacks: direct echo and ping endpoints on app level
// These ensure the deployed instance responds to device requests even if the router
// failed to mount for some reason. They are intentionally simple and safe.
app.get('/api/v1/device/ping', (req, res) => {
  res.json({ success: true, message: 'device route is reachable (app-level ping)' });
});
app.get('/device/ping', (req, res) => {
  res.json({ success: true, message: 'device route is reachable (fallback ping)' });
});

app.post(['/api/v1/device/echo', '/api/v1/device/echo/', '/device/echo', '/device/echo/'], (req, res) => {
  try {
    console.log('📣 App-level Echo hit:', { path: req.path, method: req.method });
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    return res.json({ success: true, message: 'app-echo', path: req.path, headers: req.headers, body: req.body });
  } catch (err) {
    console.error('App-level echo error:', err);
    return res.status(500).json({ success: false, message: 'App-level echo error' });
  }
});

// Accept alert posts at app level (trailing slash tolerant) and forward to handler if present,
// otherwise respond with 202 and log for debugging.
app.post(['/api/v1/device/alert', '/api/v1/device/alert/', '/device/alert', '/device/alert/'], async (req, res, next) => {
  try {
    if (deviceAlertsRoute && deviceAlertsRoute.handleAlert) {
      // forward to the handler
      return deviceAlertsRoute.handleAlert(req, res, next);
    }
    console.log('⚠️ App-level fallback alert received but handler missing. Body:', req.body);
    return res.status(202).json({ success: true, message: 'Received (app fallback)'});
  } catch (err) {
    console.error('App-level alert fallback error:', err);
    return res.status(500).json({ success: false, message: 'App-level alert error' });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Cattle Farm Monitoring API',
    version: '1.0.0',
    endpoints: {
      health: '/api/v1/health',
      auth: '/api/v1/auth/login',
      dashboard: '/api/v1/dashboard/summary',
      animals: '/api/v1/dashboard/animals',
      fences: '/api/v1/dashboard/fences',
      locations: '/api/v1/dashboard/locations',
      alerts: '/api/v1/alerts'
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server
const startServer = async () => {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.error('❌ Database connection failed - cannot start server without DB.');
      process.exit(1);
    }

    // Minimal auto-migration: ensure required tables exist
    try {
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(150) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(32) DEFAULT 'farm_manager',
          phone_number VARCHAR(20),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          is_active BOOLEAN DEFAULT TRUE,
          last_login TIMESTAMP NULL,
          profile_image VARCHAR(255)
        )`);

      await executeQuery(`
        CREATE TABLE IF NOT EXISTS farms (
          id SERIAL PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          location VARCHAR(255) NOT NULL,
          size_hectares NUMERIC(10,2) NOT NULL,
          center_latitude NUMERIC(11,8) NOT NULL,
          center_longitude NUMERIC(11,8) NOT NULL,
          boundary_radius_meters INT NOT NULL DEFAULT 2000,
          owner_id INT NOT NULL,
          description TEXT,
          established_date DATE,
          farm_type VARCHAR(32) DEFAULT 'mixed',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          is_active BOOLEAN DEFAULT TRUE
        )`);
      // Ensure gps_data table exists
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS gps_data (
          id SERIAL PRIMARY KEY,
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      // Ensure animal_locations table exists for storing device-submitted GPS points
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS animal_locations (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          animal_id INT DEFAULT NULL,
          collar_id INT DEFAULT NULL,
          latitude DECIMAL(10,8) NOT NULL,
          longitude DECIMAL(11,8) NOT NULL,
          altitude_meters DECIMAL(8,2) DEFAULT NULL,
          accuracy_meters DECIMAL(6,2) DEFAULT NULL,
          speed_kmh DECIMAL(5,2) DEFAULT NULL,
          heading_degrees DECIMAL(5,2) DEFAULT NULL,
          recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          battery_level INT DEFAULT NULL,
          signal_quality VARCHAR(16) DEFAULT 'good',
          temperature_celsius DECIMAL(4,1) DEFAULT NULL,
          is_within_fence BOOLEAN DEFAULT TRUE,
          INDEX idx_animal_timestamp (animal_id, recorded_at),
          INDEX idx_collar_timestamp (collar_id, recorded_at),
          INDEX idx_location (latitude, longitude)
        )
      `);
      // Ensure current_locations table exists for quick lookups of latest position per animal/collar
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS current_locations (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          animal_id INT DEFAULT NULL,
          collar_id INT DEFAULT NULL,
          latitude DOUBLE,
          longitude DOUBLE,
          recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          battery_level INT DEFAULT NULL,
          signal_quality VARCHAR(16) DEFAULT NULL,
          temperature_celsius DECIMAL(5,2) DEFAULT NULL,
          UNIQUE KEY uk_animal (animal_id),
          UNIQUE KEY uk_collar (collar_id)
        )
      `);
        // Ensure alerts table exists (for device alerts)
        await executeQuery(`
          CREATE TABLE IF NOT EXISTS alerts (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            farm_id INT DEFAULT 1,
            animal_id INT DEFAULT NULL,
            alert_type VARCHAR(100) DEFAULT 'device',
            severity VARCHAR(32) DEFAULT 'medium',
            title VARCHAR(255),
            message TEXT,
            location_latitude DECIMAL(10,8) DEFAULT NULL,
            location_longitude DECIMAL(11,8) DEFAULT NULL,
            triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(32) DEFAULT 'active',
            acknowledged_at TIMESTAMP NULL,
            acknowledged_by INT NULL,
            resolved_at TIMESTAMP NULL,
            resolved_by INT NULL
          )
        `);
      // Ensure animals table exists
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS animals (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          farm_id INT NOT NULL,
          name VARCHAR(200) NOT NULL,
          tag_number VARCHAR(100) NOT NULL UNIQUE,
          breed VARCHAR(100),
          gender VARCHAR(20) DEFAULT 'female',
          birth_date DATE DEFAULT NULL,
          notes TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_farm (farm_id),
          INDEX idx_tag (tag_number)
        )
      `);
      console.log('✅ Verified core tables (users, farms)');
    } catch (migErr) {
      console.warn('⚠️ Auto-migration failed:', migErr.message);
    }

    // Ensure a default admin user exists for initial login
    try {
      const adminEmail = 'admin@cattlefarm.com';
      const checkUser = await executeQuery('SELECT id, is_active FROM users WHERE email = ?', [adminEmail]);
      if (checkUser.success) {
        if (checkUser.data.length === 0) {
          const name = 'System Administrator';
          const role = 'admin';
          const phone = '+1234567890';
          const passwordHash = bcrypt.hashSync('admin123', 12);
          const insertRes = await executeQuery(
            'INSERT INTO users (name, email, password_hash, role, phone_number, is_active) VALUES (?, ?, ?, ?, ?, TRUE)',
            [name, adminEmail, passwordHash, role, phone]
          );
          if (insertRes.success) {
            console.log('✅ Seeded default admin user (email: admin@cattlefarm.com, password: admin123)');
          } else {
            console.warn('⚠️ Failed to insert default admin user:', insertRes.error);
          }
        } else if (checkUser.data[0].is_active === 0) {
          const activateRes = await executeQuery('UPDATE users SET is_active = TRUE WHERE email = ?', [adminEmail]);
          if (activateRes.success) {
            console.log('✅ Activated existing admin user');
          } else {
            console.warn('⚠️ Failed to activate existing admin user:', activateRes.error);
          }
        }
        // Note: demo user seeding has been removed to prefer explicit user management
        // If you want a demo user for local testing, create it manually using the scripts in /backend/scripts

        // Ensure default farm with id=1 exists for dashboard queries
        const adminRow = await executeQuery('SELECT id FROM users WHERE email = ?', [adminEmail]);
        const ownerId = adminRow.success && adminRow.data.length > 0 ? adminRow.data[0].id : null;
        const farmCheck = await executeQuery('SELECT id FROM farms WHERE id = 1');
        if (farmCheck.success && farmCheck.data.length === 0 && ownerId) {
          const insertFarm = await executeQuery(
            `INSERT INTO farms (id, name, location, size_hectares, center_latitude, center_longitude, boundary_radius_meters, owner_id, description, is_active)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [
              'Green Valley Cattle Farm',
              'NYAGATARE, RWANDA',
              200.0,
              39.7817,
              -89.6501,
              2000,
              ownerId,
              'A modern cattle farm with virtual fence monitoring system'
            ]
          );
          if (insertFarm.success) {
            console.log('✅ Seeded default farm (id=1) for dashboard');
          } else {
            console.warn('⚠️ Failed to insert default farm:', insertFarm.error);
          }
        }
      } else {
        console.warn('⚠️ Could not verify default admin user existence:', checkUser.error);
      }
    } catch (seedErr) {
      console.warn('⚠️ Error ensuring default admin user:', seedErr.message);
    }

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      console.log(`
🚀 Cattle Farm Monitoring API Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Server running on port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
🔗 API Endpoint: http://localhost:${PORT}/api/v1
📊 Health Check: http://localhost:${PORT}/api/v1/health
🔐 Login: POST http://localhost:${PORT}/api/v1/auth/login
📈 Dashboard: http://localhost:${PORT}/api/v1/dashboard/summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `);
    });

    server.on('error', (err) => {
      console.error('❌ Server error:', err);
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
      }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();
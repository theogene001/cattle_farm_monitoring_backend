const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { executeQuery } = require('./database');
const mockDb = require('./mockDatabase'); // Add mock database for testing

// Use mock database if real database connection fails
let useDatabase = true;

// Test database connection
const testDbConnection = async () => {
  try {
    const result = await executeQuery('SELECT 1', []);
    if (result.success) {
      console.log('✅ Database connection successful - using MySQL');
      useDatabase = true;
    } else {
      throw new Error('Database query failed');
    }
  } catch (error) {
    console.log('⚠️  Database connection failed - using mock data');
    useDatabase = false;
  }
};

// Initialize database connection test
testDbConnection();

// User login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    let user;
    let isValidPassword = false;

    if (useDatabase) {
      // Use real database
      const result = await executeQuery(
        'SELECT id, name, email, password_hash, role FROM users WHERE email = ? AND is_active = TRUE',
        [email]
      );

      if (!result.success || result.data.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      user = result.data[0];
      isValidPassword = await bcrypt.compare(password, user.password_hash);
    } else {
      // Use mock database
      user = await mockDb.findUserByEmail(email);
      if (user) {
        isValidPassword = await mockDb.verifyPassword(password, user.password_hash);
      }
    }

    if (!user || !isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get dashboard summary
const getDashboardSummary = async (req, res) => {
  try {
    const farmId = 1; // Default farm for demo

    // Get farm info
    const farmResult = await executeQuery(
      'SELECT name, location, size_hectares FROM farms WHERE id = ?',
      [farmId]
    );

    // Get total animals
    const animalsResult = await executeQuery(
      'SELECT COUNT(*) as count FROM animals WHERE farm_id = ? AND is_active = TRUE',
      [farmId]
    );

    // Get active collars
    const collarsResult = await executeQuery(
      'SELECT COUNT(*) as count FROM collars WHERE is_functional = TRUE'
    );

    // Get virtual fences
    const fencesResult = await executeQuery(
      'SELECT COUNT(*) as count FROM virtual_fences WHERE farm_id = ? AND is_active = TRUE',
      [farmId]
    );

    // Get active alerts
    const alertsResult = await executeQuery(
      'SELECT COUNT(*) as count FROM alerts WHERE farm_id = ? AND status = "active"',
      [farmId]
    );

    // Get recent alerts
    const recentAlertsResult = await executeQuery(
      `SELECT id, alert_type, severity, title, message, triggered_at 
       FROM alerts 
       WHERE farm_id = ? AND status = 'active' 
       ORDER BY triggered_at DESC 
       LIMIT 5`,
      [farmId]
    );

    res.json({
      success: true,
      data: {
        farm: farmResult.success ? farmResult.data[0] : null,
        summary: {
          totalAnimals: animalsResult.success ? animalsResult.data[0].count : 0,
          activeCollars: collarsResult.success ? collarsResult.data[0].count : 0,
          virtualFences: fencesResult.success ? fencesResult.data[0].count : 0,
          activeAlerts: alertsResult.success ? alertsResult.data[0].count : 0
        },
        alerts: recentAlertsResult.success ? recentAlertsResult.data : []
      }
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get animals with collar information
const getAnimals = async (req, res) => {
  try {
    const farmId = 1; // Default farm

    const result = await executeQuery(
      `SELECT a.id, a.name, a.tag_number, a.breed, a.gender,
              c.name as collar_name, c.current_battery_level, c.status as collar_status,
              ac.assigned_at
       FROM animals a
       LEFT JOIN animal_collars ac ON a.id = ac.animal_id AND ac.is_active = TRUE
       LEFT JOIN collars c ON ac.collar_id = c.id
       WHERE a.farm_id = ? AND a.is_active = TRUE
       ORDER BY a.name`,
      [farmId]
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch animals'
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get animals error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get virtual fences
const getVirtualFences = async (req, res) => {
  try {
    const farmId = 1; // Default farm

    const result = await executeQuery(
      `SELECT id, name, description, center_latitude, center_longitude, 
              radius_meters, fence_type, is_active
       FROM virtual_fences 
       WHERE farm_id = ? 
       ORDER BY name`,
      [farmId]
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch virtual fences'
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get virtual fences error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get animal locations (mock data for now)
const getAnimalLocations = async (req, res) => {
  try {
    // For now, return mock location data similar to your demo
    const mockLocations = [
      {
        id: '1',
        name: 'Bossy',
        position: [39.7820, -89.6510],
        batteryLevel: 85,
        status: 'active',
        lastUpdate: new Date()
      },
      {
        id: '2',
        name: 'Daisy',
        position: [39.7810, -89.6490],
        batteryLevel: 45,
        status: 'active',
        lastUpdate: new Date()
      },
      {
        id: '3',
        name: 'Moo Moo',
        position: [39.7830, -89.6520],
        batteryLevel: 20,
        status: 'warning',
        lastUpdate: new Date()
      },
      {
        id: '4',
        name: 'Spot',
        position: [39.7805, -89.6485],
        batteryLevel: 92,
        status: 'active',
        lastUpdate: new Date()
      }
    ];

    res.json({
      success: true,
      data: mockLocations
    });
  } catch (error) {
    console.error('Get animal locations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get alerts
const getAlerts = async (req, res) => {
  try {
    const farmId = 1; // Default farm

    const result = await executeQuery(
      `SELECT id, alert_type, severity, title, message, triggered_at, status
       FROM alerts 
       WHERE farm_id = ? 
       ORDER BY triggered_at DESC 
       LIMIT 20`,
      [farmId]
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch alerts'
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  login,
  getDashboardSummary,
  getAnimals,
  getVirtualFences,
  getAnimalLocations,
  getAlerts
};
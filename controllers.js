const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { executeQuery } = require('./database');

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

    // Real database
    const result = await executeQuery(
      'SELECT id, name, email, password_hash, role FROM users WHERE LOWER(email) = LOWER(?) AND is_active = TRUE',
      [email]
    );

    if (!result.success || result.data.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = result.data[0];
    // Compare provided password with stored hash
    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!user || !passwordMatches) {
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

    // Real database implementation
    const farmResult = await executeQuery(
      'SELECT id, name, location, size_hectares FROM farms WHERE id = ? AND is_active = TRUE',
      [farmId]
    );

    if (!farmResult.success || farmResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Farm not found'
      });
    }

    const farm = farmResult.data[0];

    // Get summary counts (match schema)
    const [animalsCount, activeCollarsCount, fencesCount, activeAlertsCount] = await Promise.all([
      executeQuery('SELECT COUNT(*) AS total FROM animals WHERE farm_id = ? AND is_active = TRUE', [farmId]),
      executeQuery(
        `SELECT COUNT(*) AS total
         FROM animal_collars ac
         JOIN animals a ON ac.animal_id = a.id
         JOIN collars c ON ac.collar_id = c.id
         WHERE a.farm_id = ? AND ac.is_active = TRUE AND c.status = 'active'`,
        [farmId]
      ),
      executeQuery('SELECT COUNT(*) AS total FROM virtual_fences WHERE farm_id = ? AND is_active = TRUE', [farmId]),
      executeQuery("SELECT COUNT(*) AS total FROM alerts WHERE farm_id = ? AND status = 'active'", [farmId])
    ]);

    const summary = {
      totalAnimals: animalsCount.success ? animalsCount.data[0].total : 0,
      totalCollars: activeCollarsCount.success ? activeCollarsCount.data[0].total : 0,
      totalTowers: fencesCount.success ? fencesCount.data[0].total : 0,
      totalAlerts: activeAlertsCount.success ? activeAlertsCount.data[0].total : 0
    };

    // Get recent alerts (latest 2 rows)
    const alertsResult = await executeQuery(
      `SELECT id, alert_type, severity, title, message, triggered_at AS timestamp
       FROM alerts
       WHERE farm_id = ? AND status = 'active'
       ORDER BY triggered_at DESC
       LIMIT 2`,
      [farmId]
    );

    const dashboardData = {
      farm,
      summary,
      alerts: alertsResult.success ? alertsResult.data : []
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get animals
const getAnimals = async (req, res) => {
  try {
    const farmId = 1; // Default farm for demo

    const result = await executeQuery(
      `SELECT 
         id,
         name,
         tag_number,
         breed,
         gender,
         birth_date,
         notes AS details,
         NULL AS health_status,
         NULL AS weight_kg
       FROM animals
       WHERE farm_id = ? AND is_active = TRUE
       ORDER BY name`,
      [farmId]
    );
    // Default health_status to 'healthy' for UI compatibility
    const animals = (result.success ? result.data : []).map(a => ({
      ...a,
      health_status: a.health_status || 'healthy'
    }));

    res.json({
      success: true,
      data: animals
    });

  } catch (error) {
    console.error('Get animals error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Add new animal
const addAnimal = async (req, res) => {
  try {
    const farmId = 1; // Default farm for demo
  // Accept all relevant fields from frontend
  const { name, tag_number, breed, gender, birth_date, notes } = req.body;
    const debug = process.env.NODE_ENV !== 'production';

    if (!name || !tag_number) {
      return res.status(400).json({ success: false, message: 'name and tag_number are required' });
    }

    // Check if tag already exists
    const existing = await executeQuery('SELECT id FROM animals WHERE tag_number = ?', [tag_number]);
    if (!existing.success) {
      return res.status(500).json({ success: false, message: 'Failed to validate tag number', error: (debug ? existing.error : undefined) });
    }
    if (existing.data.length > 0) {
      return res.status(409).json({ success: false, message: 'Tag number already exists' });
    }

    // Insert animal with all fields
    const insert = await executeQuery(
      `INSERT INTO animals (farm_id, name, tag_number, breed, gender, birth_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [farmId, name, tag_number, breed || null, gender || 'female', birth_date || null, notes || null]
    );

    if (!insert.success) {
      if (insert.code === 'MAX_USER_CONNECTIONS') {
        return res.status(503).json({ success: false, message: 'Database is temporarily unavailable. Please try again.', error: (debug ? insert.error : undefined) });
      }
      return res.status(500).json({ success: false, message: 'Failed to add animal', error: (debug ? insert.error : undefined) });
    }

    // Determine the new record id from the INSERT result (works with mysql2 OkPacket)
    const newId = insert.data && (insert.data.insertId || insert.data.insert_id) ? (insert.data.insertId || insert.data.insert_id) : null;

    // Fetch inserted row using the insertId when available, otherwise fallback to tag_number
    let created;
    if (newId) {
      created = await executeQuery(
        `SELECT id, name, tag_number, breed, gender, birth_date, notes
         FROM animals WHERE id = ?`,
        [newId]
      );
    } else {
      created = await executeQuery(
        `SELECT id, name, tag_number, breed, gender, birth_date, notes
         FROM animals WHERE tag_number = ? LIMIT 1`,
        [tag_number]
      );
    }

    return res.status(201).json({ success: true, data: (created.success ? created.data[0] : null) });
  } catch (error) {
    console.error('Add animal error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

  // Get animal by id
  const getAnimalById = async (req, res) => {
    try {
      const { id } = req.params;
      const result = await executeQuery(
        `SELECT id, name, tag_number, breed, gender, notes AS details, is_active
         FROM animals WHERE id = ?`,
        [id]
      );
      if (!result.success || result.data.length === 0) {
        return res.status(404).json({ success: false, message: 'Animal not found' });
      }
      const animal = { ...result.data[0], health_status: 'healthy' };
      res.json({ success: true, data: animal });
    } catch (error) {
      console.error('Get animal by id error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };

  // Update animal
  const updateAnimal = async (req, res) => {
    try {
      const { id } = req.params;
      const debug = process.env.NODE_ENV !== 'production';

      if (!id || Number.isNaN(Number(id))) {
        return res.status(400).json({ success: false, message: 'Invalid animal id' });
      }
      const { name, tag_number, breed, gender, birth_date, notes, is_active } = req.body;

      // Ensure animal exists
      const existing = await executeQuery('SELECT id FROM animals WHERE id = ?', [id]);
      if (!existing.success || existing.data.length === 0) {
        return res.status(404).json({ success: false, message: 'Animal not found' });
      }

      // Prevent duplicate tag_number if changed
      if (tag_number) {
        const dup = await executeQuery('SELECT id FROM animals WHERE tag_number = ? AND id <> ?', [tag_number, id]);
        if (!dup.success) return res.status(500).json({ success: false, message: 'Failed to validate tag number' });
        if (dup.data.length > 0) return res.status(409).json({ success: false, message: 'Tag number already exists' });
      }

      const fields = [];
      const params = [];
      if (name !== undefined) { fields.push('name = ?'); params.push(name); }
      if (tag_number !== undefined) { fields.push('tag_number = ?'); params.push(tag_number); }
      if (breed !== undefined) { fields.push('breed = ?'); params.push(breed); }
      if (gender !== undefined) { fields.push('gender = ?'); params.push(gender); }
      if (birth_date !== undefined) { fields.push('birth_date = ?'); params.push(birth_date); }
      if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
      if (is_active !== undefined) { fields.push('is_active = ?'); params.push(!!is_active); }

      if (fields.length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      const sql = `UPDATE animals SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params.push(id);
      const upd = await executeQuery(sql, params);
      if (!upd.success) {
        if (upd.code === 'MAX_USER_CONNECTIONS') {
          return res.status(503).json({ success: false, message: 'Database is temporarily unavailable. Please try again.', error: (debug ? upd.error : undefined) });
        }
        return res.status(500).json({ success: false, message: 'Failed to update animal', error: (debug ? upd.error : undefined) });
      }

      // If the UPDATE executed but didn't affect rows, return a clear message
      if (upd.data && typeof upd.data.affectedRows === 'number' && upd.data.affectedRows === 0) {
        return res.status(400).json({ success: false, message: 'No changes were made to the animal' });
      }

      const updated = await executeQuery(
        'SELECT id, name, tag_number, breed, gender, birth_date, notes FROM animals WHERE id = ?',
        [id]
      );
      res.json({ success: true, data: updated.success ? updated.data[0] : null });
    } catch (error) {
      console.error('Update animal error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };

  // Delete animal (soft delete)
  const deleteAnimal = async (req, res) => {
    try {
      const { id } = req.params;
      const debug = process.env.NODE_ENV !== 'production';

      if (!id || Number.isNaN(Number(id))) {
        return res.status(400).json({ success: false, message: 'Invalid animal id' });
      }

      const existing = await executeQuery('SELECT id FROM animals WHERE id = ?', [id]);
      if (!existing.success || existing.data.length === 0) {
        return res.status(404).json({ success: false, message: 'Animal not found' });
      }

      const del = await executeQuery(
        'UPDATE animals SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
      );

      if (!del.success) {
        if (del.code === 'MAX_USER_CONNECTIONS') {
          return res.status(503).json({ success: false, message: 'Database is temporarily unavailable. Please try again.', error: (debug ? del.error : undefined) });
        }
        return res.status(500).json({ success: false, message: 'Failed to delete animal', error: (debug ? del.error : undefined) });
      }

      if (del.data && typeof del.data.affectedRows === 'number' && del.data.affectedRows === 0) {
        return res.status(400).json({ success: false, message: 'Failed to delete animal - no rows affected' });
      }

      res.json({ success: true, message: 'Animal deleted' });
    } catch (error) {
      console.error('Delete animal error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };

  // Resolve alert
  const resolveAlert = async (req, res) => {
    try {
      const { id } = req.params;
      const resolvedBy = (req.user && req.user.id) ? req.user.id : null;
      const existing = await executeQuery('SELECT id FROM alerts WHERE id = ?', [id]);
      if (!existing.success || existing.data.length === 0) {
        return res.status(404).json({ success: false, message: 'Alert not found' });
      }
      const upd = await executeQuery(
        `UPDATE alerts 
         SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
         WHERE id = ?`,
        [resolvedBy, id]
      );
      if (!upd.success) return res.status(500).json({ success: false, message: 'Failed to resolve alert' });
      res.json({ success: true, message: 'Alert resolved' });
    } catch (error) {
      console.error('Resolve alert error:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };

// Update animal location (POST /dashboard/animals/:id/location)
const updateAnimalLocation = async (req, res) => {
  try {
    const { id } = req.params; // animal id
    const {
      latitude,
      longitude,
      altitude_meters = null,
      accuracy_meters = null,
      speed_kmh = null,
      heading_degrees = null,
      recorded_at = null,
      battery_level = null,
      signal_quality = null,
      temperature_celsius = null,
      collar_id = null
    } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'latitude and longitude are required' });
    }

    // Ensure animal exists
    const animalCheck = await executeQuery('SELECT id FROM animals WHERE id = ?', [id]);
    if (!animalCheck.success || animalCheck.data.length === 0) {
      return res.status(404).json({ success: false, message: 'Animal not found' });
    }

    const sql = `INSERT INTO animal_locations (
      animal_id, collar_id, latitude, longitude, altitude_meters, accuracy_meters,
      speed_kmh, heading_degrees, recorded_at, battery_level, signal_quality, temperature_celsius
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
      id,
      collar_id,
      Number(latitude),
      Number(longitude),
      altitude_meters,
      accuracy_meters,
      speed_kmh,
      heading_degrees,
      recorded_at ? recorded_at : new Date(),
      battery_level,
      signal_quality,
      temperature_celsius
    ];

    const insertRes = await executeQuery(sql, params);
    if (!insertRes.success) return res.status(500).json({ success: false, message: 'Failed to save location', error: insertRes.error });

    return res.status(201).json({ success: true, message: 'Location saved', id: insertRes.insertId || null });
  } catch (error) {
    console.error('Update animal location error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get virtual fences
const getVirtualFences = async (req, res) => {
  try {
    const farmId = 1; // Default farm for demo

    const result = await executeQuery(
      'SELECT id, name, description, center_latitude, center_longitude, radius_meters, fence_type, is_active FROM virtual_fences WHERE farm_id = ?',
      [farmId]
    );
    const fences = result.success ? result.data : [];

    res.json({
      success: true,
      data: fences
    });

  } catch (error) {
    console.error('Get virtual fences error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create virtual fence
const createVirtualFence = async (req, res) => {
  try {
    const farmId = 1; // Default farm for demo
    const createdBy = 1; // Default user for demo
    const {
      name,
      description,
      center_latitude,
      center_longitude,
      radius_meters,
      fence_type,
      is_active
    } = req.body;

    // Validate required fields
    if (!name || !center_latitude || !center_longitude || !radius_meters) {
      return res.status(400).json({
        success: false,
        message: 'Name, coordinates, and radius are required'
      });
    }

    // Validate coordinate ranges
    if (center_latitude < -90 || center_latitude > 90) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be between -90 and 90'
      });
    }

    if (center_longitude < -180 || center_longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be between -180 and 180'
      });
    }

    // Validate radius
    if (radius_meters < 50 || radius_meters > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Radius must be between 50 and 10000 meters'
      });
    }

    const result = await executeQuery(
      `INSERT INTO virtual_fences 
       (farm_id, name, description, center_latitude, center_longitude, radius_meters, fence_type, is_active, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        farmId,
        name,
        description || null,
        center_latitude,
        center_longitude,
        radius_meters,
        fence_type || 'custom',
        is_active !== false,
        createdBy
      ]
    );

    if (result.success) {
      res.status(201).json({
        success: true,
        message: 'Virtual fence created successfully',
        data: { id: result.data.insertId }
      });
    } else {
      throw new Error('Failed to create virtual fence');
    }

  } catch (error) {
    console.error('Create virtual fence error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update virtual fence
const updateVirtualFence = async (req, res) => {
  try {
    const { id } = req.params;
    const farmId = 1; // Default farm for demo
    const {
      name,
      description,
      center_latitude,
      center_longitude,
      radius_meters,
      fence_type,
      is_active
    } = req.body;

    // Validate required fields
    if (!name || !center_latitude || !center_longitude || !radius_meters) {
      return res.status(400).json({
        success: false,
        message: 'Name, coordinates, and radius are required'
      });
    }

    // Validate coordinate ranges
    if (center_latitude < -90 || center_latitude > 90) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be between -90 and 90'
      });
    }

    if (center_longitude < -180 || center_longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be between -180 and 180'
      });
    }

    // Validate radius
    if (radius_meters < 50 || radius_meters > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Radius must be between 50 and 10000 meters'
      });
    }

    // Check if fence exists and belongs to farm
    const checkResult = await executeQuery(
      'SELECT id FROM virtual_fences WHERE id = ? AND farm_id = ?',
      [id, farmId]
    );

    if (!checkResult.success || checkResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Virtual fence not found'
      });
    }

    const result = await executeQuery(
      `UPDATE virtual_fences 
       SET name = ?, description = ?, center_latitude = ?, center_longitude = ?, 
           radius_meters = ?, fence_type = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND farm_id = ?`,
      [
        name,
        description || null,
        center_latitude,
        center_longitude,
        radius_meters,
        fence_type || 'custom',
        is_active !== false,
        id,
        farmId
      ]
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Virtual fence updated successfully'
      });
    } else {
      throw new Error('Failed to update virtual fence');
    }

  } catch (error) {
    console.error('Update virtual fence error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete virtual fence
const deleteVirtualFence = async (req, res) => {
  try {
    const { id } = req.params;
    const farmId = 1; // Default farm for demo

    // Check if fence exists and belongs to farm
    const checkResult = await executeQuery(
      'SELECT id FROM virtual_fences WHERE id = ? AND farm_id = ?',
      [id, farmId]
    );

    if (!checkResult.success || checkResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Virtual fence not found'
      });
    }

    const result = await executeQuery(
      'DELETE FROM virtual_fences WHERE id = ? AND farm_id = ?',
      [id, farmId]
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Virtual fence deleted successfully'
      });
    } else {
      throw new Error('Failed to delete virtual fence');
    }

  } catch (error) {
    console.error('Delete virtual fence error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get animal locations
const getAnimalLocations = async (req, res) => {
  try {
    const farmId = 1; // Default farm for demo

    // Prefer current_locations (upserted by GPS POST) for latest per-animal positions
    const currentRes = await executeQuery(
      `SELECT 
         cl.animal_id,
         cl.collar_id,
         cl.latitude,
         cl.longitude,
         cl.recorded_at AS timestamp,
         cl.battery_level,
         cl.signal_quality,
         cl.temperature_celsius
       FROM current_locations cl
       JOIN animals a ON cl.animal_id = a.id
       WHERE a.farm_id = ?
       ORDER BY cl.recorded_at DESC`,
      [farmId]
    );

    if (currentRes.success && Array.isArray(currentRes.data) && currentRes.data.length > 0) {
      return res.json({ success: true, data: currentRes.data });
    }

    // Fallback: return recent rows from animal_locations if current_locations is empty
    const histRes = await executeQuery(
      `SELECT 
         al.id,
         al.animal_id,
         al.latitude,
         al.longitude,
         al.recorded_at AS timestamp,
         al.speed_kmh,
         al.battery_level
       FROM animal_locations al
       JOIN animals a ON al.animal_id = a.id
       WHERE a.farm_id = ?
       ORDER BY al.recorded_at DESC`,
      [farmId]
    );
    const locations = histRes.success ? histRes.data : [];

    return res.json({ success: true, data: locations });

  } catch (error) {
    console.error('Get animal locations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get alerts (return all alerts, latest first)
const getAlerts = async (req, res) => {
  try {
    const farmId = 1; // Default farm for demo

    const result = await executeQuery(
      `SELECT 
         id,
         animal_id,
         alert_type,
         severity,
         message,
         triggered_at AS timestamp,
         status,
         location_latitude,
         location_longitude
       FROM alerts
       WHERE farm_id = ?
       ORDER BY triggered_at DESC`,
      [farmId]
    );
    const alerts = result.success ? result.data : [];

    res.json({
      success: true,
      data: alerts
    });

  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Mark alert as read (acknowledged)
const markAlertRead = async (req, res) => {
  try {
    const { id } = req.params;
    const acknowledgedBy = (req.user && req.user.id) ? req.user.id : null;

    const existing = await executeQuery('SELECT id, status FROM alerts WHERE id = ?', [id]);
    if (!existing.success || existing.data.length === 0) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }

    // Only update if not already acknowledged/resolved/dismissed
    const result = await executeQuery(
      `UPDATE alerts 
       SET status = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = ?
       WHERE id = ?`,
      [acknowledgedBy, id]
    );
    if (!result.success) {
      return res.status(500).json({ success: false, message: 'Failed to mark alert as read' });
    }

    res.json({ success: true, message: 'Alert marked as read' });
  } catch (error) {
    console.error('Mark alert read error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  login,
  getDashboardSummary,
  getAnimals,
  getVirtualFences,
  createVirtualFence,
  updateVirtualFence,
  deleteVirtualFence,
  getAnimalLocations,
  getAlerts,
  markAlertRead,
  getAnimalById,
  addAnimal,
  updateAnimal,
  deleteAnimal,
  resolveAlert
  ,updateAnimalLocation
};
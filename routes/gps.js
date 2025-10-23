const express = require('express');
const router = express.Router();
const { executeQuery } = require('../database');
const gpsEmitter = require('../gpsEvents');

// POST /gps - save a GPS point
router.post('/', async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      animal_id = null,
      collar_id = null,
      altitude_meters = null,
      accuracy_meters = null,
      speed_kmh = null,
      heading_degrees = null,
      recorded_at = null,
      battery_level = null,
      signal_quality = null,
      temperature_celsius = null
    } = req.body;

    // Allow updating an existing historical GPS row when client provides update_id (or id)
    const updateId = req.body.update_id || req.body.id || null;

    if (updateId) {
      // Build update statement for animal_locations
      const updateSql = `UPDATE animal_locations SET
        animal_id = ?,
        collar_id = ?,
        latitude = ?,
        longitude = ?,
        altitude_meters = ?,
        accuracy_meters = ?,
        speed_kmh = ?,
        heading_degrees = ?,
        recorded_at = ?,
        battery_level = ?,
        signal_quality = ?,
        temperature_celsius = ?
      WHERE id = ?`;

      const updateParams = [
        animal_id,
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
        temperature_celsius,
        updateId
      ];

      const updateRes = await executeQuery(updateSql, updateParams);
      if (!updateRes.success) {
        return res.status(500).json({ success: false, message: 'Failed to update animal_locations', error: updateRes.error });
      }
      // Also upsert into current_locations for real-time dashboard updates
      try {
        const upsertSql = `INSERT INTO current_locations (animal_id, collar_id, latitude, longitude, recorded_at, battery_level, signal_quality, temperature_celsius)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            recorded_at = VALUES(recorded_at),
            battery_level = VALUES(battery_level),
            signal_quality = VALUES(signal_quality),
            temperature_celsius = VALUES(temperature_celsius)`;
        const upsertParams = [
          animal_id,
          collar_id,
          Number(latitude),
          Number(longitude),
          recorded_at ? recorded_at : new Date(),
          battery_level,
          signal_quality,
          temperature_celsius
        ];
        await executeQuery(upsertSql, upsertParams);
        // Emit live event for subscribers so maps refresh
        try {
          gpsEmitter.emit('location', {
            animal_id,
            collar_id,
            latitude: Number(latitude),
            longitude: Number(longitude),
            recorded_at: upsertParams[4],
            battery_level,
            signal_quality,
            temperature_celsius
          });
        } catch (emitErr) {
          console.warn('Failed to emit gps location event after update:', emitErr && emitErr.message ? emitErr.message : emitErr);
        }
      } catch (upErr) {
        console.warn('Failed to upsert current_locations after gps update:', upErr.message || upErr);
      }
      return res.json({ success: true, message: 'GPS record updated', id: updateId });
    }

    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'Missing coordinates' });
    }

    // If device includes an animal_id or collar_id, store in the high-frequency animal_locations table
    if (animal_id || collar_id) {
      const sql = `INSERT INTO animal_locations (
        animal_id, collar_id, latitude, longitude, altitude_meters, accuracy_meters,
        speed_kmh, heading_degrees, recorded_at, battery_level, signal_quality, temperature_celsius
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      const params = [
        animal_id,
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

      const result = await executeQuery(sql, params);
      if (!result.success) {
        return res.status(500).json({ success: false, message: 'Database error', error: result.error });
      }

  // Upsert into current_locations so dashboard shows latest position
      try {
        const upsertSql = `INSERT INTO current_locations (animal_id, collar_id, latitude, longitude, recorded_at, battery_level, signal_quality, temperature_celsius)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            latitude = VALUES(latitude),
            longitude = VALUES(longitude),
            recorded_at = VALUES(recorded_at),
            battery_level = VALUES(battery_level),
            signal_quality = VALUES(signal_quality),
            temperature_celsius = VALUES(temperature_celsius)`;
        const upsertParams = [
          animal_id,
          collar_id,
          Number(latitude),
          Number(longitude),
          recorded_at ? recorded_at : new Date(),
          battery_level,
          signal_quality,
          temperature_celsius
        ];
        await executeQuery(upsertSql, upsertParams);
        // Emit live event for subscribers
        try {
          gpsEmitter.emit('location', {
            animal_id,
            collar_id,
            latitude: Number(latitude),
            longitude: Number(longitude),
            recorded_at: upsertParams[4],
            battery_level,
            signal_quality,
            temperature_celsius
          });
        } catch (emitErr) {
          console.warn('Failed to emit gps location event:', emitErr && emitErr.message ? emitErr.message : emitErr);
        }
      } catch (upErr) {
        console.warn('Failed to upsert current_locations:', upErr.message || upErr);
        // non-fatal — we already inserted the historical record
      }

      return res.json({ success: true, message: 'Animal location saved', id: result.insertId || null });
    }

    // Otherwise fall back to updating a single global current location row
    // We use a reserved animal_id = 0 to store the last raw GPS position (no specific animal)
    try {
      const upsertSql = `INSERT INTO current_locations (animal_id, collar_id, latitude, longitude, recorded_at)
        VALUES (0, NULL, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          recorded_at = VALUES(recorded_at)`;
      const now = new Date();
      const upsertRes = await executeQuery(upsertSql, [Number(latitude), Number(longitude), now]);
      if (!upsertRes.success) {
        console.warn('Failed to upsert current_locations for raw gps:', upsertRes.error);
        return res.status(500).json({ success: false, message: 'Database error', error: upsertRes.error });
      }

      // Emit live event for raw gps point as well
      try {
        gpsEmitter.emit('location', {
          animal_id: 0,
          collar_id: null,
          latitude: Number(latitude),
          longitude: Number(longitude),
          recorded_at: now
        });
      } catch (emitErr) {
        console.warn('Failed to emit gps location event (raw):', emitErr && emitErr.message ? emitErr.message : emitErr);
      }

      return res.json({ success: true, message: 'GPS coordinates saved (updated current location)' });
    } catch (errUp) {
      console.error('Raw GPS upsert error:', errUp);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  } catch (err) {
    console.error('GPS route error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /gps - fetch recent GPS points (optional ?limit=100)
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const sql = 'SELECT id, latitude, longitude, created_at FROM gps_data ORDER BY created_at DESC LIMIT ?';
    const result = await executeQuery(sql, [limit]);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('GPS fetch error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /gps/markers - return current positions suitable for map markers
router.get('/markers', async (req, res) => {
  try {
    const sql = `SELECT cl.animal_id, cl.collar_id, cl.latitude, cl.longitude, cl.recorded_at, cl.battery_level, cl.signal_quality, a.name as animal_name, a.tag_number
      FROM current_locations cl
      LEFT JOIN animals a ON a.id = cl.animal_id
      WHERE cl.latitude IS NOT NULL AND cl.longitude IS NOT NULL`;
    const result = await executeQuery(sql, []);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('GPS markers fetch error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /gps/markers - return current positions (from current_locations) for map markers
router.get('/markers', async (req, res) => {
  try {
    const sql = `SELECT cl.animal_id, cl.collar_id, cl.latitude, cl.longitude, cl.recorded_at, cl.battery_level, a.name as animal_name, a.tag_number
      FROM current_locations cl
      LEFT JOIN animals a ON a.id = cl.animal_id
      WHERE cl.latitude IS NOT NULL AND cl.longitude IS NOT NULL`;
    const result = await executeQuery(sql, []);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('GPS markers error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /gps/current - return a single current_locations row
// Query params: ?animal_id=123  OR ?collar_id=xxx
// If neither provided, returns the 'raw' current location row (animal_id = 0) if present
router.get('/current', async (req, res) => {
  try {
    const { animal_id, collar_id } = req.query;

    let sql = `SELECT cl.animal_id, cl.collar_id, cl.latitude, cl.longitude, cl.recorded_at, cl.battery_level, cl.signal_quality, a.name as animal_name, a.tag_number
      FROM current_locations cl
      LEFT JOIN animals a ON a.id = cl.animal_id
      WHERE cl.latitude IS NOT NULL AND cl.longitude IS NOT NULL`;
    const params = [];

    if (animal_id != null) {
      sql += ' AND cl.animal_id = ? LIMIT 1';
      params.push(animal_id);
    } else if (collar_id != null) {
      sql += ' AND cl.collar_id = ? LIMIT 1';
      params.push(collar_id);
    } else {
      // try to return the special raw row (animal_id=0) first, otherwise the most recently recorded
      sql += ' AND cl.animal_id = 0 LIMIT 1';
    }

    const result = await executeQuery(sql, params);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });

    const row = (result.data && result.data.length) ? result.data[0] : null;
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error('GPS current fetch error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { executeQuery } = require('../database');

// GET /device/control - returns { success: true, state: 'on'|'off' }
router.get('/control', async (req, res) => {
  try {
    // Try to read from a device_controls table (key,value). Fallback to in-memory default.
    const r = await executeQuery(`SELECT control_value FROM device_controls WHERE control_key = 'system_enabled' LIMIT 1`);
    if (r.success && Array.isArray(r.data) && r.data.length > 0) {
      const val = r.data[0].control_value;
      const state = (String(val).toLowerCase() === 'off') ? 'off' : 'on';
      return res.json({ success: true, state });
    }
    // fallback default: on
    return res.json({ success: true, state: 'on' });
  } catch (err) {
    console.error('Device control GET error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /device/control - body { state: 'on'|'off' }
router.post('/control', async (req, res) => {
  try {
    const state = (req.body && req.body.state && String(req.body.state).toLowerCase() === 'off') ? 'off' : 'on';
    // Ensure table exists
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS device_controls (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        control_key VARCHAR(128) UNIQUE NOT NULL,
        control_value VARCHAR(64) DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    // Upsert
    const upsert = await executeQuery(`
      INSERT INTO device_controls (control_key, control_value) VALUES ('system_enabled', ?)
      ON DUPLICATE KEY UPDATE control_value = VALUES(control_value)
    `, [state]);
    if (!upsert.success) return res.status(500).json({ success: false, message: 'Failed to set control state' });
    return res.json({ success: true, state });
  } catch (err) {
    console.error('Device control POST error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;

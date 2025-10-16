const express = require('express');
const router = express.Router();
const { executeQuery } = require('../database');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Simple helper to send email using SMTP creds from env
const sendEmail = async ({ to, subject, text, html }) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465,
    secure: (process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
  return info;
};

// Endpoint for devices to report alerts.
// Accepts GET or POST. Query params: alert, distance, motion, lat, lon
// handler function exposed for direct use by server (fallbacks)
const handleAlert = async (req, res) => {
  try {
    const payload = req.method === 'GET' ? req.query : req.body;

    // Map incoming fields to the alerts table columns
    const farm_id = payload.farm_id ? Number(payload.farm_id) : 1;
    const animal_id = payload.animal_id ? Number(payload.animal_id) : null;
    const collar_id = payload.collar_id ? Number(payload.collar_id) : null;
    const fence_id = payload.fence_id ? Number(payload.fence_id) : null;
  // Normalize and enforce maximum lengths to match DB columns to avoid truncation errors
  const raw_alert_type = payload.alert_type ? String(payload.alert_type) : (payload.alert ? 'device' : 'device');
  const raw_severity = payload.severity ? String(payload.severity) : 'medium';
  const raw_title = payload.alert || payload.title || 'Device Alert';
  const raw_message = payload.message || `distance=${payload.distance || ''} motion=${payload.motion || ''}`;
  const raw_alert_data = payload.alert_data ? String(payload.alert_data) : null;

  // DB column sizes: alert_type VARCHAR(100), severity VARCHAR(32), title VARCHAR(255)
  const MAX_ALERT_TYPE = 100;
  const MAX_SEVERITY = 32;
  const MAX_TITLE = 255;

  const alert_type = raw_alert_type.length > MAX_ALERT_TYPE ? raw_alert_type.substring(0, MAX_ALERT_TYPE) : raw_alert_type;
  const severity = raw_severity.length > MAX_SEVERITY ? raw_severity.substring(0, MAX_SEVERITY) : raw_severity;
  const title = raw_title.length > MAX_TITLE ? raw_title.substring(0, MAX_TITLE) : raw_title;
  const message = raw_message; // message is TEXT in DB, keep as-is
  const alert_data = raw_alert_data;

  // Log when we had to truncate incoming values to help debugging devices that send long strings
  if (raw_alert_type.length > MAX_ALERT_TYPE) console.warn('Truncated alert_type from', raw_alert_type.length, 'to', MAX_ALERT_TYPE);
  if (raw_severity.length > MAX_SEVERITY) console.warn('Truncated severity from', raw_severity.length, 'to', MAX_SEVERITY);
  if (raw_title.length > MAX_TITLE) console.warn('Truncated title from', raw_title.length, 'to', MAX_TITLE);
    const location_latitude = (payload.lat || payload.location_latitude) ? Number(payload.lat || payload.location_latitude) : null;
    const location_longitude = (payload.lon || payload.location_longitude) ? Number(payload.lon || payload.location_longitude) : null;
    const triggered_at = payload.triggered_at ? payload.triggered_at : null; // allow DB default when null
    const status = payload.status ? String(payload.status) : 'active';
    const auto_generated = (typeof payload.auto_generated !== 'undefined') ? Number(payload.auto_generated) : 1;

    // Insert into alerts table with explicit columns matching schema
    const sql = `
      INSERT INTO alerts (
        farm_id, animal_id, collar_id, fence_id, alert_type, severity,
        title, message, alert_data, location_latitude, location_longitude,
        triggered_at, status, auto_generated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      farm_id,
      animal_id,
      collar_id,
      fence_id,
      alert_type,
      severity,
      title,
      message,
      alert_data,
      location_latitude,
      location_longitude,
      triggered_at,
      status,
      auto_generated
    ];

    const result = await executeQuery(sql, params);
    if (!result.success) {
      console.error('Failed to insert alert:', result.error);
      return res.status(500).json({ success: false, message: 'Failed to insert alert', error: result.error });
    }

    const insertedId = (result.data && (result.data.insertId || result.data.insert_id)) ? (result.data.insertId || result.data.insert_id) : null;

    // Send email notification if SMTP configured
    if (process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ALERT_EMAIL_TO) {
      const to = process.env.ALERT_EMAIL_TO;
      const subject = `Cattle Farm Alert: ${title}`;
      const text = `Alert: ${title}\nSeverity: ${severity}\nMessage: ${message}\nLocation: ${location_latitude}, ${location_longitude}`;
      try {
        await sendEmail({ to, subject, text });
      } catch (mailErr) {
        console.warn('Failed to send alert email:', mailErr && mailErr.message ? mailErr.message : mailErr);
      }
    }

    return res.status(201).json({ success: true, message: 'Alert recorded', id: insertedId });
  } catch (err) {
    console.error('Device alert route error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// attach to router and support both trailing and non-trailing slash
router.all(['/alert', '/alert/'], handleAlert);

// Temporary echo endpoint for debugging device reachability (no DB)
// POST /api/v1/device/echo or /device/echo will return the request body and headers
router.post(['/echo', '/echo/'], async (req, res) => {
  try {
    console.log('📣 Echo endpoint hit:', { path: req.path, method: req.method });
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    return res.json({ success: true, message: 'echo', path: req.path, method: req.method, headers: req.headers, body: req.body });
  } catch (err) {
    console.error('Echo handler error:', err);
    return res.status(500).json({ success: false, message: 'Echo error' });
  }
});

// Simple ping to verify route is alive
router.get('/ping', (req, res) => {
  res.json({ success: true, message: 'device route is reachable' });
});

// Export router and handler properly so server can mount handler directly as a fallback
module.exports = router;
module.exports.handleAlert = handleAlert;

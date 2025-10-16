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

  let alert_type = raw_alert_type.length > MAX_ALERT_TYPE ? raw_alert_type.substring(0, MAX_ALERT_TYPE) : raw_alert_type;
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

    // Before inserting, verify actual DB column limits (character length and octet length)
    try {
      const dbName = process.env.DB_NAME || 'cattle_farm_monitoring';
      const colRes = await executeQuery(
        `SELECT CHARACTER_MAXIMUM_LENGTH, CHARACTER_OCTET_LENGTH, CHARACTER_SET_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'alerts' AND COLUMN_NAME = 'alert_type' LIMIT 1`,
        [dbName]
      );
      if (colRes.success && Array.isArray(colRes.data) && colRes.data.length > 0) {
        const info = colRes.data[0];
        const charLimit = info.CHARACTER_MAXIMUM_LENGTH || MAX_ALERT_TYPE;
        const octetLimit = info.CHARACTER_OCTET_LENGTH || (MAX_ALERT_TYPE * 4);
        const alertChars = alert_type.length;
        const alertBytes = Buffer.byteLength(alert_type, 'utf8');
        console.debug('alert_type char/bytes:', alertChars, '/', alertBytes, 'db charLimit/octetLimit:', charLimit, '/', octetLimit, 'charset:', info.CHARACTER_SET_NAME);
        // If the byte length exceeds octetLimit, truncate by bytes safely
        if (alertBytes > octetLimit) {
          // Truncate by characters until byte length fits
          let truncated = alert_type;
          while (Buffer.byteLength(truncated, 'utf8') > octetLimit && truncated.length > 0) {
            truncated = truncated.substring(0, Math.max(0, truncated.length - 1));
          }
          console.warn('Byte-aware truncated alert_type from', alertBytes, 'bytes to', Buffer.byteLength(truncated, 'utf8'), 'bytes');
          alert_type = truncated;
        }
        // Also ensure we don't exceed character limit
        if (alert_type.length > charLimit) {
          console.warn('Char-limit truncated alert_type from', alert_type.length, 'to', charLimit);
          alert_type = alert_type.substring(0, charLimit);
        }
      } else {
        // Could not fetch column info - log and continue with prior truncation
        console.debug('Could not read alerts.alert_type column metadata, using configured limits');
      }
    } catch (colErr) {
      console.warn('Failed to check alert_type column metadata:', colErr && colErr.message ? colErr.message : colErr);
    }

    // Build INSERT dynamically so we don't explicitly insert NULL into columns
    // that rely on DB defaults (e.g. triggered_at)
    const insertCols = [];
    const placeholders = [];
    const insertParams = [];

    const pushCol = (col, val) => {
      insertCols.push(col);
      placeholders.push('?');
      insertParams.push(val);
    };

    pushCol('farm_id', farm_id);
    if (animal_id !== null) pushCol('animal_id', animal_id);
    if (collar_id !== null) pushCol('collar_id', collar_id);
    if (fence_id !== null) pushCol('fence_id', fence_id);
    pushCol('alert_type', alert_type);
    pushCol('severity', severity);
    if (title !== undefined && title !== null) pushCol('title', title);
    if (message !== undefined && message !== null) pushCol('message', message);
    if (alert_data !== null) pushCol('alert_data', alert_data);
    if (location_latitude !== null) pushCol('location_latitude', location_latitude);
    if (location_longitude !== null) pushCol('location_longitude', location_longitude);
    // Only include triggered_at if the device explicitly provided a value
    if (triggered_at) {
      pushCol('triggered_at', triggered_at);
    }
    pushCol('status', status);
    pushCol('auto_generated', auto_generated);

    const sql = `INSERT INTO alerts (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})`;

    const result = await executeQuery(sql, insertParams);
    if (!result.success) {
      // Extra diagnostic logging to help trace truncation cause
      try {
        const paramInfo = params.map(p => ({ type: typeof p, length: (p && typeof p === 'string') ? p.length : null }));
        console.error('Failed to insert alert:', result.error);
        console.error('Insert params info:', paramInfo);
        console.error('Sample alert_type (chars/bytes):', alert_type ? alert_type.length : 0, '/', alert_type ? Buffer.byteLength(alert_type, 'utf8') : 0);
        console.error('Sample title (chars/bytes):', title ? title.length : 0, '/', title ? Buffer.byteLength(title, 'utf8') : 0);
        console.error('Sample message (chars/bytes):', message ? message.length : 0, '/', message ? Buffer.byteLength(message, 'utf8') : 0);
        // Keep an abbreviated payload in logs (avoid huge dumps)
        console.error('Payload sample:', JSON.stringify({ alert_type: alert_type ? alert_type.substring(0, 200) : null, title: title ? title.substring(0, 200) : null, message: message ? message.substring(0, 400) : null }));
      } catch (diagErr) {
        console.error('Diagnostic logging failed:', diagErr && diagErr.message ? diagErr.message : diagErr);
      }
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

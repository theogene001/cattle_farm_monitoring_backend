const express = require('express');
const router = express.Router();
const gpsEmitter = require('../gpsEvents');

// GET /gps/stream - Server-Sent Events stream of GPS locations
router.get('/stream', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const onLocation = (data) => {
    try {
      const payload = JSON.stringify(data);
      res.write(`data: ${payload}\n\n`);
    } catch (err) {
      console.warn('SSE write failed:', err);
    }
  };

  gpsEmitter.on('location', onLocation);

  // Send a ping every 20s to keep the connection alive
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 20000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    gpsEmitter.removeListener('location', onLocation);
  });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware');
const { updateRemoteConfig } = require('../controllers');

// POST /settings/remote-config
router.post('/remote-config', authenticateToken, updateRemoteConfig);

module.exports = router;

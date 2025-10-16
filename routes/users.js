const express = require('express');
const router = express.Router();
const { executeQuery } = require('../database');
const bcrypt = require('bcryptjs');
const { authenticateToken } = require('../middleware');

// GET /users - list users (protected)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await executeQuery('SELECT id, name, email, role, phone_number, is_active, created_at FROM users ORDER BY created_at DESC', []);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });
    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('Get users error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /users - create a user (protected - admin)
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Allow only admin users to create others (basic check)
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    const { name, email, password, role = 'user', phone_number = null } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Missing required fields' });
    const passwordHash = bcrypt.hashSync(password, 12);
    const result = await executeQuery('INSERT INTO users (name, email, password_hash, role, phone_number, is_active) VALUES (?, ?, ?, ?, ?, TRUE)', [name, email, passwordHash, role, phone_number]);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });
    return res.status(201).json({ success: true, message: 'User created', id: result.insertId });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUT /users/:id - update a user (protected - admin)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { id } = req.params;
    const { name, email, role, password, phone_number, is_active } = req.body;
    const fields = [];
    const params = [];
    if (name) { fields.push('name = ?'); params.push(name); }
    if (email) { fields.push('email = ?'); params.push(email); }
    if (role) { fields.push('role = ?'); params.push(role); }
    if (typeof is_active !== 'undefined') { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (phone_number) { fields.push('phone_number = ?'); params.push(phone_number); }
    if (password) { const hash = bcrypt.hashSync(password, 12); fields.push('password_hash = ?'); params.push(hash); }
    if (fields.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
    params.push(id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    const result = await executeQuery(sql, params);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });
    return res.json({ success: true, message: 'User updated' });
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// DELETE /users/:id - delete a user (protected - admin)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { id } = req.params;
    const result = await executeQuery('DELETE FROM users WHERE id = ?', [id]);
    if (!result.success) return res.status(500).json({ success: false, message: 'Database error', error: result.error });
    return res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;

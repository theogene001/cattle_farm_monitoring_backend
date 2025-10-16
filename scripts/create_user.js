#!/usr/bin/env node
/**
 * Create a user row with a bcrypt-hashed password.
 * Usage:
 *   node backend/scripts/create_user.js email@example.com MyP@ssw0rd role name
 * role defaults to 'farm_manager', name defaults to 'New User'
 */
const bcrypt = require('bcryptjs');
const { executeQuery } = require('../database');

const run = async () => {
  try {
    const email = process.argv[2];
    const password = process.argv[3];
    const role = process.argv[4] || 'farm_manager';
    const name = process.argv[5] || 'New User';

    if (!email || !password) {
      console.error('Usage: node backend/scripts/create_user.js email password [role] [name]');
      process.exit(2);
    }
    if (password.length < 6) {
      console.error('Password must be at least 6 characters');
      process.exit(2);
    }

    const hash = bcrypt.hashSync(password, 12);
    const res = await executeQuery(
      'INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, TRUE)',
      [name, email, hash, role]
    );
    if (!res.success) {
      console.error('Failed to create user:', res.error);
      process.exit(1);
    }
    console.log(`✅ Created user ${email} with id=${res.data.insertId || '(unknown)'} and role=${role}`);
    process.exit(0);
  } catch (err) {
    console.error('Unexpected error:', err && err.message ? err.message : err);
    process.exit(1);
  }
};

run();

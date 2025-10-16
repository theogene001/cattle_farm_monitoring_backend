#!/usr/bin/env node
/**
 * Simple one-off script to reset the admin user's password.
 * Usage (on server / in project):
 *   node backend/scripts/reset_admin_password.js newPassword
 * OR set env var RESET_ADMIN_PASSWORD and run without args.
 *
 * The script uses the same executeQuery wrapper as the app.
 * It does NOT start the server. Run it from the project root where
 * environment variables (DB connection) are available.
 */
const bcrypt = require('bcryptjs');
const { executeQuery } = require('../database');

const run = async () => {
  try {
    const arg = process.argv[2] || process.env.RESET_ADMIN_PASSWORD;
    if (!arg) {
      console.error('Usage: node backend/scripts/reset_admin_password.js <newPassword>');
      process.exit(2);
    }
    const newPassword = String(arg);
    if (newPassword.length < 6) {
      console.error('Password must be at least 6 characters');
      process.exit(2);
    }

    const email = 'admin@cattlefarm.com';
    const hash = bcrypt.hashSync(newPassword, 12);

    // Ensure user exists
    const check = await executeQuery('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
    if (!check.success) {
      console.error('DB error while checking admin user:', check.error);
      process.exit(1);
    }
    if (check.data.length === 0) {
      console.error('Admin user not found. No changes made.');
      process.exit(1);
    }

    const upd = await executeQuery('UPDATE users SET password_hash = ? WHERE LOWER(email) = LOWER(?)', [hash, email]);
    if (!upd.success) {
      console.error('Failed to update admin password:', upd.error);
      process.exit(1);
    }

    console.log(`✅ Admin password for ${email} updated. Use the new password to log in.`);
    process.exit(0);
  } catch (err) {
    console.error('Unexpected error:', err && err.message ? err.message : err);
    process.exit(1);
  }
};

run();

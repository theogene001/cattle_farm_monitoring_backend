#!/usr/bin/env node
/**
 * Simple utility to replace any non-bcrypt password_hash values in `users`
 * with a bcrypt hash of the supplied password.
 * Usage:
 *   node backend/scripts/hash_plain_passwords.js NewSecureP@ss
 * This will locate rows where password_hash does not start with "$2" and
 * set them to bcrypt hash of the provided password. Intended for quick
 * dev/repair operations only. Do NOT run in production without review.
 */
const bcrypt = require('bcryptjs');
const { executeQuery } = require('../database');

const run = async () => {
  try {
    const newPassword = process.argv[2] || process.env.NEW_PASSWORD;
    if (!newPassword) {
      console.error('Usage: node backend/scripts/hash_plain_passwords.js <newPassword>');
      process.exit(2);
    }
    if (newPassword.length < 6) {
      console.error('Password must be at least 6 characters');
      process.exit(2);
    }

    const hash = bcrypt.hashSync(newPassword, 12);

    // Find users with non-bcrypt password_hash (simple heuristic: bcrypt hashes start with $2)
    const findRes = await executeQuery("SELECT id, email, password_hash FROM users WHERE password_hash NOT LIKE '$2%'");
    if (!findRes.success) {
      console.error('DB error while searching for plaintext passwords:', findRes.error);
      process.exit(1);
    }

    if (findRes.data.length === 0) {
      console.log('No plaintext password_hash values found. Nothing to do.');
      process.exit(0);
    }

    console.log(`Found ${findRes.data.length} user(s) with non-bcrypt password values:`);
    findRes.data.forEach(u => console.log(` - id=${u.id} email=${u.email}`));

    // Update them all to the same provided password hash
    const upd = await executeQuery('UPDATE users SET password_hash = ? WHERE password_hash NOT LIKE "$2%"', [hash]);
    if (!upd.success) {
      console.error('Failed to update users:', upd.error);
      process.exit(1);
    }

    console.log(`✅ Updated ${upd.data.affectedRows || '(unknown)'} user(s). They can now log in using the provided password.`);
    process.exit(0);
  } catch (err) {
    console.error('Unexpected error:', err && err.message ? err.message : err);
    process.exit(1);
  }
};

run();

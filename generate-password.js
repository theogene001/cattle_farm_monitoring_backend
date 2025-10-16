// generate-password.js - Generate hashed passwords for testing
const bcrypt = require('bcryptjs');

console.log('=== Password Hashes for Testing ===');
console.log('');

// Common test passwords
const passwords = ['admin123', 'password123', 'test123', 'demo123'];

passwords.forEach(password => {
    const hash = bcrypt.hashSync(password, 12);
    console.log(`Password: "${password}"`);
    console.log(`Hash: ${hash}`);
    console.log('');
});

console.log('=== Testing existing hash ===');
const existingHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewFXq1eaPQHHQO4e';
console.log('Testing if "admin123" matches existing hash...');
console.log('Match:', bcrypt.compareSync('admin123', existingHash));
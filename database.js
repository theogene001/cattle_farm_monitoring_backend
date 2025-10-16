const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cattle_farm_monitoring',
  waitForConnections: true,
  // Allow environment override for pool size; default to 5 to avoid excessive queuing
  // Many hosted MySQL users have low limits; override with DB_POOL_LIMIT env var if needed.
  connectionLimit: parseInt(process.env.DB_POOL_LIMIT, 10) || 5,
  queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Execute query with error handling
const executeQuery = async (query, params = []) => {
  try {
    const [rows] = await pool.execute(query, params);
    return { success: true, data: rows };
  } catch (error) {
    // Detect common 'max connections' error and surface a machine-readable code
    const msg = error && error.message ? error.message : String(error);
    if (/max_user_connections/i.test(msg) || /too many connections/i.test(msg)) {
      console.error('Database max connections error:', msg);
      return { success: false, error: msg, code: 'MAX_USER_CONNECTIONS' };
    }

    console.error('Database query error:', msg);
    return { success: false, error: msg };
  }
};

module.exports = {
  pool,
  testConnection,
  executeQuery
};
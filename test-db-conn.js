const mysql = require('mysql2/promise');
const fs = require('fs');

(async () => {
  try {
    const config = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 2
    };

    if ((process.env.DB_SSL || 'false').toLowerCase() === 'true') {
      const ssl = { rejectUnauthorized: true };
      if (process.env.DB_SSL_CA) {
        try {
          if (fs.existsSync(process.env.DB_SSL_CA)) {
            ssl.ca = fs.readFileSync(process.env.DB_SSL_CA);
          } else {
            ssl.ca = Buffer.from(process.env.DB_SSL_CA, 'base64');
          }
        } catch (err) {
          // fallback to raw
          ssl.ca = process.env.DB_SSL_CA;
        }
      }
      config.ssl = ssl;
    }

    const pool = mysql.createPool(config);
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT 1+1 AS v');
    console.log('DB test succeeded:', rows);
    conn.release();
    process.exit(0);
  } catch (err) {
    console.error('DB test failed:', err && err.code ? `${err.code} - ${err.message}` : err.message);
    process.exit(2);
  }
})();

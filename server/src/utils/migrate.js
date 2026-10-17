const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { pool } = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationsDir = path.join(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    const { rows } = await client.query('SELECT name FROM migrations');
    const applied = new Set(rows.map(r => r.name));

    let executed = 0;
    for (const file of files) {
      if (!applied.has(file)) {
        console.log(`Applying migration: ${file}`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`Successfully applied: ${file}`);
          executed++;
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`Error applying migration ${file}:`, error);
          throw error;
        }
      }
    }

    if (executed === 0) {
      console.log('No pending migrations.');
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      pool.end();
      process.exit(1);
    });
}

module.exports = migrate;

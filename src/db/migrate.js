const fs = require('fs')
const path = require('path')
const pool = require('./index')
const logger = require('../logger')

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const waitForDatabase = async (retries = 10, delay = 3000) => {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1')
      logger.info('Database ready')
      return
    } catch (err) {
      logger.warn(`Waiting for database... attempt ${i}/${retries}`)
      await wait(delay)
    }
  }
  throw new Error('Database never became ready')
}

const runMigrations = async () => {
  await waitForDatabase()
  logger.info('Running migrations...')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      ran_at TIMESTAMP DEFAULT NOW()
    )
  `)

  const migrationsFolder = path.join(__dirname, '../migrations')
  const files = fs.readdirSync(migrationsFolder).sort()

  for (const file of files) {
    if (!file.endsWith('.sql')) continue

    const result = await pool.query(
      'SELECT id FROM migrations WHERE filename = $1', [file]
    )

    if (result.rows.length > 0) {
      logger.info(`Skipping migration: ${file}`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsFolder, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
    logger.info(`Ran migration: ${file}`)
  }

  logger.info('Migrations complete')
}

module.exports = runMigrations
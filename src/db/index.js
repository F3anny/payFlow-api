const { Pool } = require('pg')
const config = require('../config')
const logger = require('../logger')

const pool = new Pool({
  connectionString: config.db.connectionString
})

pool.on('connect', () => {
  logger.info('Connected to PostgreSQL')
})

pool.on('error', (err) => {
  logger.error('PostgreSQL error', { error: err.message })
})

module.exports = pool
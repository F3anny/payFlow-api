require('dotenv').config()
const app = require('./app')
const runMigrations = require('./src/db/migrate')
const logger = require('./src/logger')

const PORT = process.env.PORT || 3000

const start = async () => {
  await runMigrations()
  app.listen(PORT, () => {
    logger.info(`PayFlow API running on port ${PORT}`)
  })
}

start()
const express = require('express')
const app = express()
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const logger = require('./src/logger')
require('dotenv').config()

app.use(helmet())
app.use(express.json())

// general rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, slow down!' }
})
app.use(limiter)

// stricter limiter for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts!' }
})

// routes
app.use('/auth', authLimiter, require('./src/routes/auth'))
app.use('/wallets', require('./src/routes/wallets'))
app.use('/payments', require('./src/routes/payments'))

app.get('/', (req, res) => {
  res.json({ 
    message: 'PayFlow API 🚀',
    version: '1.0.0',
    status: 'running'
  })
})


app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack })
  res.status(500).json({ error: 'Something went wrong!' })
})

module.exports = app
const jwt = require('jsonwebtoken')
const config = require('../config')
const logger = require('../logger')

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, config.jwtSecret)
    req.user = decoded
    next()
  } catch (err) {
    logger.warn('Invalid token attempt', { error: err.message })
    return res.status(401).json({ error: 'Invalid or expired token.' })
  }
}
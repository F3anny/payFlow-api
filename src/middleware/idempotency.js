const redis = require('ioredis')
const config = require('../config')
const logger = require('../logger')

const client = new redis(config.redis.url)

module.exports = async (req, res, next) => {
  const key = req.headers['idempotency-key']

  if (!key) {
    return res.status(400).json({ 
      error: 'Idempotency-Key header is required for this endpoint.' 
    })
  }

  try {
    const cached = await client.get(`idempotency:${key}`)

    if (cached) {
      logger.info('Duplicate request detected, returning cached response', { key })
      return res.status(200).json(JSON.parse(cached))
    }

    // store the response after the request completes
    const originalJson = res.json.bind(res)
    res.json = async (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await client.setex(
          `idempotency:${key}`,
          config.idempotencyTTL,
          JSON.stringify(body)
        )
      }
      return originalJson(body)
    }

    next()
  } catch (err) {
    logger.error('Idempotency check failed', { error: err.message })
    next()
  }
}
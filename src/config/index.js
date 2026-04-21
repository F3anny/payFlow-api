module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'devSecret',
  db: {
    connectionString: process.env.DATABASE_URL
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  bcryptRounds: 10,
  idempotencyTTL: 86400 // 24 hours in seconds
}
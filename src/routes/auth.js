const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { body } = require('express-validator')
const pool = require('../db')
const config = require('../config')
const logger = require('../logger')
const validate = require('../middleware/validate')

// Register
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate
], async (req, res) => {
  const { name, email, password } = req.body

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // check if email exists
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1', [email]
    )
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Email already registered.' })
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, config.bcryptRounds)

    // create user
    const userResult = await client.query(
      `INSERT INTO users (name, email, password) 
       VALUES ($1, $2, $3) 
       RETURNING id, name, email, created_at`,
      [name, email, hashedPassword]
    )
    const user = userResult.rows[0]

    // create wallet automatically for new user
    await client.query(
      'INSERT INTO wallets (user_id) VALUES ($1)',
      [user.id]
    )

    // audit log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, 'USER_REGISTERED', 'user', user.id, 
       JSON.stringify({ name, email }), req.ip]
    )

    await client.query('COMMIT')

    // generate token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      config.jwtSecret,
      { expiresIn: '7d' }
    )

    logger.info('New user registered', { userId: user.id, email })

    res.status(201).json({
      message: 'Account created successfully.',
      user: { id: user.id, name: user.name, email: user.email },
      token
    })

  } catch (err) {
    await client.query('ROLLBACK')
    logger.error('Registration failed', { error: err.message })
    res.status(500).json({ error: 'Registration failed. Please try again.' })
  } finally {
    client.release()
  }
})

// Login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate
], async (req, res) => {
  const { email, password } = req.body

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true', [email]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' })
    }

    const user = result.rows[0]
    const validPassword = await bcrypt.compare(password, user.password)

    if (!validPassword) {
      logger.warn('Failed login attempt', { email })
      return res.status(401).json({ error: 'Invalid credentials.' })
    }

    // audit log
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, 'USER_LOGIN', 'user', user.id, req.ip]
    )

    const token = jwt.sign(
      { id: user.id, email: user.email },
      config.jwtSecret,
      { expiresIn: '7d' }
    )

    logger.info('User logged in', { userId: user.id })

    res.status(200).json({
      message: 'Login successful.',
      user: { id: user.id, name: user.name, email: user.email },
      token
    })

  } catch (err) {
    logger.error('Login failed', { error: err.message })
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
})

module.exports = router;


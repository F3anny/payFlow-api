const express = require('express')
const router = express.Router()
const { body, query } = require('express-validator')
const { randomUUID } = require('crypto')
const auth = require('../middleware/auth')
const validate = require('../middleware/validate')
const idempotency = require('../middleware/idempotency')
const paymentService = require('../services/paymentService')
const logger = require('../logger')

// POST /payments/transfer — send money to another user
router.post('/transfer', auth, idempotency, [
  body('receiver_email')
    .isEmail()
    .withMessage('Valid receiver email is required'),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 255 }),
  validate
], async (req, res) => {
  const { receiver_email, amount, description } = req.body
  const idempotencyKey = req.headers['idempotency-key']

  try {
    const result = await paymentService.transferFunds(
      req.user.id,
      receiver_email,
      amount,
      description || 'Transfer',
      idempotencyKey
    )

    if (result.duplicate) {
      return res.status(200).json({
        message: 'Duplicate request — returning original response.',
        transaction: result.transaction
      })
    }

    if (result.transaction.status === 'flagged') {
      return res.status(200).json({
        message: 'Transfer flagged for review. Funds are held pending approval.',
        transaction: result.transaction
      })
    }

    res.status(200).json({
      message: 'Transfer successful.',
      transaction: result.transaction
    })

  } catch (err) {
    logger.error('Transfer route failed', { error: err.message })

    const errorMap = {
      'Insufficient balance': [400, 'Insufficient balance.'],
      'Receiver not found': [404, 'Receiver not found.'],
      'Sender wallet is locked': [403, 'Your wallet is locked.'],
      'Receiver wallet is locked': [403, 'Receiver wallet is locked.'],
      'Cannot send money to yourself': [400, 'Cannot send money to yourself.']
    }

    const [status, message] = errorMap[err.message] || [500, 'Transfer failed.']
    res.status(status).json({ error: message })
  }
})

// GET /payments/history — get transaction history
router.get('/history', auth, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validate
], async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 10

  try {
    const result = await paymentService.getTransactionHistory(
      req.user.id, page, limit
    )
    res.status(200).json(result)
  } catch (err) {
    logger.error('Get history failed', { error: err.message })
    res.status(500).json({ error: 'Failed to get transaction history.' })
  }
})

module.exports = router
const express = require('express')
const router = express.Router()
const { body, param } = require('express-validator')
const auth = require('../middleware/auth')
const validate = require('../middleware/validate')
const walletService = require('../services/walletService')
const logger = require('../logger')

// GET /wallets/me — get my wallet balance
router.get('/me', auth, async (req, res) => {
  try {
    const wallet = await walletService.getWallet(req.user.id)

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found.' })
    }

    res.status(200).json({
      wallet: {
        id: wallet.id,
        balance: wallet.balance,
        currency: wallet.currency,
        is_locked: wallet.is_locked,
        updated_at: wallet.updated_at
      }
    })
  } catch (err) {
    logger.error('Get wallet failed', { error: err.message })
    res.status(500).json({ error: 'Failed to get wallet.' })
  }
})

// POST /wallets/deposit — deposit money
router.post('/deposit', auth, [
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 255 }),
  validate
], async (req, res) => {
  const { amount, description } = req.body

  try {
    const result = await walletService.deposit(
      req.user.id,
      amount,
      description
    )

    res.status(200).json({
      message: 'Deposit successful.',
      transaction: result.transaction,
      new_balance: result.wallet.balance
    })
  } catch (err) {
    logger.error('Deposit route failed', { error: err.message })

    if (err.message === 'Wallet is locked') {
      return res.status(403).json({ error: 'Your wallet is locked. Contact support.' })
    }

    res.status(500).json({ error: 'Deposit failed. Please try again.' })
  }
})

// POST /wallets/withdraw — withdraw money
router.post('/withdraw', auth, [
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 255 }),
  validate
], async (req, res) => {
  const { amount, description } = req.body

  try {
    const result = await walletService.withdraw(
      req.user.id,
      amount,
      description
    )

    res.status(200).json({
      message: 'Withdrawal successful.',
      transaction: result.transaction,
      new_balance: result.wallet.balance
    })
  } catch (err) {
    logger.error('Withdrawal route failed', { error: err.message })

    if (err.message === 'Insufficient balance') {
      return res.status(400).json({ error: 'Insufficient balance.' })
    }

    if (err.message === 'Wallet is locked') {
      return res.status(403).json({ error: 'Your wallet is locked. Contact support.' })
    }

    res.status(500).json({ error: 'Withdrawal failed. Please try again.' })
  }
})

module.exports = router
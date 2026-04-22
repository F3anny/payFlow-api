const pool = require('../db')
const logger = require('../logger')

const transferFunds = async (senderUserId, receiverEmail, amount, description, idempotencyKey) => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // check if this payment already happened using idempotency key
    const existing = await client.query(
      'SELECT * FROM transactions WHERE idempotency_key = $1',
      [idempotencyKey]
    )
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK')
      logger.info('Duplicate payment detected', { idempotencyKey })
      return { transaction: existing.rows[0], duplicate: true }
    }

    // get sender wallet and lock it
    const senderWalletResult = await client.query(
      `SELECT w.* FROM wallets w
       JOIN users u ON u.id = w.user_id
       WHERE u.id = $1 FOR UPDATE`,
      [senderUserId]
    )
    const senderWallet = senderWalletResult.rows[0]
    if (!senderWallet) throw new Error('Sender wallet not found')
    if (senderWallet.is_locked) throw new Error('Sender wallet is locked')

    // get receiver wallet and lock it
    const receiverWalletResult = await client.query(
      `SELECT w.* FROM wallets w
       JOIN users u ON u.id = w.user_id
       WHERE u.email = $1 FOR UPDATE`,
      [receiverEmail]
    )
    const receiverWallet = receiverWalletResult.rows[0]
    if (!receiverWallet) throw new Error('Receiver not found')
    if (receiverWallet.is_locked) throw new Error('Receiver wallet is locked')

    // can't send to yourself
    if (senderWallet.id === receiverWallet.id) {
      throw new Error('Cannot send money to yourself')
    }

    // check balance
    if (parseFloat(senderWallet.balance) < parseFloat(amount)) {
      throw new Error('Insufficient balance')
    }

    // fraud check — flag if amount is suspiciously large
    const isFlagged = parseFloat(amount) > 1000

    const status = isFlagged ? 'flagged' : 'completed'

    // deduct from sender
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE id = $2`,
      [amount, senderWallet.id]
    )

    // only add to receiver if not flagged
    if (!isFlagged) {
      await client.query(
        `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
         WHERE id = $2`,
        [amount, receiverWallet.id]
      )
    }

    // record transaction
    const transaction = await client.query(
      `INSERT INTO transactions
       (sender_wallet_id, receiver_wallet_id, amount, type, status, description, idempotency_key)
       VALUES ($1, $2, $3, 'transfer', $4, $5, $6)
       RETURNING *`,
      [senderWallet.id, receiverWallet.id, amount, status, description, idempotencyKey]
    )

    // if flagged create a fraud flag record
    if (isFlagged) {
      await client.query(
        `INSERT INTO fraud_flags (transaction_id, reason, severity)
         VALUES ($1, $2, $3)`,
        [transaction.rows[0].id, 'Amount exceeds $1000 threshold', 'high']
      )
      logger.warn('Transaction flagged for fraud review', {
        amount, senderUserId, receiverEmail
      })
    }

    // audit log
    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_type, entity_id, new_value)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        senderUserId, 'TRANSFER', 'transaction',
        transaction.rows[0].id,
        JSON.stringify({ amount, receiverEmail, status })
      ]
    )

    await client.query('COMMIT')

    logger.info('Transfer complete', { senderUserId, receiverEmail, amount, status })

    return { transaction: transaction.rows[0], duplicate: false }

  } catch (err) {
    await client.query('ROLLBACK')
    logger.error('Transfer failed', { error: err.message })
    throw err
  } finally {
    client.release()
  }
}

const getTransactionHistory = async (userId, page = 1, limit = 10) => {
  const offset = (page - 1) * limit

  const result = await pool.query(
    `SELECT t.*,
      sw.user_id as sender_user_id,
      rw.user_id as receiver_user_id
     FROM transactions t
     LEFT JOIN wallets sw ON sw.id = t.sender_wallet_id
     LEFT JOIN wallets rw ON rw.id = t.receiver_wallet_id
     WHERE sw.user_id = $1 OR rw.user_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  )

  const count = await pool.query(
    `SELECT COUNT(*) FROM transactions t
     LEFT JOIN wallets sw ON sw.id = t.sender_wallet_id
     LEFT JOIN wallets rw ON rw.id = t.receiver_wallet_id
     WHERE sw.user_id = $1 OR rw.user_id = $1`,
    [userId]
  )

  return {
    transactions: result.rows,
    total: parseInt(count.rows[0].count),
    page,
    limit,
    pages: Math.ceil(parseInt(count.rows[0].count) / limit)
  }
}

module.exports = { transferFunds, getTransactionHistory }
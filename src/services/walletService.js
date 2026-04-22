const pool = require('../db')
const logger = require('../logger')

// get wallet by user id
const getWallet = async (userId) => {
  const result = await pool.query(
    `SELECT w.*, u.name, u.email 
     FROM wallets w
     JOIN users u ON u.id = w.user_id
     WHERE w.user_id = $1`,
    [userId]
  )
  return result.rows[0]
}

// deposit money into wallet
const deposit = async (userId, amount, description = 'Deposit') => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // lock the wallet row during this transaction
    // this prevents two deposits happening at the same time
    const walletResult = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    )

    const wallet = walletResult.rows[0]

    if (!wallet) throw new Error('Wallet not found')
    if (wallet.is_locked) throw new Error('Wallet is locked')

    // update balance
    const updatedWallet = await client.query(
      `UPDATE wallets 
       SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [amount, userId]
    )

    // record transaction
    const transaction = await client.query(
      `INSERT INTO transactions 
       (receiver_wallet_id, amount, type, status, description)
       VALUES ($1, $2, 'deposit', 'completed', $3)
       RETURNING *`,
      [wallet.id, amount, description]
    )

    // audit log
    await client.query(
      `INSERT INTO audit_logs 
       (user_id, action, entity_type, entity_id, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId, 'DEPOSIT', 'wallet', wallet.id,
        JSON.stringify({ balance: wallet.balance }),
        JSON.stringify({ balance: updatedWallet.rows[0].balance })
      ]
    )

    await client.query('COMMIT')

    logger.info('Deposit successful', { userId, amount })

    return {
      transaction: transaction.rows[0],
      wallet: updatedWallet.rows[0]
    }

  } catch (err) {
    await client.query('ROLLBACK')
    logger.error('Deposit failed', { error: err.message, userId, amount })
    throw err
  } finally {
    client.release()
  }
}

// withdraw money from wallet
const withdraw = async (userId, amount, description = 'Withdrawal') => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // lock wallet row
    const walletResult = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    )

    const wallet = walletResult.rows[0]

    if (!wallet) throw new Error('Wallet not found')
    if (wallet.is_locked) throw new Error('Wallet is locked')

    // check sufficient balance
    if (parseFloat(wallet.balance) < parseFloat(amount)) {
      throw new Error('Insufficient balance')
    }

    // update balance
    const updatedWallet = await client.query(
      `UPDATE wallets
       SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [amount, userId]
    )

    // record transaction
    const transaction = await client.query(
      `INSERT INTO transactions
       (sender_wallet_id, amount, type, status, description)
       VALUES ($1, $2, 'withdrawal', 'completed', $3)
       RETURNING *`,
      [wallet.id, amount, description]
    )

    // audit log
    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_type, entity_id, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId, 'WITHDRAWAL', 'wallet', wallet.id,
        JSON.stringify({ balance: wallet.balance }),
        JSON.stringify({ balance: updatedWallet.rows[0].balance })
      ]
    )

    await client.query('COMMIT')

    logger.info('Withdrawal successful', { userId, amount })

    return {
      transaction: transaction.rows[0],
      wallet: updatedWallet.rows[0]
    }

  } catch (err) {
    await client.query('ROLLBACK')
    logger.error('Withdrawal failed', { error: err.message, userId, amount })
    throw err
  } finally {
    client.release()
  }
}

module.exports = { getWallet, deposit, withdraw }
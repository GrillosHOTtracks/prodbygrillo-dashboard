const express = require('express')
const accountManager = require('../accountManager')

const router = express.Router()
let pendingFrontendOrigin = 'http://localhost:5173'

router.get('/status', (_req, res) => {
  res.json({ authenticated: accountManager.isAuthenticated() })
})

router.get('/url', (req, res) => {
  if (req.query.origin) pendingFrontendOrigin = req.query.origin
  try {
    const url = accountManager.getAuthUrl()
    if (!url) return res.status(400).json({ error: 'No OAuth credentials found' })
    res.json({ url })
  } catch (err) {
    console.error('[AUTH URL ERROR]', err.stack || err.message)
    res.status(500).json({ error: err.message })
  }
})

router.get('/callback', async (req, res) => {
  const { code, error } = req.query
  const base = pendingFrontendOrigin
  if (error) return res.redirect(`${base}?auth=error&reason=${error}`)
  if (!code) return res.status(400).json({ error: 'No code provided' })
  try {
    await accountManager.exchangeCode(code)
    res.redirect(`${base}?auth=success`)
  } catch (err) {
    console.error('Token exchange failed:', err.message)
    res.redirect(`${base}?auth=error&reason=token_exchange`)
  }
})

router.post('/logout', (_req, res) => {
  accountManager.logout()
  res.json({ ok: true })
})

module.exports = router

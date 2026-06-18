const express = require('express')
const accountManager = require('../accountManager')
const { dashboardAuth } = require('../middleware/dashboardAuth')

const router = express.Router()

// GET /api/accounts/status
router.get('/status', (_req, res) => {
  res.json(accountManager.getStatus())
})

// POST /api/accounts/reset-quota — clear quota counters after daily 08:00 UTC reset
router.post('/reset-quota', dashboardAuth, (_req, res) => {
  accountManager.resetQuota()
  res.json({ ok: true, message: 'Quota counters cleared' })
})

module.exports = router

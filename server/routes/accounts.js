const express = require('express')
const accountManager = require('../accountManager')

const router = express.Router()

// GET /api/accounts/status — public (no auth required)
router.get('/status', (_req, res) => {
  res.json(accountManager.getStatus())
})

module.exports = router

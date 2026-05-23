const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod'

// Routes that don't require dashboard login
const BYPASS = [
  '/api/auth/dashboard-login',
  '/api/auth/callback',
  '/api/health',
]

function dashboardAuth(req, res, next) {
  // If no password configured, skip auth (dev mode / unconfigured)
  if (!process.env.DASHBOARD_PASSWORD) return next()

  // Bypass specific routes
  if (BYPASS.some(p => req.path === p || req.path.startsWith(p + '?'))) return next()

  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) return res.status(401).json({ error: 'Not logged in', code: 'NO_DASHBOARD_TOKEN' })

  try {
    jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Session expired', code: 'INVALID_DASHBOARD_TOKEN' })
  }
}

module.exports = { dashboardAuth, JWT_SECRET }

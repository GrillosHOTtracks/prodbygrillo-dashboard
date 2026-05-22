// Detects YouTube Data/Analytics API quota errors (403 quotaExceeded)
function isQuotaError(err) {
  return (err?.code === 403 || err?.status === 403) && /quota/i.test(err?.message || '')
}

// Sends a standardised error response; quota errors get 429 + code field
function sendError(res, err, label) {
  if (isQuotaError(err)) {
    console.warn(`[QUOTA] ${label}`)
    return res.status(429).json({
      error: 'YouTube API quota exceeded. Resets at 00:00 PST.',
      code: 'quotaExceeded',
    })
  }
  console.error(`${label}:`, err.message)
  res.status(500).json({ error: err.message })
}

module.exports = { isQuotaError, sendError }

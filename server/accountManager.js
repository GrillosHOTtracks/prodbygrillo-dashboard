require('dotenv').config()
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3010/api/auth/callback'

// Bootstrap credentials from env vars (production/Railway)
// Accepts raw JSON string or base64-encoded JSON
function decodeCredential(val) {
  if (!val) return null
  const trimmed = val.trim()
  // If it starts with { it's raw JSON
  if (trimmed.startsWith('{')) return trimmed
  // Otherwise treat as base64
  return Buffer.from(trimmed.replace(/\s+/g, ''), 'base64').toString('utf8')
}

function bootstrapFromEnv() {
  const creds = decodeCredential(process.env.GOOGLE_CREDENTIALS)
  if (creds) {
    try {
      JSON.parse(creds) // validate before writing
      fs.writeFileSync(path.join(os.tmpdir(), 'client_secret.json'), creds)
      console.log('[ACCOUNTS] GOOGLE_CREDENTIALS loaded OK')
    } catch (e) { console.warn('[ACCOUNTS] GOOGLE_CREDENTIALS invalid:', e.message) }
  }
  const token = decodeCredential(process.env.GOOGLE_TOKEN)
  if (token) {
    try {
      JSON.parse(token)
      fs.writeFileSync(path.join(os.tmpdir(), 'token.json'), token)
    } catch (e) { console.warn('[ACCOUNTS] Could not write GOOGLE_TOKEN:', e.message) }
  }
}
bootstrapFromEnv()
const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
]

function isQuotaErr(err) {
  if (!err) return false
  return (err?.code === 403 || err?.status === 403) && /quota/i.test(String(err?.message || ''))
}

function quotaHasReset(ts) {
  if (!ts) return true
  const now   = new Date()
  const reset = new Date()
  reset.setUTCHours(8, 0, 0, 0)
  if (reset.getTime() > now.getTime()) reset.setUTCDate(reset.getUTCDate() - 1)
  return ts < reset.getTime()
}

class AccountManager {
  constructor() {
    // OAuth account — canal principal (analytics + upload + private data)
    this.oauth = null            // { credPath, tokenPath, quotaExceededAt }

    // API keys — public YouTube Data API only (search, trending)
    this.keys        = []        // [{ n, key, quotaExceededAt }]
    this.activeKeyIdx = 0

    this._load()
  }

  _load() {
    const cwd = process.cwd()

    // Search cwd first, then /tmp (populated from env vars in production)
    const searchDirs = [cwd, os.tmpdir()]
    for (const dir of searchDirs) {
      for (const [cred, tok] of [
        ['client_secret_1.json', 'token_1.json'],
        ['client_secret.json',   'token.json'],
      ]) {
        const credPath = path.join(dir, cred)
        if (fs.existsSync(credPath)) {
          this.oauth = { credPath, tokenPath: path.join(dir, tok), quotaExceededAt: null }
          break
        }
      }
      if (this.oauth) break
    }

    // API keys from .env: YT_API_KEY_2, YT_API_KEY_3, …
    const keys = []
    for (let n = 2; n <= 20; n++) {
      const key = process.env[`YT_API_KEY_${n}`]
      if (key) keys.push({ n, key, quotaExceededAt: null })
    }
    this.keys        = keys
    this.activeKeyIdx = this._pickBestKeyIdx()
  }

  _pickBestKeyIdx() {
    for (let i = 0; i < this.keys.length; i++) {
      if (!this._isKeyQuotaActive(i)) return i
    }
    return 0
  }

  // ─── OAuth helpers ─────────────────────────────────────────────────────────

  _isOAuthAuth() {
    if (!this.oauth || !fs.existsSync(this.oauth.tokenPath)) return false
    try {
      const t = JSON.parse(fs.readFileSync(this.oauth.tokenPath))
      return !!(t.access_token || t.refresh_token)
    } catch { return false }
  }

  _isOAuthQuotaActive() {
    if (!this.oauth?.quotaExceededAt) return false
    if (quotaHasReset(this.oauth.quotaExceededAt)) { this.oauth.quotaExceededAt = null; return false }
    return true
  }

  _oauthCreds() {
    const raw = JSON.parse(fs.readFileSync(this.oauth.credPath))
    return raw.installed || raw.web
  }

  _oauthClient() {
    const { client_id, client_secret } = this._oauthCreds()
    const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI)
    if (fs.existsSync(this.oauth.tokenPath)) {
      auth.setCredentials(JSON.parse(fs.readFileSync(this.oauth.tokenPath)))
      auth.on('tokens', updated => {
        const cur = fs.existsSync(this.oauth.tokenPath)
          ? JSON.parse(fs.readFileSync(this.oauth.tokenPath))
          : {}
        const merged = { ...cur, ...updated }
        fs.writeFileSync(this.oauth.tokenPath, JSON.stringify(merged, null, 2))
        // Remind to update Railway env var so restart doesn't lose auth
        const b64 = Buffer.from(JSON.stringify(merged)).toString('base64')
        console.log('[ACCOUNTS] Token refreshed — update GOOGLE_TOKEN in Railway:')
        console.log('[ACCOUNTS] GET /api/auth/token-export for the base64 value')
        console.log('[ACCOUNTS] base64 preview:', b64.slice(0, 40) + '...')
      })
    }
    return auth
  }

  // ─── API key helpers ───────────────────────────────────────────────────────

  _isKeyQuotaActive(idx) {
    const k = this.keys[idx]
    if (!k?.quotaExceededAt) return false
    if (quotaHasReset(k.quotaExceededAt)) { k.quotaExceededAt = null; return false }
    return true
  }

  _rotateKey(excludeIdx) {
    for (let i = 1; i < this.keys.length; i++) {
      const next = (excludeIdx + i) % this.keys.length
      if (!this._isKeyQuotaActive(next)) {
        this.activeKeyIdx = next
        console.log(`[ACCOUNTS] Rotated to API key YT_API_KEY_${this.keys[next].n}`)
        return true
      }
    }
    return false
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  isAuthenticated() { return this._isOAuthAuth() }

  getAuthClient()   { return this._oauthClient() }

  getAuthUrl() {
    if (!this.oauth) return null
    const { client_id, client_secret } = this._oauthCreds()
    const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI)
    return auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' })
  }

  async exchangeCode(code) {
    if (!this.oauth) throw new Error('No OAuth credentials found')
    const { client_id, client_secret } = this._oauthCreds()
    const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI)
    const { tokens } = await auth.getToken(code)
    fs.writeFileSync(this.oauth.tokenPath, JSON.stringify(tokens, null, 2))
    return tokens
  }

  logout() {
    if (!this.oauth) return
    if (fs.existsSync(this.oauth.tokenPath)) fs.unlinkSync(this.oauth.tokenPath)
    this.oauth.quotaExceededAt = null
  }

  // OAuth-required calls: analytics, channel, upload, private data
  async withYouTube(fn) {
    if (!this._isOAuthAuth()) {
      throw Object.assign(new Error('Not authenticated'), { code: 'UNAUTHENTICATED' })
    }
    try {
      return await fn(this._oauthClient())
    } catch (err) {
      if (isQuotaErr(err)) {
        this.oauth.quotaExceededAt = Date.now()
        console.warn('[ACCOUNTS] OAuth quota exceeded')
      }
      throw err
    }
  }

  // Public-only calls: tries API keys first, falls back to OAuth account.
  // Passes either an API key string or OAuth client — googleapis accepts both as `auth`.
  async withPublicYouTube(fn) {
    if (this.keys.length > 0) {
      const tried = new Set()
      while (true) {
        const idx = this.activeKeyIdx

        // Skip quota-exceeded keys
        if (this._isKeyQuotaActive(idx)) {
          if (!this._rotateKey(idx)) break
          continue
        }
        if (tried.has(idx)) break

        tried.add(idx)
        try {
          return await fn(this.keys[idx].key)
        } catch (err) {
          if (isQuotaErr(err)) {
            this.keys[idx].quotaExceededAt = Date.now()
            console.warn(`[ACCOUNTS] API key YT_API_KEY_${this.keys[idx].n} quota exceeded`)
            if (!this._rotateKey(idx)) break
          } else {
            throw err
          }
        }
      }
    }

    // All keys exhausted (or none configured) — fall back to OAuth
    return this.withYouTube(fn)
  }

  getStatus() {
    return {
      oauth: {
        type:          'oauth',
        label:         'Canal Principal',
        authenticated: this._isOAuthAuth(),
        quotaExceeded: this._isOAuthQuotaActive(),
        hasCredFile:   !!(this.oauth),
      },
      keys: this.keys.map((k, i) => ({
        n:             k.n,
        type:          'apikey',
        label:         `YT_API_KEY_${k.n}`,
        active:        i === this.activeKeyIdx && !this._isKeyQuotaActive(i),
        quotaExceeded: this._isKeyQuotaActive(i),
        quotaExceededAt: k.quotaExceededAt || null,
      })),
    }
  }
}

module.exports = new AccountManager()

require('dotenv').config()
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3010/api/auth/callback'

function decodeCredential(val) {
  if (!val) return null
  const trimmed = val.trim()
  if (trimmed.startsWith('{')) return trimmed
  return Buffer.from(trimmed.replace(/\s+/g, ''), 'base64').toString('utf8')
}

// FIX (correction 7): removed duplicate bootstrap — only write one file pair.
// _load() first looks for client_secret_1.json / token_1.json, so we write those.
function bootstrapFromEnv() {
  const creds = decodeCredential(process.env.GOOGLE_CREDENTIALS)
  const token = decodeCredential(process.env.GOOGLE_TOKEN)

  if (creds) {
    try {
      JSON.parse(creds)
      fs.writeFileSync(path.join(os.tmpdir(), 'client_secret_1.json'), creds)
      console.log('[ACCOUNTS] client_secret_1.json loaded from env OK')
    } catch (e) { console.warn('[ACCOUNTS] GOOGLE_CREDENTIALS invalid:', e.message) }
  }

  if (token) {
    try {
      JSON.parse(token)
      fs.writeFileSync(path.join(os.tmpdir(), 'token_1.json'), token)
      console.log('[ACCOUNTS] token_1.json loaded from env OK')
    } catch (e) { console.warn('[ACCOUNTS] GOOGLE_TOKEN invalid:', e.message) }
  }
}
bootstrapFromEnv()

// ─── Quota tracking ─────────────────────────────────────────────────────────
// Costs per YouTube Data API v3 method (units)
const YT_COSTS = {
  'channels.list':          1,
  'channels.update':        50,
  'playlistItems.list':     1,
  'playlistItems.insert':   50,
  'playlistItems.delete':   50,
  'videos.list':            1,
  'videos.insert':          1600,
  'videos.update':          50,
  'videos.delete':          50,
  'videos.rate':            50,
  'commentThreads.list':    1,
  'commentThreads.insert':  50,
  'comments.list':          1,
  'comments.insert':        50,
  'comments.update':        50,
  'playlists.list':         1,
  'playlists.insert':       50,
  'playlists.update':       50,
  'subscriptions.list':     1,
  'search.list':            100,
  'captions.list':          50,
  'captions.download':      200,
}

// YouTube Analytics API costs (separate 10k quota)
const YA_COSTS = {
  'reports.query': 1,
}

// Store quota file in OS temp dir — keeps it outside the Vite-watched project tree
const QUOTA_FILE = path.join(os.tmpdir(), 'prodbygrillo_quota.json')

function _nextResetTs() {
  const now = new Date()
  const r   = new Date()
  r.setUTCHours(8, 0, 0, 0)
  if (r.getTime() <= now.getTime()) r.setUTCDate(r.getUTCDate() + 1)
  return r.getTime()
}

function _loadQuota() {
  try {
    const d = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'))
    if (d.resetAt && Date.now() >= d.resetAt) {
      return { ytUnits: 0, yaUnits: 0, ytExhausted: false, resetAt: _nextResetTs() }
    }
    return { ytUnits: d.ytUnits || 0, yaUnits: d.yaUnits || 0, ytExhausted: !!d.ytExhausted, resetAt: d.resetAt || _nextResetTs() }
  } catch {
    return { ytUnits: 0, yaUnits: 0, ytExhausted: false, resetAt: _nextResetTs() }
  }
}

function _markQuotaExhausted() {
  if (_quota.ytExhausted) return
  _quota.ytExhausted = true
  _quota.ytUnits     = 10000  // show as fully used in dashboard
  _saveQuota()
  console.warn('[QUOTA] Marked as exhausted (403 from YouTube API)')
}

let _saveTimer = null
const _quota = _loadQuota()

function _saveQuota() {
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    try { fs.writeFileSync(QUOTA_FILE, JSON.stringify(_quota, null, 2)) } catch {}
  }, 500)
}

// FIX (correction 6): only track recognised API operations — unknown method keys
// get a default cost of 1 and a warning so rogue internal patches are visible.
function _trackQuota(resource, method, isAnalytics) {
  if (Date.now() >= _quota.resetAt) {
    _quota.ytUnits     = 0
    _quota.yaUnits     = 0
    _quota.ytExhausted = false
    _quota.resetAt     = _nextResetTs()
    _saveQuota()
    console.log('[QUOTA] Daily counters reset (08:00 UTC)')
  }
  const key  = `${String(resource)}.${String(method)}`
  let cost
  if (isAnalytics) {
    cost = YA_COSTS[key]
    if (cost === undefined) {
      console.warn(`[QUOTA] Unknown Analytics method tracked: ${key} — defaulting to 1 unit`)
      cost = 1
    }
    _quota.yaUnits += cost
  } else {
    cost = YT_COSTS[key]
    if (cost === undefined) {
      console.warn(`[QUOTA] Unknown Data API method tracked: ${key} — defaulting to 1 unit`)
      cost = 1
    }
    _quota.ytUnits += cost
  }
  _saveQuota()
  console.log(`[QUOTA] ${key} +${cost} → yt:${_quota.ytUnits} ya:${_quota.yaUnits}`)
}

// Prototype patching — avoids Proxy invariant violations on non-configurable resource properties.
// We patch each resource class prototype exactly once (tracked via WeakSet).
// FIX (correction 6): only patch methods that are public API verbs (no underscore prefix,
// no constructor, no internal helpers). googleapis resource prototypes only expose real
// API operations, but the filter makes the intent explicit.
const _patchedProtos = new WeakSet()
const _API_VERB_RE   = /^[a-z]/ // all googleapis API methods start with a lowercase letter

function _patchClient(client, isAnalytics) {
  for (const [resourceName, res] of Object.entries(client)) {
    if (typeof res !== 'object' || res === null) continue
    const proto = Object.getPrototypeOf(res)
    if (!proto || proto === Object.prototype || _patchedProtos.has(proto)) continue
    _patchedProtos.add(proto)

    for (const methodName of Object.getOwnPropertyNames(proto)) {
      if (methodName === 'constructor') continue
      if (!_API_VERB_RE.test(methodName)) continue  // skip _internal or CONST style names
      const desc = Object.getOwnPropertyDescriptor(proto, methodName)
      if (!desc || typeof desc.value !== 'function') continue
      const origFn  = desc.value
      const r = resourceName, m = methodName, ia = isAnalytics
      Object.defineProperty(proto, methodName, {
        ...desc,
        configurable: true,
        value: function (...args) {
          _trackQuota(r, m, ia)
          const result = origFn.apply(this, args)
          if (result && typeof result.then === 'function') {
            return result.catch(err => {
              if ((err?.code === 403 || err?.status === 403) && /quota/i.test(err?.message || '')) {
                _markQuotaExhausted()
              }
              throw err
            })
          }
          return result
        },
      })
    }
  }
  return client
}

// Patch google.youtube and google.youtubeAnalytics globally — zero changes needed in route files
const _origYt = google.youtube.bind(google)
const _origYa = google.youtubeAnalytics.bind(google)
google.youtube          = (opts) => _patchClient(_origYt(opts), false)
google.youtubeAnalytics = (opts) => _patchClient(_origYa(opts), true)

// ─────────────────────────────────────────────────────────────────────────────

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
  'openid',
  'email',
  'profile',
]

function isQuotaErr(err) {
  if (!err) return false
  return (err?.code === 403 || err?.status === 403) && /quota/i.test(String(err?.message || ''))
}

class AccountManager {
  constructor() {
    this.oauthAccounts = []
    this.keys          = []
    this.activeKeyIdx  = 0
    this._load()
  }

  _load() {
    const cwd = process.cwd()
    const searchDirs = [cwd, os.tmpdir()]

    const candidates = [
      [1, 'client_secret_1.json', 'token_1.json'],
      [1, 'client_secret.json',   'token.json'],
    ]

    const found = new Set()
    for (const [n, credFile, tokFile] of candidates) {
      if (found.has(n)) continue
      for (const dir of searchDirs) {
        const credPath = path.join(dir, credFile)
        if (fs.existsSync(credPath)) {
          this.oauthAccounts.push({ n, credPath, tokenPath: path.join(dir, tokFile) })
          found.add(n)
          break
        }
      }
    }

    const keys = []
    for (let n = 2; n <= 20; n++) {
      const key = process.env[`YT_API_KEY_${n}`]
      if (key) keys.push({ n, key, quotaExceededAt: null })
    }
    this.keys         = keys
    this.activeKeyIdx = this._pickBestKeyIdx()

    console.log(`[ACCOUNTS] Loaded: ${this.oauthAccounts.length} OAuth account(s), ${this.keys.length} API key(s)`)
    console.log(`[QUOTA] Loaded — yt:${_quota.ytUnits} ya:${_quota.yaUnits} | resets ${new Date(_quota.resetAt).toUTCString()}`)
  }

  _acct() { return this.oauthAccounts[0] }

  _isOAuthAuth() {
    const a = this._acct()
    if (!a || !fs.existsSync(a.tokenPath)) return false
    try {
      const t = JSON.parse(fs.readFileSync(a.tokenPath))
      return !!(t.access_token || t.refresh_token)
    } catch { return false }
  }

  _oauthCreds() {
    const raw = JSON.parse(fs.readFileSync(this._acct().credPath))
    return raw.installed || raw.web
  }

  _oauthClient() {
    const a = this._acct()
    const { client_id, client_secret } = this._oauthCreds()
    const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI)
    if (fs.existsSync(a.tokenPath)) {
      auth.setCredentials(JSON.parse(fs.readFileSync(a.tokenPath)))
      auth.on('tokens', updated => {
        const cur    = fs.existsSync(a.tokenPath) ? JSON.parse(fs.readFileSync(a.tokenPath)) : {}
        const merged = { ...cur, ...updated }
        fs.writeFileSync(a.tokenPath, JSON.stringify(merged, null, 2))
        console.log('[ACCOUNTS] Token refreshed — update GOOGLE_TOKEN in Railway:')
        console.log('[ACCOUNTS] GET /api/auth/token-export for the base64 value')
      })
    }
    return auth
  }

  _pickBestKeyIdx() {
    for (let i = 0; i < this.keys.length; i++) {
      if (!this._isKeyQuotaActive(i)) return i
    }
    return 0
  }

  _isKeyQuotaActive(idx) {
    const k = this.keys[idx]
    if (!k?.quotaExceededAt) return false
    const now   = new Date()
    const reset = new Date()
    reset.setUTCHours(8, 0, 0, 0)
    if (reset.getTime() > now.getTime()) reset.setUTCDate(reset.getUTCDate() - 1)
    if (k.quotaExceededAt < reset.getTime()) { k.quotaExceededAt = null; return false }
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

  isAuthenticated() { return this._isOAuthAuth() }

  getAuthClient() {
    if (!this._isOAuthAuth()) {
      throw Object.assign(new Error('Not authenticated'), { code: 'UNAUTHENTICATED' })
    }
    return this._oauthClient()
  }

  getAuthUrl() {
    const a = this._acct()
    if (!a) return null
    const { client_id, client_secret } = this._oauthCreds()
    const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI)
    return auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'select_account consent' })
  }

  getAuthUrlWithState(origin, JWT_SECRET) {
    const a = this._acct()
    if (!a) return null
    const jwt = require('jsonwebtoken')
    const { client_id, client_secret } = this._oauthCreds()
    const auth  = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI)
    const state = jwt.sign({ origin }, JWT_SECRET, { expiresIn: '10m' })
    return auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'select_account consent', state })
  }

  async exchangeCode(code) {
    const a = this._acct()
    if (!a) throw new Error('No OAuth credentials found')
    const { client_id, client_secret } = this._oauthCreds()
    const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI)
    const { tokens } = await auth.getToken(code)
    fs.writeFileSync(a.tokenPath, JSON.stringify(tokens, null, 2))
    return tokens
  }

  logout() {
    const a = this._acct()
    if (!a) return
    if (fs.existsSync(a.tokenPath)) fs.unlinkSync(a.tokenPath)
  }

  async withYouTube(fn) {
    if (!this._isOAuthAuth()) {
      throw Object.assign(new Error('Not authenticated'), { code: 'UNAUTHENTICATED' })
    }
    return fn(this._oauthClient())
  }

  async withPrimaryYouTube(fn) {
    return this.withYouTube(fn)
  }

  // FIX (correction 2): normalised callback argument — fn always receives { type, auth }
  // where `auth` is valid as the `auth` option for google.youtube({ auth }).
  // Callers: channel.js, videos.js — both destructure { auth } from the argument.
  async withPublicYouTube(fn) {
    if (this.keys.length > 0) {
      const tried = new Set()
      while (true) {
        const idx = this.activeKeyIdx
        if (this._isKeyQuotaActive(idx)) {
          if (!this._rotateKey(idx)) break
          continue
        }
        if (tried.has(idx)) break
        tried.add(idx)
        try {
          return await fn({ type: 'apikey', auth: this.keys[idx].key })
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
    // OAuth fallback: same { type, auth } shape so callers don't need to branch
    if (!this._isOAuthAuth()) {
      throw Object.assign(new Error('Not authenticated'), { code: 'UNAUTHENTICATED' })
    }
    return fn({ type: 'oauth', auth: this._oauthClient() })
  }

  // Reset quota counters manually (e.g. after 08:00 UTC daily reset)
  resetQuota() {
    _quota.ytUnits     = 0
    _quota.yaUnits     = 0
    _quota.ytExhausted = false
    _quota.resetAt     = _nextResetTs()
    _saveQuota()
    console.log('[QUOTA] Counters reset manually')
  }

  getStatus() {
    let channelName = null, channelHandle = null, accountEmail = null
    try {
      const cacheFile = path.join(os.tmpdir(), 'channel_info.json')
      if (fs.existsSync(cacheFile)) {
        const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
        channelName   = c.name   || null
        channelHandle = c.handle || null
      }
    } catch {}
    try {
      const a = this._acct()
      if (a && fs.existsSync(a.tokenPath)) {
        const t = JSON.parse(fs.readFileSync(a.tokenPath, 'utf8'))
        if (t.id_token) {
          const payload = t.id_token.split('.')[1]
          const padded  = payload + '='.repeat((4 - payload.length % 4) % 4)
          const claims  = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
          accountEmail  = claims.email || null
        }
      }
    } catch {}

    // Check and auto-reset if past 08:00 UTC
    if (Date.now() >= _quota.resetAt) {
      _quota.ytUnits     = 0
      _quota.yaUnits     = 0
      _quota.ytExhausted = false
      _quota.resetAt     = _nextResetTs()
      _saveQuota()
    }

    return {
      oauth: {
        type:          'oauth',
        label:         'Canal Principal',
        authenticated: this._isOAuthAuth(),
        hasCredFile:   this.oauthAccounts.length > 0,
        channelName,
        channelHandle,
        accountEmail,
      },
      quota: {
        ytUnits:     _quota.ytUnits,
        ytLimit:     10000,
        yaUnits:     _quota.yaUnits,
        yaLimit:     10000,
        ytExhausted: !!_quota.ytExhausted,
        resetAt:     new Date(_quota.resetAt).toISOString(),
      },
      keys: this.keys.map((k, i) => ({
        n:               k.n,
        type:            'apikey',
        label:           `YT_API_KEY_${k.n}`,
        active:          i === this.activeKeyIdx && !this._isKeyQuotaActive(i),
        quotaExceeded:   this._isKeyQuotaActive(i),
        quotaExceededAt: k.quotaExceededAt || null,
      })),
    }
  }
}

module.exports = new AccountManager()

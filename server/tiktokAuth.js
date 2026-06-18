require('dotenv').config()
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

const DATA_DIR   = path.join(__dirname, 'data')
const TOKEN_FILE = path.join(DATA_DIR, 'tiktok_token.json')
const PKCE_FILE  = path.join(DATA_DIR, 'tiktok_pkce.json')
const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY    || ''
const CLIENT_SEC = process.env.TIKTOK_CLIENT_SECRET || ''
const REDIRECT   = 'http://localhost:3010/api/tiktok/callback'
const SCOPES     = 'user.info.basic,user.info.profile,user.info.stats,video.upload,video.publish'

fs.mkdirSync(DATA_DIR, { recursive: true })

function readToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) } catch { return null }
}
function saveToken(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2))
}

// PKCE persisted to file keyed by state — multiple in-flight auths never overwrite each other
function savePkce(state, verifier) {
  let map = {}
  try { map = JSON.parse(fs.readFileSync(PKCE_FILE, 'utf8')) } catch {}
  map[state] = { verifier, ts: Date.now() }
  // keep only the last 5 entries to prevent unbounded growth
  const keys = Object.keys(map)
  if (keys.length > 5) delete map[keys[0]]
  fs.writeFileSync(PKCE_FILE, JSON.stringify(map))
}
function loadPkce(state) {
  try {
    const map = JSON.parse(fs.readFileSync(PKCE_FILE, 'utf8'))
    return map[state] || null
  } catch { return null }
}
function clearPkce(state) {
  try {
    const map = JSON.parse(fs.readFileSync(PKCE_FILE, 'utf8'))
    delete map[state]
    fs.writeFileSync(PKCE_FILE, JSON.stringify(map))
  } catch {}
}

function getAuthUrl() {
  const state        = crypto.randomBytes(16).toString('hex')
  // base64url: 43 chars from [A-Za-z0-9_-], the standard PKCE charset
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  // TikTok uses hex encoding for S256, not base64url (diverges from RFC 7636)
  const codeChallenge = crypto
    .createHash('sha256')
    .update(Buffer.from(codeVerifier, 'ascii'))
    .digest('hex')
  savePkce(state, codeVerifier)
  console.log('[TIKTOK] auth URL generated — state:', state.slice(0,8), '| verifier:', codeVerifier.slice(0,8), '... | challenge:', codeChallenge.slice(0,8), '...')

  const params = new URLSearchParams({
    client_key:            CLIENT_KEY,
    scope:                 SCOPES,
    response_type:         'code',
    redirect_uri:          REDIRECT,
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  })
  console.log('[TIKTOK] PKCE S256/hex | challenge[:16]:', codeChallenge.slice(0,16))
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`
}

async function handleCallback(code, state) {
  const entry = loadPkce(state)
  if (!entry) throw new Error('PKCE session not found — auth may have expired or state is invalid')
  const codeVerifier = entry.verifier
  clearPkce(state)

  const bodyParams = {
    client_key:    CLIENT_KEY,
    client_secret: CLIENT_SEC,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT,
    code_verifier: codeVerifier,
  }
  console.log('[TIKTOK] token exchange — state:', state.slice(0,8), '| verifier:', codeVerifier.slice(0,8), '...(', codeVerifier.length, 'chars) | code:', code.slice(0,12), '...')
  const body = new URLSearchParams(bodyParams)
  const res  = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  const data = await res.json()
  console.log('[TIKTOK] token response HTTP', res.status, ':', JSON.stringify(data))
  if (data.error) {
    const detail = `[${data.error}] ${data.error_description || ''} (log_id: ${data.log_id || 'n/a'})`
    throw new Error(detail)
  }

  const tokenData = {
    access_token:       data.access_token,
    refresh_token:      data.refresh_token,
    open_id:            data.open_id,
    scope:              data.scope,
    expires_in:         data.expires_in,
    expires_at:         Date.now() + data.expires_in * 1000,
    refresh_expires_in: data.refresh_expires_in,
    refresh_expires_at: Date.now() + (data.refresh_expires_in || 2592000) * 1000,
    token_type:         data.token_type,
  }
  saveToken(tokenData)
  return tokenData
}

async function refreshAccessToken() {
  const t = readToken()
  if (!t?.refresh_token) throw new Error('No refresh token available')

  const body = new URLSearchParams({
    client_key:    CLIENT_KEY,
    client_secret: CLIENT_SEC,
    grant_type:    'refresh_token',
    refresh_token: t.refresh_token,
  })

  const res  = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error_description || data.error)

  const updated = {
    ...t,
    access_token:  data.access_token,
    refresh_token: data.refresh_token || t.refresh_token,
    expires_in:    data.expires_in,
    expires_at:    Date.now() + data.expires_in * 1000,
  }
  saveToken(updated)
  return updated
}

function isAuthenticated() {
  const t = readToken()
  if (!t?.access_token) return false
  if (t.expires_at && Date.now() > t.expires_at - 60000) return false
  return true
}

async function getAccessToken() {
  let t = readToken()
  if (!t?.access_token) throw new Error('TikTok not authenticated')
  if (t.expires_at && Date.now() > t.expires_at - 60000) {
    t = await refreshAccessToken()
  }
  return t.access_token
}

async function getUserInfo() {
  const token = await getAccessToken()
  const res   = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  if (data.error?.code !== 'ok') throw new Error(data.error?.message || 'Failed to get user info')
  return data.data?.user || {}
}

function getStatus() {
  const t = readToken()
  return {
    authenticated: isAuthenticated(),
    hasToken:      !!t,
    openId:        t?.open_id   || null,
    expiresAt:     t?.expires_at || null,
    scope:         t?.scope     || null,
    configured:    !!(CLIENT_KEY && CLIENT_SEC),
  }
}

function getOpenId() {
  const t = readToken()
  return t?.open_id || null
}

function logout() {
  try { fs.unlinkSync(TOKEN_FILE) } catch {}
}

module.exports = {
  getAuthUrl, handleCallback, refreshAccessToken,
  getAccessToken, getUserInfo, getStatus, isAuthenticated, logout, getOpenId,
}

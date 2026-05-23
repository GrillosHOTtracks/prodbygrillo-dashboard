const express = require('express')
const multer  = require('multer')
const os      = require('os')
const path    = require('path')
const fs      = require('fs')

const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

const router  = express.Router()
const upload  = multer({ dest: os.tmpdir(), limits: { fileSize: 500 * 1024 * 1024, fieldSize: 20 * 1024 * 1024 } })

function sse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

// POST /api/beatstars/publish
router.post('/publish', upload.single('audio'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  let browser = null
  let audioPath = null

  try {
    const meta = JSON.parse(req.body.meta || '{}')
    const { title, description, tags, bpm, key, genre, mood, thumbnail } = meta

    const email          = process.env.BEATSTARS_EMAIL
    const password       = process.env.BEATSTARS_PASSWORD
    const cookiesB64     = process.env.BEATSTARS_COOKIES

    if (!cookiesB64 && (!email || !password)) {
      sse(res, { status: 'ERROR', error: 'Configure BEATSTARS_COOKIES (preferido) ou BEATSTARS_EMAIL + BEATSTARS_PASSWORD no Railway' })
      res.write('data: [DONE]\n\n')
      return res.end()
    }

    if (!req.file) {
      sse(res, { status: 'ERROR', error: 'Arquivo de áudio obrigatório' })
      res.write('data: [DONE]\n\n')
      return res.end()
    }

    // Rename to .mp3 so BeatStars recognizes the file type
    audioPath = req.file.path + '.mp3'
    fs.renameSync(req.file.path, audioPath)

    sse(res, { status: 'LAUNCHING', message: 'Iniciando navegador...' })

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-extensions', '--disable-background-networking',
        '--window-size=1280,900',
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setDefaultNavigationTimeout(60000)
    await page.setDefaultTimeout(30000)

    // ── Login ────────────────────────────────────────────────────────────────────
    sse(res, { status: 'LOGGING_IN', message: 'Fazendo login no BeatStars...' })

    if (cookiesB64) {
      // Restore saved session cookies — bypasses login and MFA entirely
      const cookies = JSON.parse(Buffer.from(cookiesB64, 'base64').toString('utf8'))
      await page.goto('https://www.beatstars.com/', { waitUntil: 'domcontentloaded' })
      await page.setCookie(...cookies)
      console.log('[BEATSTARS] Session cookies restored:', cookies.length)

      // Verify session is still valid
      await page.goto('https://www.beatstars.com/', { waitUntil: 'networkidle2' })
      const sessionOk = await page.evaluate(() => !!(window.__bs_user || document.querySelector('[class*="userAvatar"], [class*="avatar"], [data-user-id]')))
      if (!sessionOk) {
        const currentUrl = page.url()
        if (currentUrl.includes('/login') || currentUrl.includes('oauth.beatstars.com')) {
          sse(res, { status: 'ERROR', error: 'Sessão BeatStars expirada — rode setup-beatstars-session.cjs e atualize BEATSTARS_COOKIES no Railway' })
          res.write('data: [DONE]\n\n')
          return res.end()
        }
      }
    } else {
      // Fallback: full login flow (only works if MFA is not triggered)
      await page.goto('https://www.beatstars.com/login', { waitUntil: 'networkidle2' })
      await new Promise(r => setTimeout(r, 1500))

      try {
        await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 4000 })
        await page.click('#onetrust-accept-btn-handler')
      } catch {}

      await page.waitForSelector('#oath-email', { timeout: 10000 })
      await page.click('#oath-email', { clickCount: 3 })
      await page.keyboard.type(email, { delay: 40 })
      await new Promise(r => setTimeout(r, 600))

      const continueHandle = await page.evaluateHandle(() =>
        document.querySelector('button[type="submit"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
          /continuar|continue|next/i.test(b.textContent || ''))
      )
      const continueEl = continueHandle.asElement()
      if (continueEl) { await continueEl.click() } else { await page.keyboard.press('Enter') }
      await new Promise(r => setTimeout(r, 1500))

      await page.waitForFunction(() =>
        !!(document.querySelector('#userPassword') ||
           document.querySelector('input[type="password"]') ||
           document.querySelector('input[name="password"]'))
      , { timeout: 15000 })
      await new Promise(r => setTimeout(r, 500))

      const pwHandle = await page.evaluateHandle(() =>
        document.querySelector('#userPassword') ||
        document.querySelector('input[type="password"]') ||
        document.querySelector('input[name="password"]')
      )
      const pwEl = pwHandle.asElement()
      if (!pwEl) throw new Error('Campo de senha não encontrado após passo de email')
      await pwEl.click({ clickCount: 3 })
      await page.keyboard.type(password, { delay: 40 })
      await new Promise(r => setTimeout(r, 400))

      const submitHandle = await page.evaluateHandle(() =>
        document.querySelector('button[type="submit"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
          /continuar|continue|entrar|login|sign/i.test(b.textContent || ''))
      )
      const submitEl = submitHandle.asElement()
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
        submitEl ? submitEl.click() : page.keyboard.press('Enter'),
      ])
      await new Promise(r => setTimeout(r, 2500))

      const afterLoginUrl = page.url()
      console.log('[BEATSTARS] URL after login:', afterLoginUrl)
      if (afterLoginUrl.includes('/login') || afterLoginUrl.includes('/signin')) {
        sse(res, { status: 'ERROR', error: 'Login falhou — use BEATSTARS_COOKIES (rode setup-beatstars-session.cjs)' })
        res.write('data: [DONE]\n\n')
        return res.end()
      }
    }

    // ── Navigate to Studio Tracks ────────────────────────────────────────────────
    sse(res, { status: 'NAVIGATING', message: 'Acedendo ao Studio...' })
    await page.goto('https://studio.beatstars.com/content/tracks', { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 2000))

    // Click "+ Create Track" button (blue button in page header)
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /create\s*track/i.test(b.textContent.trim()) && (b.offsetWidth || b.offsetHeight))
      if (btn) btn.click()
    })
    await new Promise(r => setTimeout(r, 2000))

    // Dismiss onboarding modal if present ("Updates that speed up your workflow")
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.trim() === 'Dismiss' && (b.offsetWidth || b.offsetHeight))
      if (btn) btn.click()
    })
    await new Promise(r => setTimeout(r, 1000))

    // ── Upload audio ─────────────────────────────────────────────────────────────
    sse(res, { status: 'UPLOADING_AUDIO', message: 'Enviando ficheiro de áudio...' })

    // File input is hidden (name="files[]"), appears after "Create Track" click
    await page.waitForFunction(
      () => document.querySelector('input[type="file"][name="files[]"]') !== null,
      { timeout: 15000 }
    )
    const fileInput = await page.$('input[type="file"][name="files[]"]')
    if (!fileInput) throw new Error('Campo de upload não encontrado — ver logs do Railway')
    await fileInput.uploadFile(audioPath)

    // Wait for navigation to new track edit page: /content/tracks/new/TK*
    sse(res, { status: 'UPLOADING_AUDIO', message: 'Aguardando processamento do áudio...' })
    await page.waitForFunction(
      () => window.location.href.includes('/tracks/new/'),
      { timeout: 60000, polling: 1000 }
    )
    console.log('[BEATSTARS] Track page:', page.url())

    // Wait for Angular Material form to fully initialize (chip inputs must exist)
    await page.waitForSelector('#title', { timeout: 15000 })
    await page.waitForSelector('#mat-mdc-chip-list-input-1', { timeout: 10000 })
    await new Promise(r => setTimeout(r, 4000))

    // ── Fill form ────────────────────────────────────────────────────────────────
    sse(res, { status: 'FILLING_FORM', message: 'Preenchendo informações do beat...' })

    const fillTitle = title || 'Type Beat - prodbygrillo'
    const fillBpm   = bpm   || 140
    const fillKey   = key   || 'Am'
    const fillTags  = tags  || 'trap, type beat, instrumental'
    const fillMood  = mood  || 'Dark'
    const fillDesc  = description || ''

    // Helper: clear all existing chips in a list, then add new ones
    async function clearChips(listSelector) {
      await page.evaluate(sel => {
        const input = document.querySelector(sel)
        if (!input) return
        const list = input.closest('mat-chip-grid, mat-chip-list, [class*="chip-list"]')
        if (!list) return
        list.querySelectorAll('mat-chip-row, mat-chip, [class*="mdc-chip"]').forEach(chip => {
          const del = chip.querySelector('[class*="chip-remove"], [aria-label*="remove" i], button')
          if (del && (del.offsetWidth || del.offsetHeight)) del.click()
        })
      }, listSelector)
      await new Promise(r => setTimeout(r, 600))
    }

    // Helper: type into chip input and press Enter (no autocomplete)
    async function chipEnter(selector, text) {
      const el = await page.$(selector)
      if (!el) return
      await el.click()
      await page.keyboard.type(text, { delay: 30 })
      await page.keyboard.press('Enter')
      await new Promise(r => setTimeout(r, 400))
    }

    // Helper: type into autocomplete chip, wait for dropdown, click first option
    async function chipAutocomplete(selector, text) {
      const el = await page.$(selector)
      if (!el) return
      await el.click()
      await page.keyboard.type(text, { delay: 30 })
      await new Promise(r => setTimeout(r, 1000))
      const picked = await page.evaluate(() => {
        const opt = document.querySelector('mat-option:not([aria-disabled="true"]), [role="option"]:not([aria-disabled="true"])')
        if (opt && (opt.offsetWidth || opt.offsetHeight)) { opt.click(); return true }
        return false
      })
      if (!picked) await page.keyboard.press('Escape')
      await new Promise(r => setTimeout(r, 500))
    }

    // Title
    await page.click('#title', { clickCount: 3 })
    await page.keyboard.down('Control')
    await page.keyboard.press('a')
    await page.keyboard.up('Control')
    await page.keyboard.type(fillTitle, { delay: 25 })
    await page.evaluate(() => {
      const el = document.querySelector('#title')
      if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }
    })
    await new Promise(r => setTimeout(r, 400))
    console.log('[BEATSTARS] Title filled:', fillTitle)

    // Description
    if (fillDesc) {
      try {
        const textarea = await page.$('textarea')
        if (textarea) {
          await textarea.click({ clickCount: 3 })
          await page.keyboard.type(fillDesc, { delay: 3 })
          await new Promise(r => setTimeout(r, 400))
        }
      } catch {}
    }

    // BPM
    try {
      const bpmEl = await page.$('input[type="number"]')
      if (bpmEl) {
        await bpmEl.click({ clickCount: 3 })
        await page.keyboard.type(String(fillBpm), { delay: 25 })
        await page.evaluate(() => {
          const el = document.querySelector('input[type="number"]')
          if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }
        })
        await page.keyboard.press('Tab')
        await new Promise(r => setTimeout(r, 300))
      }
    } catch {}

    // Key — native <select>, Angular needs change+input events
    try {
      const selects = await page.$$('select')
      if (selects[0]) {
        await page.evaluate((el, k) => {
          const norm = s => s.replace(/♭/g, 'b').replace(/♯/g, '#').toLowerCase().trim()
          const kn   = norm(k)
          const opt  = Array.from(el.options).find(o =>
            norm(o.text) === kn || norm(o.value) === kn || norm(o.text).startsWith(kn)
          )
          if (opt) {
            el.value = opt.value
            el.dispatchEvent(new Event('change', { bubbles: true }))
            el.dispatchEvent(new Event('input',  { bubbles: true }))
          }
        }, selects[0], fillKey)
        await new Promise(r => setTimeout(r, 400))
      }
    } catch {}

    // Tags — clear BeatStars auto-tags first, then add ours (max 3)
    try {
      await clearChips('#mat-mdc-chip-list-input-1')
      const tagList = fillTags.split(/\s*,\s*/).filter(Boolean).slice(0, 3)
      for (const tag of tagList) {
        await chipEnter('#mat-mdc-chip-list-input-1', tag)
      }
    } catch {}

    // Mood
    try {
      await clearChips('#mat-mdc-chip-list-input-2')
      await chipAutocomplete('#mat-mdc-chip-list-input-2', fillMood)
    } catch {}

    // Thumbnail
    if (thumbnail && thumbnail.startsWith('data:image')) {
      try {
        const thumbPath = path.join(os.tmpdir(), `bs_thumb_${Date.now()}.jpg`)
        fs.writeFileSync(thumbPath, Buffer.from(thumbnail.split(',')[1], 'base64'))
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            /^edit$/i.test(b.textContent.trim()) && (b.offsetWidth || b.offsetHeight))
          if (btn) btn.click()
        })
        await new Promise(r => setTimeout(r, 1000))
        const imgInput = await page.$('input[type="file"][accept*="image"]')
        if (imgInput) await imgInput.uploadFile(thumbPath)
        await new Promise(r => setTimeout(r, 500))
        fs.unlinkSync(thumbPath)
      } catch {}
    }

    // Final pause — let Angular sync before publish
    await new Promise(r => setTimeout(r, 3000))

    // ── Publish ───────────────────────────────────────────────────────────────────
    sse(res, { status: 'PUBLISHING', message: 'Publicando beat...' })

    const publishBtn = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('button')).find(b =>
        /publish\s*track/i.test(b.textContent.trim()) && (b.offsetWidth || b.offsetHeight) && !b.disabled)
    )
    const publishEl = publishBtn.asElement()
    if (!publishEl) throw new Error('Botão "Publish track" não encontrado — verifique se o formulário carregou corretamente')
    await publishEl.click()

    await new Promise(r => setTimeout(r, 5000))
    const finalUrl = page.url()
    console.log('[BEATSTARS] Final URL:', finalUrl)

    sse(res, { status: 'DONE', url: finalUrl, message: 'Beat publicado no BeatStars!' })

  } catch (err) {
    console.error('[BEATSTARS]', err.message)
    sse(res, { status: 'ERROR', error: err.message })
  } finally {
    if (browser) { try { await browser.close() } catch {} }
    if (audioPath) { try { fs.unlinkSync(audioPath) } catch {} }
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

module.exports = router

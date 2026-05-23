const express = require('express')
const multer  = require('multer')
const os      = require('os')
const path    = require('path')
const fs      = require('fs')

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

    const puppeteer = require('puppeteer-extra')
    const StealthPlugin = require('puppeteer-extra-plugin-stealth')
    puppeteer.use(StealthPlugin())
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
      // Must navigate first so cookies can be set on correct origin
      await page.goto('https://www.beatstars.com/', { waitUntil: 'domcontentloaded' })
      await page.setCookie(...cookies)
      console.log('[BEATSTARS] Session cookies restored:', cookies.length)
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
    await new Promise(r => setTimeout(r, 2000))
    console.log('[BEATSTARS] Track page:', page.url())

    // ── Fill form ────────────────────────────────────────────────────────────────
    sse(res, { status: 'FILLING_FORM', message: 'Preenchendo informações do beat...' })

    // Title — input#title
    if (title) {
      try {
        await page.waitForSelector('#title', { timeout: 8000 })
        await page.click('#title', { clickCount: 3 })
        await page.keyboard.type(title, { delay: 20 })
      } catch {}
    }

    // Description — textarea
    if (description) {
      try {
        await page.click('textarea', { clickCount: 3 })
        await page.keyboard.type(description.slice(0, 500), { delay: 5 })
      } catch {}
    }

    // BPM — input[type="number"]
    if (bpm) {
      try {
        await page.waitForSelector('input[type="number"]', { timeout: 5000 })
        await page.click('input[type="number"]', { clickCount: 3 })
        await page.keyboard.type(String(bpm), { delay: 20 })
      } catch {}
    }

    // Key — first select on the page (confirmed: select for Key with option "None")
    if (key) {
      try {
        const selects = await page.$$('select')
        if (selects[0]) {
          await page.evaluate((el, k) => {
            const opt = Array.from(el.options).find(o =>
              o.text.toLowerCase().includes(k.toLowerCase()) || o.value.toLowerCase().includes(k.toLowerCase()))
            if (opt) el.value = opt.value
          }, selects[0], key)
        }
      } catch {}
    }

    // Tags — chip input (mat-mdc-chip-list-input-1), type tag + Enter for each
    if (tags) {
      try {
        const tagInput = await page.$('#mat-mdc-chip-list-input-1')
        if (tagInput) {
          const tagList = tags.split(/[,\s]+/).filter(Boolean).slice(0, 3)
          for (const tag of tagList) {
            await tagInput.click()
            await page.keyboard.type(tag, { delay: 20 })
            await page.keyboard.press('Enter')
            await new Promise(r => setTimeout(r, 300))
          }
        }
      } catch {}
    }

    // Genre — chip input (mat-mdc-chip-list-input-0)
    if (genre) {
      try {
        const genreInput = await page.$('#mat-mdc-chip-list-input-0')
        if (genreInput) {
          await genreInput.click()
          await page.keyboard.type(genre, { delay: 20 })
          await new Promise(r => setTimeout(r, 500))
          // Select first autocomplete option
          await page.evaluate(() => {
            const opt = document.querySelector('mat-option, .mat-option, [role="option"]')
            if (opt) opt.click()
          })
          await new Promise(r => setTimeout(r, 300))
        }
      } catch {}
    }

    // Mood — chip input (mat-mdc-chip-list-input-2)
    if (mood) {
      try {
        const moodInput = await page.$('#mat-mdc-chip-list-input-2')
        if (moodInput) {
          await moodInput.click()
          await page.keyboard.type(mood, { delay: 20 })
          await new Promise(r => setTimeout(r, 500))
          await page.evaluate(() => {
            const opt = document.querySelector('mat-option, .mat-option, [role="option"]')
            if (opt) opt.click()
          })
          await new Promise(r => setTimeout(r, 300))
        }
      } catch {}
    }

    // Thumbnail — "Edit" button on artwork, then upload image file input
    if (thumbnail && thumbnail.startsWith('data:image')) {
      try {
        const thumbPath = path.join(os.tmpdir(), `bs_thumb_${Date.now()}.jpg`)
        fs.writeFileSync(thumbPath, Buffer.from(thumbnail.split(',')[1], 'base64'))
        // Click the artwork "Edit" button to reveal the image file input
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            /^edit$/i.test(b.textContent.trim()))
          if (btn) btn.click()
        })
        await new Promise(r => setTimeout(r, 1000))
        const imgInput = await page.$('input[type="file"][accept*="image"]')
        if (imgInput) await imgInput.uploadFile(thumbPath)
        fs.unlinkSync(thumbPath)
      } catch {}
    }

    // ── Publish ───────────────────────────────────────────────────────────────────
    sse(res, { status: 'PUBLISHING', message: 'Publicando beat...' })

    // "Publish track" is the blue button in the right panel
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /publish\s*track/i.test(b.textContent.trim()) && (b.offsetWidth || b.offsetHeight))
      if (btn) btn.click()
    })

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

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
    const {
      title, description, tags, bpm, key, genre, mood,
      prices = {}, thumbnail,
    } = meta

    const email    = process.env.BEATSTARS_EMAIL
    const password = process.env.BEATSTARS_PASSWORD

    if (!email || !password) {
      sse(res, { status: 'ERROR', error: 'BEATSTARS_EMAIL e BEATSTARS_PASSWORD não configurados no Railway' })
      res.write('data: [DONE]\n\n')
      return res.end()
    }

    if (!req.file) {
      sse(res, { status: 'ERROR', error: 'Arquivo de áudio obrigatório' })
      res.write('data: [DONE]\n\n')
      return res.end()
    }

    audioPath = req.file.path
    // Rename to .mp3 so BeatStars recognizes the file type
    const namedPath = audioPath + '.mp3'
    fs.renameSync(audioPath, namedPath)
    audioPath = namedPath

    sse(res, { status: 'LAUNCHING', message: 'Iniciando navegador...' })

    const puppeteer = require('puppeteer')
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_BIN ||
      '/usr/bin/chromium-browser'
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--window-size=1280,900',
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    await page.setDefaultNavigationTimeout(60000)
    await page.setDefaultTimeout(30000)

    // ── Login ────────────────────────────────────────────────────────────────
    sse(res, { status: 'LOGGING_IN', message: 'Fazendo login no BeatStars...' })
    await page.goto('https://www.beatstars.com/login', { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 1500))

    // Accept cookies / consent dialogs
    try {
      await page.waitForSelector(
        '#onetrust-accept-btn-handler, .cookie-accept, [data-testid="accept-cookies"]',
        { timeout: 4000 }
      )
      await page.click('#onetrust-accept-btn-handler, .cookie-accept, [data-testid="accept-cookies"]')
    } catch {}

    // Log ALL inputs on the page so we can see the real selectors in Railway logs
    async function dumpInputs(label) {
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input')).map(el => ({
          type: el.type, name: el.name, id: el.id,
          placeholder: el.placeholder, autocomplete: el.autocomplete,
          'aria-label': el.getAttribute('aria-label'),
          visible: !!(el.offsetWidth || el.offsetHeight),
          classes: el.className.slice(0, 80),
        }))
      )
      console.log(`[BEATSTARS] ${label} — inputs:`, JSON.stringify(inputs))
      return inputs
    }

    // Fill email using page.evaluate (works regardless of framework)
    async function fillInput(finder, value) {
      return page.evaluate(({ finder, value }) => {
        const inputs = Array.from(document.querySelectorAll('input'))
        const el = inputs.find(i =>
          i.type === finder ||
          (i.name || '').toLowerCase().includes(finder) ||
          (i.placeholder || '').toLowerCase().includes(finder) ||
          (i.autocomplete || '').toLowerCase().includes(finder) ||
          (i.getAttribute('aria-label') || '').toLowerCase().includes(finder) ||
          (i.id || '').toLowerCase().includes(finder)
        )
        if (!el) return false
        el.focus()
        // React-compatible value set
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (setter) setter.call(el, value)
        el.dispatchEvent(new Event('input',  { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, { finder, value })
    }

    await dumpInputs('initial page')

    // BeatStars uses AngularJS — must use real keystrokes (keyboard.type) so
    // Angular's $watch picks up the value. Selectors confirmed from live logs:
    //   email:    #oath-email
    //   password: #userPassword

    // Fill email — keyboard.type() so AngularJS $watch fires
    await page.waitForSelector('#oath-email', { timeout: 10000 })
    await page.click('#oath-email', { clickCount: 3 })
    await page.keyboard.type(email, { delay: 40 })
    await new Promise(r => setTimeout(r, 500))

    // Click the Continue button (Enter alone doesn't advance the email step)
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]') ||
                  Array.from(document.querySelectorAll('button')).find(b =>
                    /continue|next|login|sign\s*in|entrar/i.test(b.textContent || '')
                  )
      if (btn) btn.click()
    })
    await new Promise(r => setTimeout(r, 1000))

    // Wait for password field (confirmed ID from live logs: #userPassword)
    await page.waitForSelector('#userPassword', { timeout: 15000 })
    await dumpInputs('after email submit')
    await new Promise(r => setTimeout(r, 500))

    // Fill password with real keystrokes so AngularJS $watch updates the model
    await page.click('#userPassword', { clickCount: 3 })
    await page.keyboard.type(password, { delay: 40 })
    await new Promise(r => setTimeout(r, 400))

    // Submit
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]') ||
                    Array.from(document.querySelectorAll('button')).find(b =>
                      /login|sign\s*in|entrar|continue/i.test(b.textContent || '')
                    )
        if (btn) btn.click()
        else document.querySelector('#userPassword')?.closest('form')?.submit()
      }),
    ])

    await new Promise(r => setTimeout(r, 2500))

    // Verify login
    const afterLoginUrl = page.url()
    console.log('[BEATSTARS] URL after login:', afterLoginUrl)
    if (afterLoginUrl.includes('/login') || afterLoginUrl.includes('/signin')) {
      await dumpInputs('still on login page')
      sse(res, { status: 'ERROR', error: 'Login falhou — credenciais incorretas ou BeatStars bloqueou o acesso' })
      res.write('data: [DONE]\n\n')
      return res.end()
    }

    sse(res, { status: 'NAVIGATING', message: 'Acedendo ao painel de upload...' })

    // Navigate to upload page
    await page.goto('https://www.beatstars.com/studio/tracks/new', { waitUntil: 'networkidle2' })

    // Fallback: try alternate upload URL if above fails
    if (!page.url().includes('studio') && !page.url().includes('upload') && !page.url().includes('new')) {
      await page.goto('https://www.beatstars.com/upload', { waitUntil: 'networkidle2' })
    }

    // ── Upload audio ─────────────────────────────────────────────────────────
    sse(res, { status: 'UPLOADING_AUDIO', message: 'Enviando ficheiro de áudio...' })

    // Wait for file input (may be hidden)
    await page.waitForSelector('input[type="file"]', { timeout: 20000 })
    const fileInput = await page.$('input[type="file"]')
    if (!fileInput) throw new Error('Campo de upload não encontrado na página do BeatStars')
    await fileInput.uploadFile(audioPath)

    // Wait for upload progress to complete
    sse(res, { status: 'UPLOADING_AUDIO', message: 'Aguardando processamento do áudio...' })
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.upload-progress, [class*="progress"], [data-testid="upload-progress"]')
        if (!el) return true  // no progress bar = probably done
        const text = el.textContent || ''
        return text.includes('100') || text.includes('complete') || text.includes('done')
      },
      { timeout: 120000, polling: 2000 }
    )

    // ── Fill form fields ──────────────────────────────────────────────────────
    sse(res, { status: 'FILLING_FORM', message: 'Preenchendo informações do beat...' })

    // Title
    if (title) {
      const titleSel = 'input[name="title"], input[placeholder*="title" i], input[placeholder*="título" i], [data-testid="beat-title"] input'
      try {
        await page.waitForSelector(titleSel, { timeout: 10000 })
        await page.click(titleSel, { clickCount: 3 })
        await page.type(titleSel, title, { delay: 30 })
      } catch {}
    }

    // BPM
    if (bpm) {
      const bpmSel = 'input[name="bpm"], input[placeholder*="BPM" i], [data-testid="bpm"] input'
      try {
        await page.waitForSelector(bpmSel, { timeout: 5000 })
        await page.click(bpmSel, { clickCount: 3 })
        await page.type(bpmSel, String(bpm), { delay: 30 })
      } catch {}
    }

    // Key
    if (key) {
      const keySel = 'select[name="key"], select[name="musical_key"], [data-testid="key"] select'
      try {
        await page.waitForSelector(keySel, { timeout: 5000 })
        await page.select(keySel, key)
      } catch {}
    }

    // Genre
    if (genre) {
      const genreSel = 'select[name="genre"], select[name="genre_id"], [data-testid="genre"] select'
      try {
        await page.waitForSelector(genreSel, { timeout: 5000 })
        // Try matching by visible text
        await page.evaluate((sel, g) => {
          const el = document.querySelector(sel)
          if (!el) return
          const opt = Array.from(el.options).find(o => o.text.toLowerCase().includes(g.toLowerCase()))
          if (opt) el.value = opt.value
        }, genreSel, genre)
      } catch {}
    }

    // Mood
    if (mood) {
      const moodSel = 'select[name="mood"], [data-testid="mood"] select'
      try {
        await page.waitForSelector(moodSel, { timeout: 5000 })
        await page.evaluate((sel, m) => {
          const el = document.querySelector(sel)
          if (!el) return
          const opt = Array.from(el.options).find(o => o.text.toLowerCase().includes(m.toLowerCase()))
          if (opt) el.value = opt.value
        }, moodSel, mood)
      } catch {}
    }

    // Tags
    if (tags) {
      const tagSel = 'input[name="tags"], textarea[name="tags"], input[placeholder*="tag" i]'
      try {
        await page.waitForSelector(tagSel, { timeout: 5000 })
        await page.type(tagSel, tags, { delay: 20 })
      } catch {}
    }

    // Description
    if (description) {
      const descSel = 'textarea[name="description"], textarea[placeholder*="description" i], [data-testid="description"] textarea'
      try {
        await page.waitForSelector(descSel, { timeout: 5000 })
        await page.click(descSel, { clickCount: 3 })
        await page.type(descSel, description.slice(0, 5000), { delay: 5 })
      } catch {}
    }

    // ── Prices ────────────────────────────────────────────────────────────────
    sse(res, { status: 'SETTING_PRICES', message: 'Configurando preços...' })

    const mp3Price = prices.mp3 ?? 24.99
    const wavPrice = prices.wav ?? 34.99
    const excPrice = prices.exclusive ?? 199.99

    // MP3 lease price
    try {
      const mp3Sel = 'input[name="mp3_price"], input[data-license="mp3"], [data-testid="mp3-price"] input'
      await page.waitForSelector(mp3Sel, { timeout: 8000 })
      await page.click(mp3Sel, { clickCount: 3 })
      await page.type(mp3Sel, String(mp3Price), { delay: 30 })
    } catch {}

    // WAV lease price
    try {
      const wavSel = 'input[name="wav_price"], input[data-license="wav"], [data-testid="wav-price"] input'
      await page.waitForSelector(wavSel, { timeout: 5000 })
      await page.click(wavSel, { clickCount: 3 })
      await page.type(wavSel, String(wavPrice), { delay: 30 })
    } catch {}

    // Exclusive price
    try {
      const excSel = 'input[name="exclusive_price"], input[data-license="exclusive"], [data-testid="exclusive-price"] input'
      await page.waitForSelector(excSel, { timeout: 5000 })
      await page.click(excSel, { clickCount: 3 })
      await page.type(excSel, String(excPrice), { delay: 30 })
    } catch {}

    // ── Thumbnail ─────────────────────────────────────────────────────────────
    if (thumbnail && thumbnail.startsWith('data:image')) {
      try {
        // Save data URL to temp file
        const thumbPath = path.join(os.tmpdir(), `bs_thumb_${Date.now()}.jpg`)
        const base64 = thumbnail.split(',')[1]
        fs.writeFileSync(thumbPath, Buffer.from(base64, 'base64'))
        const thumbInput = await page.$('input[type="file"][accept*="image"], input[data-testid="cover-art"]')
        if (thumbInput) await thumbInput.uploadFile(thumbPath)
        fs.unlinkSync(thumbPath)
      } catch {}
    }

    // ── Publish ───────────────────────────────────────────────────────────────
    sse(res, { status: 'PUBLISHING', message: 'Publicando beat...' })

    // Look for a publish/save/submit button
    const publishSel = [
      'button[type="submit"]',
      'button[data-testid="publish"]',
      'button[data-testid="save"]',
      '.btn-publish',
      '.publish-button',
      'button.primary',
    ].join(', ')

    await page.waitForSelector(publishSel, { timeout: 10000 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      page.click(publishSel),
    ])

    // Try to get the beat URL from the current page
    const finalUrl = page.url()

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

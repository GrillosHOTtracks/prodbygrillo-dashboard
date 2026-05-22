const express = require('express')
const { google } = require('googleapis')
const accountManager = require('../accountManager')
const { isQuotaError, sendError } = require('../apiError')

const router = express.Router()

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

let _cache = null

// GET /api/audience
router.get('/', async (req, res) => {
  try {
    const days   = { '7d': 7, '28d': 28, '90d': 90, '365d': 365 }[req.query.range || '28d'] || 28
    const result = await accountManager.withYouTube(async (auth) => {
      const ya        = google.youtubeAnalytics({ version: 'v2', auth })
      const startDate = daysAgo(days)
      const endDate   = daysAgo(0)

      const settled = await Promise.allSettled([
        ya.reports.query({ ids: 'channel==MINE', startDate, endDate, metrics: 'viewerPercentage', dimensions: 'ageGroup,gender' }),
        ya.reports.query({ ids: 'channel==MINE', startDate, endDate, metrics: 'views', dimensions: 'country',    sort: '-views', maxResults: 10 }),
        ya.reports.query({ ids: 'channel==MINE', startDate, endDate, metrics: 'views', dimensions: 'deviceType', sort: '-views' }),
        ya.reports.query({ ids: 'channel==MINE', startDate, endDate, metrics: 'views', dimensions: 'subscribedStatus' }),
      ])

      // Rethrow quota errors so withYouTube can rotate to the next account
      const quotaHit = settled.find(r => r.status === 'rejected' && isQuotaError(r.reason))
      if (quotaHit) throw quotaHit.reason

      const [ageGenderRes, countryRes, deviceRes, viewerTypeRes] = settled

      // Age / gender
      const ageGroups = {}
      if (ageGenderRes.status === 'fulfilled') {
        for (const row of ageGenderRes.value.data.rows || []) {
          const label  = row[0].replace('age', '')
          const gender = row[1]
          const pct    = parseFloat((row[2] || 0).toFixed(1))
          if (!ageGroups[label]) ageGroups[label] = { range: label, male: 0, female: 0, other: 0 }
          if (gender === 'male')        ageGroups[label].male   = pct
          else if (gender === 'female') ageGroups[label].female = pct
          else                          ageGroups[label].other  = pct
        }
      }
      const audienceAge = Object.values(ageGroups).sort((a, b) => {
        const n = s => parseInt(s.range.split('-')[0].replace('+', ''))
        return n(a) - n(b)
      })

      // Countries
      const COUNTRY_NAMES = {
        BR:'Brasil',US:'Estados Unidos',GB:'Reino Unido',MX:'México',AR:'Argentina',
        CO:'Colômbia',PT:'Portugal',ES:'Espanha',CA:'Canadá',AU:'Austrália',
        DE:'Alemanha',FR:'França',IT:'Itália',JP:'Japão',NG:'Nigéria',GH:'Gana',
        ZA:'África do Sul',IN:'Índia',TR:'Turquia',RU:'Rússia',PL:'Polônia',
        NL:'Holanda',SE:'Suécia',NO:'Noruega',DK:'Dinamarca',CL:'Chile',
        PE:'Peru',VE:'Venezuela',BO:'Bolívia',UY:'Uruguai',PY:'Paraguai',
        EC:'Equador',DO:'Rep. Dominicana',PR:'Porto Rico',CR:'Costa Rica',
        SV:'El Salvador',GT:'Guatemala',HN:'Honduras',NI:'Nicarágua',PA:'Panamá',
        CU:'Cuba',JM:'Jamaica',TT:'Trinidad e Tobago',HT:'Haiti',
        AO:'Angola',MZ:'Moçambique',CV:'Cabo Verde',ST:'São Tomé e Príncipe',
        KE:'Quênia',TZ:'Tanzânia',ET:'Etiópia',EG:'Egito',MA:'Marrocos',
        SN:'Senegal',CI:'Costa do Marfim',CM:'Camarões',
      }
      const countries = []
      if (countryRes.status === 'fulfilled') {
        const rows       = countryRes.value.data.rows || []
        const totalViews = rows.reduce((s, r) => s + r[1], 0)
        for (const row of rows) {
          countries.push({ code: row[0], name: COUNTRY_NAMES[row[0]] || row[0], views: row[1], percentage: parseFloat(((row[1] / totalViews) * 100).toFixed(1)) })
        }
      }

      // Devices
      const deviceLabels = {
        MOBILE:       'Mobile',
        MOBILE_PHONE: 'Mobile',
        TABLET:       'Tablet',
        DESKTOP:      'Desktop',
        TV:           'Smart TV',
        GAME_CONSOLE: 'Console',
        UNKNOWN_PLATFORM: 'Other',
      }
      const devices = []
      if (deviceRes.status === 'fulfilled') {
        const rows  = deviceRes.value.data.rows || []
        const total = rows.reduce((s, r) => s + r[1], 0)
        for (const row of rows) {
          devices.push({ label: deviceLabels[row[0]] || row[0], value: Math.round((row[1] / total) * 100) })
        }
      }

      // Subscriber ratio
      let subscriberRatio = null
      if (viewerTypeRes.status === 'fulfilled') {
        const rows = viewerTypeRes.value.data.rows || []
        if (rows.length > 0) {
          const total = rows.reduce((s, r) => s + r[1], 0)
          const sub   = { subscribed: 0, unsubscribed: 0 }
          for (const row of rows) {
            if (row[0] === 'SUBSCRIBED') sub.subscribed   = Math.round((row[1] / total) * 100)
            else                         sub.unsubscribed = Math.round((row[1] / total) * 100)
          }
          subscriberRatio = sub
        }
      }

      return { audienceAge, countries, devices, subscriberRatio }
    })
    _cache = { ...result, _cachedAt: new Date().toISOString() }
    res.json(result)
  } catch (err) {
    if (isQuotaError(err) && _cache) return res.json({ ..._cache, _cached: true })
    sendError(res, err, 'audience route')
  }
})

module.exports = router

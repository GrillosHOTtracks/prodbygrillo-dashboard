# prodbygrillo-dashboard — Contexto Completo

## O que é
Dashboard de analytics do YouTube do Prodbygrillo. Mostra dados do canal em tempo real — views, inscritos, receita, tendências, análise de beats por IA.

**Repo:** https://github.com/GrillosHOTtracks/prodbygrillo-dashboard

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 19 + TypeScript + Vite + Recharts + Tailwind v4 |
| Backend | Express 5 (CommonJS), porta 3010 |
| Deploy | Railway (nixpacks) |
| Process manager local | PM2 |
| IA | Groq SDK — llama-3.3-70b-versatile |
| YouTube (privado) | YouTube Analytics API v2 + Data API v3 (OAuth) |
| YouTube (público) | Innertube (zero quota) + RSS Feed (zero quota) |
| Instagram | Meta Graph API v19.0 (Reels publishing) |

---

## Arquitetura de dados

```
YouTube Analytics API (OAuth) → views, watch time, CTR, revenue, traffic sources
YouTube Data API v3 (API keys) → lista de vídeos públicos (2 unidades/req)
Innertube (zero quota)         → trending, channel info de fallback
RSS Feed do YouTube            → fallback de vídeos quando quota cai
```

---

## Estrutura de ficheiros relevantes

```
prodbygrillo-dashboard/
├── server/
│   ├── index.js              # Express app, middlewares, seed de channel cache
│   ├── accountManager.js     # Singleton de autenticação — withYouTube / withPublicYouTube
│   ├── apiError.js           # isQuotaError / sendError helpers
│   ├── lib/
│   │   └── innertube.js      # search(), channelInfo(), channelFeed()
│   └── routes/
│       ├── analytics.js      # GET /api/analytics, /traffic, /revenue-monthly
│       ├── videos.js         # GET /api/videos (Data API → RSS fallback)
│       ├── trending.js       # GET /api/trending (Innertube, 3 queries, 1h cache)
│       ├── channel.js        # GET /api/channel
│       ├── audience.js       # GET /api/audience
│       ├── ai.js             # POST /api/ai/analyze-beat (SSE, Groq)
│       ├── upload.js         # POST /api/upload (SSE, YouTube upload) + GET /tmp/:filename
│       ├── instagram.js      # Auth + POST /api/instagram/upload (SSE, Reels)
│       ├── auth.js           # OAuth flow
│       └── accounts.js       # Status dos accounts
├── src/
│   ├── pages/
│   │   ├── Overview.tsx
│   │   ├── Analytics.tsx
│   │   ├── Videos.tsx
│   │   ├── Audience.tsx
│   │   ├── Revenue.tsx
│   │   ├── Scheduler.tsx     # Thumbnail builder + upload + análise IA
│   │   └── Settings.tsx
│   └── components/
│       ├── Header.tsx
│       ├── Sidebar.tsx
│       ├── StatCard.tsx
│       ├── VideoTable.tsx
│       └── scheduler/        # Componentes do Scheduler
└── CONTEXT.md                # este ficheiro
```

---

## accountManager.js — como funciona

Singleton central. Regras de uso:
- **Nunca** chamar `getAuthClient()` diretamente em rotas novas
- Usar sempre `withYouTube(fn)` para dados privados/OAuth
- Usar `withPublicYouTube(fn)` para dados públicos — tenta API keys primeiro, OAuth como fallback

```js
// Dados privados (analytics, upload)
await accountManager.withYouTube(async (auth) => {
  const ya = google.youtubeAnalytics({ version: 'v2', auth })
  // ...
})

// Dados públicos (videos.list, playlistItems)
await accountManager.withPublicYouTube(async (auth) => {
  const yt = google.youtube({ version: 'v3', auth })
  // ...
})
```

**Rotação de API keys:** `YT_API_KEY_2`, `YT_API_KEY_3`, ... (env vars). Em quota exceeded, roda automático para a próxima.

---

## Credenciais

| Ficheiro | Uso |
|----------|-----|
| `client_secret_1.json` | OAuth credentials (GCP) |
| `token_1.json` | OAuth token salvo |
| `.env` → `GROQ_API_KEY` | Groq (IA) |
| `.env` → `YT_API_KEY_2..N` | API keys públicas (projetos GCP separados!) |
| `.env` → `GOOGLE_CREDENTIALS` | Para Railway: JSON base64 ou raw do client_secret |
| `.env` → `GOOGLE_TOKEN` | Para Railway: token OAuth (evita perda no restart) |
| `.env` → `CHANNEL_ID` | Seed do cache de canal no cold start |
| `.env` → `META_APP_ID` | Meta app ID (developers.facebook.com) |
| `.env` → `META_APP_SECRET` | Meta app secret |
| `.env` → `META_REDIRECT_URI` | OAuth callback URL (ex: https://…/api/instagram/auth/callback) |
| `.env` → `META_ACCESS_TOKEN` | Long-lived token (60 dias) — Railway env var para persistência |
| `.env` → `INSTAGRAM_ACCOUNT_ID` | Instagram Business Account ID |
| `.env` → `PUBLIC_URL` | URL pública do Railway (para Instagram buscar vídeos) |

---

## Endpoints e status

| Rota | Fonte | Status |
|------|-------|--------|
| `GET /api/analytics?range=28d` | YouTube Analytics API | ✅ |
| `GET /api/analytics/traffic` | YouTube Analytics API | ✅ |
| `GET /api/analytics/revenue-monthly` | YouTube Analytics API | ✅ |
| `GET /api/channel` | Data API + Innertube fallback | ✅ |
| `GET /api/videos` | playlistItems (2u) + RSS fallback | ✅ |
| `GET /api/trending` | Innertube (zero quota) | ✅ |
| `GET /api/audience` | YouTube Analytics API | ✅ parcial |
| `POST /api/ai/analyze-beat` | Groq llama-3.3-70b (SSE) | ✅ |
| `POST /api/upload/video` | YouTube Data API (SSE) | ✅ |
| `GET /api/upload/tmp/:filename` | Serve temp video para APIs externas | ✅ |
| `GET /api/upload/history` | Histórico de uploads | ✅ |
| `POST /api/upload/history/refresh` | Atualiza views via YT API | ✅ |
| `DELETE /api/upload/history/:id` | Remove entrada do histórico | ✅ |
| `GET /api/instagram/auth/url` | Gera URL OAuth Meta | ✅ |
| `GET /api/instagram/auth/callback` | Recebe code, troca por token longo | ✅ |
| `GET /api/instagram/auth/status` | Estado da autenticação Instagram | ✅ |
| `POST /api/instagram/auth/refresh` | Renova token (chamar cada ~50 dias) | ✅ |
| `POST /api/instagram/auth/logout` | Limpa token | ✅ |
| `POST /api/instagram/upload` | Publica Reels (SSE) | ✅ |
| `GET /api/health` | in-process | ✅ |

---

## Innertube — como funciona

API interna do YouTube, zero quota, zero autenticação. Usada em `server/lib/innertube.js`.

```js
// search(query) → [{ videoId, title, views }]
// channelInfo(channelId) → { name, handle, subscribers, thumbnail }
// channelFeed(channelId) → últimos 15 vídeos via RSS

const CTX = { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' } }
fetch('https://www.youtube.com/youtubei/v1/search', { method: 'POST', body: JSON.stringify({ context: CTX, query }) })
```

**Limitações:** datas retornam como relativas ("2 months ago"), sem `publishedAfter`, parsing JSON muito aninhado.

---

## Sistema de fallback (vídeos)

```
1. Cache em memória (15 min TTL)
2. playlistItems.list + videos.list via withPublicYouTube (2 unidades)
3. Em quota exceeded → RSS Feed (channelFeed) — zero quota, últimos 15 vídeos
4. Enriquece RSS com Analytics (quota separada — geralmente disponível)
5. Cache em disco /tmp/videos_cache.json
```

---

## Quota da YouTube Data API

| Operação | Custo |
|----------|-------|
| `search.list` | 100 unidades 🚨 (não usamos mais) |
| `channels.list` | 1 unidade |
| `playlistItems.list` | 1 unidade |
| `videos.list` | 1 unidade |

**Reset:** 00:00 PST = 08:00 UTC = 05:00 BRT  
**YouTube Analytics API:** quota separada, mais generosa.

---

## Armadilhas conhecidas

- `dimensions=month` no Analytics exige dia 1 em **ambas** as datas (startDate e endDate)
- `let` dentro de `try{}` não é acessível no `catch{}` — inicializar antes do try
- Todas as API keys do mesmo projeto GCP → mesma quota → esgotam juntas
- Token OAuth em `/tmp` some no Railway ao reiniciar → usar `GOOGLE_TOKEN` env var
- `latestBeat` vazio no trending — Innertube retorna datas relativas, não absolutas

---

## AI — Scheduler (ai.js)

`POST /api/ai/analyze-beat` com `{ beatName }` → stream SSE com JSON progressivo.

Modelo: `llama-3.3-70b-versatile` via Groq.  
Retorna: `seoScore`, `optimizedTitle`, `description`, `tags`, `hashtags`, `thumbnail`, `postingSchedule`, `trendingComparison`.

Sanitização especial: o LLaMA às vezes emite `\n` literal dentro de strings JSON — `sanitizeJsonStrings()` corrige isso antes de parsear.

---

## Armadilha Instagram

- Token longo dura 60 dias — renovar via `POST /api/instagram/auth/refresh` antes de expirar
- Instagram não aceita upload direto — precisa de URL pública → `PUBLIC_URL` tem de estar definida no Railway
- `video_url` tem de ser acessível pela internet (não localhost) durante o processamento
- Status codes do container: `IN_PROGRESS` → `FINISHED` (ok) | `ERROR` / `EXPIRED` (falhou)

---

## Próximos passos

### Imediato
1. **Preencher env vars Meta** — `META_APP_ID`, `META_APP_SECRET` depois de criar o app em developers.facebook.com. Definir `META_REDIRECT_URI` e `PUBLIC_URL` no Railway.
2. **Conectar Instagram na UI** — Scheduler.tsx não tem ainda o flow de autenticação + upload Instagram. Implementar botão "Publicar no Instagram" que chama `POST /api/instagram/upload`.
3. **Atualizar `GOOGLE_TOKEN` no Railway** — se ainda não feito, exportar via `GET /api/auth/token-export` e definir no Railway.

### Médio prazo
4. **TikTok backend** — app submetido para aprovação. Quando aprovado: implementar `server/routes/tiktok.js` com OAuth TikTok + upload via Content Posting API.
5. **TikTok UI** — botão "Publicar no TikTok" no Scheduler.tsx.

### Longo prazo
6. **BeatStars integration** — API pública limitada, pode precisar de scraping ou link manual.
7. **Crescer o canal** — meta: 1.000 subs + 4.000h watch time para monetizar.

---

## Como correr localmente

```powershell
cd "C:\Users\Prodbygrillo\Desktop\prodbygrillo-dashboard"

# Instalar dependências (se necessário)
npm install
cd server && npm install && cd ..

# Desenvolvimento (Vite + Express em paralelo)
npm run dev:all

# Ou via PM2
pm2 start ecosystem.config.js
```

Frontend: http://localhost:5173  
Backend: http://localhost:3010

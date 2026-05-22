# prodbygrillo-dashboard — Contexto do Projeto

## Visão Geral

Dashboard de analytics do canal YouTube **prodbygrillo** (`@prodbygrillo`). Aplicação fullstack com frontend React + backend Express, deployada no Railway. Autentica via OAuth do Google e carrega dados reais da YouTube Analytics API.

---

## Stack Técnico

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Backend | Express 5 (CommonJS) |
| Styling | CSS-in-JS inline (estilo terminal retro) |
| Charts | Recharts |
| AI Chat | Groq SDK (`llama-3.3-70b-versatile`) |
| AI SEO | Groq SDK (`llama-3.3-70b-versatile`) |
| Deploy | Railway (monorepo — serve dist/ + API no mesmo processo) |
| Auth | Google OAuth 2.0 |

---

## Estrutura de Ficheiros

```
prodbygrillo-dashboard/
├── src/
│   ├── App.tsx                    # Root — auth gate, routing, data fetch
│   ├── pages/
│   │   ├── Overview.tsx           # Canal, stats, charts, top vídeos, trending, LAIS
│   │   ├── Analytics.tsx          # Mini charts + heatmap de views diárias
│   │   ├── Videos.tsx             # Tabela de vídeos com sort/filter; empty = vinyl art
│   │   ├── Audience.tsx           # Idade, género, países, dispositivos
│   │   ├── Revenue.tsx            # Revenue mensal; mostra NOT MONETIZED se não elegível
│   │   ├── Scheduler.tsx          # Upload + análise SEO de beats + Instagram/TikTok
│   │   └── Settings.tsx           # Contas OAuth, logout
│   ├── components/
│   │   ├── Header.tsx             # Barra topo: título, date range, [YT STUDIO], [LOGOUT]
│   │   ├── Sidebar.tsx            # Navegação lateral colapsável
│   │   ├── AIChat.tsx             # LAIS — chat terminal com Groq, streaming SSE
│   │   ├── VideoTable.tsx         # Tabela de vídeos reutilizável
│   │   ├── StatCard.tsx           # Card de métrica individual
│   │   ├── PixelIcons.tsx         # Ícones SVG pixel-art
│   │   ├── charts/
│   │   │   ├── ViewsChart.tsx
│   │   │   ├── TrafficChart.tsx
│   │   │   ├── AudienceChart.tsx
│   │   │   └── RevenueChart.tsx
│   │   └── ui/
│   │       └── Skeleton.tsx       # SkeletonCard, SkeletonTable
│   ├── lib/
│   │   └── api.ts                 # Cliente HTTP — todas as chamadas ao backend
│   ├── types/
│   │   └── index.ts               # Tipos TypeScript partilhados
│   └── utils/
│       └── format.ts              # fmtNum, fmtSecs, fmtPct, fmtNumFull
├── server/
│   ├── index.js                   # Entry point Express — monta rotas, serve dist/
│   ├── accountManager.js          # Gestão de token OAuth + API keys rotativas
│   ├── apiError.js                # isQuotaError, sendError helpers
│   └── routes/
│       ├── auth.js                # GET /status, /url, /callback, /token-export; POST /logout
│       ├── accounts.js            # GET /api/accounts/status
│       ├── channel.js             # GET /api/channel — com fallback innertube + env seed
│       ├── analytics.js           # GET /api/analytics?range=28d
│       ├── videos.js              # GET /api/videos
│       ├── audience.js            # GET /api/audience?range=28d
│       ├── trending.js            # GET /api/trending — top artistas do mês
│       ├── ai.js                  # POST /api/ai/chat (LAIS/Groq), /analyze-beat (Groq)
│       ├── upload.js              # POST /api/upload/youtube; GET /api/upload/tmp/:file
│       └── instagram.js           # Instagram OAuth + upload de Reels
├── .env                           # Variáveis locais (nunca commitado)
├── CONTEXT.md                     # Este ficheiro
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## Variáveis de Ambiente

### Railway (produção)

| Variável | Descrição |
|---|---|
| `GOOGLE_CREDENTIALS` | JSON das credenciais OAuth (client_id, client_secret, redirect_uris) |
| `GOOGLE_TOKEN` | Token OAuth persistido em base64 — **remover para forçar re-login** |
| `GROQ_API_KEY` | Chave Groq para LAIS (chat) e analyze-beat |
| `GEMINI_API_KEY` | Chave Gemini (não usada — billing bloqueia free tier em todos os projetos disponíveis) |
| `REDIRECT_URI` | `https://prodbygrillo-dashboard-production.up.railway.app/api/auth/callback` |
| `CHANNEL_ID` | `UCx5iV1aVpzOVBRMogBoi9_g` |
| `CHANNEL_NAME` | `Prodbygrillo` |
| `CHANNEL_HANDLE` | `@prodbygrillo` |
| `CHANNEL_SUBS` | Subscribers seed (usado quando API quota esgota) |
| `CHANNEL_VIEWS` | Views seed |
| `CHANNEL_VIDEOS` | Total vídeos seed |
| `YT_API_KEY_2/3/4` | API keys públicas rotativas para YouTube Data API |

---

## Rotas da API

### Auth
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/auth/status` | `{ authenticated: bool }` |
| GET | `/api/auth/url` | Gera URL OAuth Google |
| GET | `/api/auth/callback` | Callback OAuth — redireciona para frontend |
| POST | `/api/auth/logout` | Limpa token + caches |
| GET | `/api/auth/token-export` | Exporta token em base64 para Railway |

### Dados (requerem auth)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/channel` | Info do canal (nome, subs, views, videos) |
| GET | `/api/analytics?range=7d\|28d\|90d\|365d` | Métricas diárias |
| GET | `/api/videos` | Lista de vídeos com métricas |
| GET | `/api/audience?range=...` | Idade, género, países, dispositivos |
| GET | `/api/trending` | Top artistas em type beats no mês atual |

### AI
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/ai/chat` | LAIS — chat com dados do canal (Groq SSE) |
| POST | `/api/ai/analyze-beat` | Análise SEO de beat name (Groq SSE, retorna JSON) |

### Upload / Instagram
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/upload/youtube` | Upload de vídeo para YouTube (SSE progress) |
| GET | `/api/upload/tmp/:filename` | Serve ficheiro temporário (para Instagram) |
| GET | `/api/instagram/auth/url` | URL OAuth Meta |
| GET | `/api/instagram/auth/callback` | Callback Meta OAuth |
| GET | `/api/instagram/status` | Status da conta Instagram |
| POST | `/api/instagram/upload` | Publica Reel no Instagram (SSE) |

---

## Fluxo de Autenticação

```
Abre dashboard
    → GET /api/auth/status → { authenticated: false }
    → Mostra AuthOverlay com botão [CONNECT YOUTUBE CHANNEL]
    → Clica botão → GET /api/auth/url → abre popup OAuth Google
    → Utilizador faz login e autoriza
    → Google redireciona para /api/auth/callback?code=...
    → Servidor troca code por token → guarda em /tmp/token.json
    → Redireciona para /?auth=success
    → Frontend deteta query param → verifica status → autenticado
    → Carrega: channel, analytics, videos, trending, audience
```

**Logout:** botão `[LOGOUT]` no Header → POST /api/auth/logout → limpa token + caches → volta ao AuthOverlay.

**GOOGLE_TOKEN no Railway:** se definido, arranca pré-autenticado. Se removido (via `railway variable delete GOOGLE_TOKEN`), arranca sempre na tela de login.

---

## LAIS — Analista do Canal

- **Componente:** `src/components/AIChat.tsx`
- **Rota backend:** `POST /api/ai/chat`
- **Modelo:** Groq `llama-3.3-70b-versatile`
- **Contexto enviado:** info do canal, analytics diários (últimos 7 dias + tendência vs semana anterior), fontes de tráfego, top 10 vídeos, histórico da conversa (últimas 6 mensagens)
- **Streaming:** SSE — frontend constrói a resposta caractere a caractere
- **Tom:** Português de Portugal, direto, baseado nos dados reais

---

## Scheduler / Upload de Beats

Fluxo do Scheduler (`src/pages/Scheduler.tsx`):

1. **Análise SEO** — insere nome do beat → `POST /api/ai/analyze-beat` → Groq gera JSON com título otimizado, tags, hashtags, descrição, horário ideal, conceito de thumbnail
2. **Geração de thumbnail** — Canvas API (browser) gera imagem 1280×720 com o conceito sugerido
3. **Upload YouTube** — `POST /api/upload/youtube` via SSE com progresso em tempo real
4. **Publicação Instagram** — usa vídeo em `/tmp` + caption gerada pela AI → `POST /api/instagram/upload`
5. **TikTok** — UI presente mas desativado (aguarda aprovação no TikTok Developer Portal)

---

## Deploy (Railway)

```bash
# Deploy
railway up --detach

# Logs
railway logs

# Variáveis
railway variable set KEY=value
railway variable delete KEY
railway variable list --kv

# Exportar token OAuth após login (para persistir no Railway)
curl https://prodbygrillo-dashboard-production.up.railway.app/api/auth/token-export
# copia o campo "base64" → railway variable set GOOGLE_TOKEN=<valor>
```

**URL produção:** `https://prodbygrillo-dashboard-production.up.railway.app`

---

## Comportamento com Quota YouTube Esgotada

Reset diário às **08:00 UTC / 05:00 BRT**.

| Rota | Comportamento quando quota esgota |
|---|---|
| `/api/channel` | API key pública → Innertube → cache disco → seed env vars |
| `/api/analytics` | Retorna erro → frontend mostra skeleton |
| `/api/videos` | Retorna null → frontend mostra tela vinyl/piano animada |
| `/api/trending` | Usa API keys rotativas (YT_API_KEY_2/3/4) |
| `/api/audience` | Retorna erro → frontend mostra "NO DATA" |

---

## Notas Importantes

- **Zero mock data:** todos os dados vêm da API após login. Nenhum dado gerado ou hardcoded visível ao utilizador.
- **OAuth scopes:** `youtube.readonly`, `yt-analytics.readonly`, `yt-analytics-monetary.readonly` — não-sensíveis, sem necessidade de verificação Google. `youtube.upload` foi removido.
- **Gemini bloqueado:** todas as chaves Gemini disponíveis pertencem a projetos GCP com billing ativo, que zera o free tier (`limit: 0`). LAIS usa Groq enquanto não houver chave de projeto sem billing.
- **Instagram:** implementado mas requer credenciais Meta (`META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`).
- **Estilo visual:** terminal retro monocromático. Fonte Courier New. Cores principais: `#00ff00` (accent), fundo `#0a0a0a`, cards `#0d0d0d`. Sem emojis, sem gradientes.

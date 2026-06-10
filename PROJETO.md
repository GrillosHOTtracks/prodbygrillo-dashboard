# prodbygrillo — Dashboard de Produção Musical

**Versão:** 1.0  
**Produtor:** prodbygrillo  
**Deploy:** Railway (produção contínua via GitHub)  
**Data:** Maio 2026

---

## Visão Geral

Dashboard pessoal de gestão e automação para produção musical. Centraliza analytics do YouTube, inteligência de mercado com IA, publicação de beats e automação de redes sociais numa interface unificada. O sistema foi construído para eliminar tarefas manuais repetitivas — desde a análise de BPM de um beat até à publicação simultânea no YouTube e BeatStars.

---

## Stack Tecnológica

| Camada | Tecnologia | Detalhe |
|---|---|---|
| Frontend | React 19 + TypeScript | Interface retro-terminal (estética mIRC) |
| Build | Vite | Bundle otimizado para produção |
| Backend | Express.js 5 (Node 20) | API REST + SSE para progresso em tempo real |
| IA | Groq API | `llama-3.3-70b-versatile` + fallback `llama-3.1-8b-instant` |
| YouTube | googleapis v172 | Data API v3 + Analytics API v2 |
| Automação | Puppeteer headless | BeatStars — preenche e publica formulários |
| Deploy | Railway | Monorepo, Dockerfile, auto-deploy no push |

---

## Módulos

### 🔐 Autenticação em Duas Camadas

**Camada 1 — Login dashboard (username/password)**  
Tela de login própria antes de qualquer funcionalidade. JWT com validade de 30 dias armazenado em `localStorage`. Credenciais configuradas via variáveis de ambiente no Railway. Se não configurado, bypass automático para desenvolvimento.

**Camada 2 — OAuth YouTube**  
Após o login do dashboard, o utilizador conecta a conta Google via OAuth 2.0. Suporte a múltiplas contas com rotação automática em caso de quota excedida (429).

---

### 📊 Overview

Visão geral do canal YouTube com métricas do período selecionado (7d / 28d / 90d / 365d):

- Views totais e tendência
- Watch time acumulado
- Variação de subscribers
- CTR médio e impressões
- Receita estimada (quando disponível)
- Trending artists com score de oportunidade
- Traffic sources (pesquisa, sugestões, externo, etc.)

---

### 🎬 Videos

Lista completa de todos os vídeos do canal com métricas individuais:

- Views, likes, comentários
- Watch time e duração média de visualização
- CTR por vídeo
- Receita por vídeo
- Status (público, não listado, privado)

---

### 📈 Analytics

Gráficos de série temporal interativos com seleção de métrica:

- Views diários
- Watch time
- Subscribers ganhos/perdidos
- Revenue diária
- Comparação entre períodos

---

### 👥 Audience

Dados demográficos e comportamentais da audiência:

- Distribuição por faixa etária e género
- Top países por views e percentagem
- Distribuição por dispositivo (mobile, desktop, TV, tablet)
- Ratio subscrito vs não-subscrito

---

### 💰 Revenue

Histórico de receita mensal via YouTube Analytics API:

- Gráfico de barras mensal
- Indicador de meses com dados parciais
- Aviso quando a conta não tem monetização activa

---

### 🗓 Scheduler — Publicação Automatizada

O módulo central. Fluxo completo de publicação de um beat:

**1. Análise do ficheiro de áudio**  
Upload do MP3/WAV → análise local no browser:
- BPM detectado via `web-audio-beat-detector`
- Tom (key) detectado via algoritmo Bellman-Budge

**2. Análise LAIS (IA)**  
Envio para `/api/ai/analyze-beat` com o áudio e contexto de mercado opcional. A LAIS gera:
- Artistas de referência (`matchingArtists`)
- Título otimizado (`optimizedTitle`)
- Hashtags (YouTube + Instagram separados)
- Conceito de thumbnail (`thumbnail.concept`)
- Descrição completa com links e terms of use

**3. Editor de thumbnail**  
Canvas no browser com templates editáveis. Preview em tempo real antes do upload.

**4. Upload YouTube**  
Envio via SSE (Server-Sent Events) com barra de progresso em tempo real. Suporta ficheiros até 2 GB.

**5. Histórico**  
Registo local de todos os uploads com título, data e status.

**Integração MERCADO → Scheduler**  
Quando o utilizador vem da aba Mercado clicando "CRIAR NO SCHEDULER", o Scheduler recebe contexto completo (artista, nicho, keywords, BPM sugerido, tom, título sugerido) e a LAIS gera tudo orientado por esses dados. Badge "📡 BASEADO NO MERCADO" identifica estas sessões.

---

### 🛒 Beat Store — BeatStars Automatizado

Publicação no BeatStars sem intervenção manual:

- Autenticação via cookies (`BEATSTARS_COOKIES`) — bypassa MFA sem precisar de login por password
- Puppeteer preenche automaticamente: título, preços, tags, ficheiro de áudio, imagem de capa
- Dados passados via `localStorage.beatstore_prefill` após análise no Scheduler
- Progresso em tempo real via SSE

---

### 🌍 Market — Inteligência de Mercado

Análise de mercado em tempo real sem depender de quota do YouTube (usa Innertube não autenticado):

**CardTrending**  
27 nichos musicais × 23 mercados geográficos (Americas, Europa, África, Ásia, Oceania). Cache de 24h. Ranking por volume de vídeos, views médias e crescimento.

**CardLAIS — Radar de Mercado**  
A LAIS analisa os dados de tendência e gera:
- Oportunidade da semana (artista + nicho + mercado + justificação)
- "FAZER AGORA" — título, BPM e tom sugeridos para um beat imediato
- Insights: nicho a crescer, artista subindo, o que evitar
- Mercado geográfico mais quente

O botão ↻ regenera a análise com novos dados a qualquer momento. Estado "CRIADO HOJE" persiste por localStorage (reset automático no dia seguinte).

**CardChannels**  
Benchmark de até 15 canais concorrentes com:
- Média de views por vídeo
- Frequência de publicação
- Duração média dos vídeos
- Nicho dominante

**CardComments**  
Insights dos comentários dos top 5 vídeos do mercado: sentimento, padrões de elogio, pedidos frequentes.

---

### 📋 Plan — Plano Estratégico

Plano semanal gerado automaticamente:

**Fila de Engajamento**  
A LAIS identifica os artistas de referência do MERCADO, busca os seus vídeos oficiais mais recentes no YouTube, e gera comentários estratégicos — com ângulo subtil de produtor sem spam direto. O utilizador clica "COMENTAR" e o comentário é pré-preenchido no YouTube.

**Sugestões de conteúdo**  
Recomendações baseadas em analytics reais do canal combinadas com tendências de mercado.

---

### ⚙️ Settings

- Gestão de contas OAuth YouTube (conectar / desconectar)
- Status das API keys com indicador de quota
- Export de token para Railway (`GOOGLE_TOKEN`)
- Logout completo (YouTube OAuth + JWT dashboard)

---

## Arquitetura de Segurança

```
Browser
  └─ JWT dashboard (localStorage, 30d)
       └─ Express — dashboardAuth middleware
            ├─ Bypass: /api/auth/dashboard-login, /api/auth/callback
            └─ Todas as rotas protegidas
                 └─ requireAuth (YouTube OAuth)
                      └─ Dados reais do canal
```

**Regras de segurança fixas:**
- `GROQ_API_KEY` nunca exposto ao frontend — todas as chamadas de IA passam pelo servidor
- `BEATSTARS_COOKIES` apenas no Railway como variável de ambiente
- Tokens OAuth em ficheiros locais (gitignored)
- Credenciais de login apenas em variáveis de ambiente (nunca no código)

---

## Variáveis de Ambiente (Railway)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DASHBOARD_USERNAME` | Não | Username do login (default: `admin`) |
| `DASHBOARD_PASSWORD` | Sim* | Password do login. Sem esta var, bypass automático |
| `JWT_SECRET` | Sim* | Chave secreta para assinar os tokens JWT |
| `GROQ_API_KEY` | Sim | Chave da API Groq para a LAIS |
| `GOOGLE_TOKEN` | Sim | Token OAuth YouTube em base64 |
| `CHANNEL_ID` | Não | ID do canal (seed de cache no arranque) |
| `BEATSTARS_COOKIES` | Sim | Cookies BeatStars em base64 para automação |
| `FRONTEND_URL` | Não | URL do frontend (CORS) |
| `PORT` | Não | Porta do servidor (default: 3010) |

*Sem `DASHBOARD_PASSWORD` e `JWT_SECRET`, o sistema corre em modo dev sem login.

---

## Fluxo Completo — Beat para Publicação

```
1. Criar beat no DAW (externo)
          ↓
2. Abrir MERCADO → ver oportunidade LAIS
   → clicar "CRIAR NO SCHEDULER"
          ↓
3. Scheduler recebe contexto (artista, nicho, BPM, key, título)
   → upload MP3/WAV
   → análise local: BPM + key detectados
   → LAIS analisa com contexto de mercado
   → gera: artistas, hashtags, título, descrição, thumbnail concept
          ↓
4. Editar thumbnail no Canvas
   → upload YouTube (SSE, progresso em tempo real)
          ↓
5. Beat Store
   → dados pré-preenchidos via localStorage
   → Puppeteer publica no BeatStars automaticamente
          ↓
6. Plan → Engajamento
   → comentar em vídeos dos artistas de referência
   → crescimento orgânico do canal
```

---

## Estrutura de Ficheiros

```
prodbygrillo-dashboard/
├── server/
│   ├── index.js                  # Entry point Express
│   ├── accountManager.js         # Gestão OAuth multi-conta
│   ├── middleware/
│   │   └── dashboardAuth.js      # JWT middleware
│   └── routes/
│       ├── auth.js               # OAuth + login dashboard
│       ├── ai.js                 # LAIS (Groq) + analyze-beat
│       ├── market.js             # Inteligência de mercado
│       ├── channel.js            # Info do canal
│       ├── analytics.js          # Métricas
│       ├── videos.js             # Lista de vídeos
│       ├── audience.js           # Dados demográficos
│       ├── trending.js           # Trending artists
│       ├── upload.js             # Upload YouTube
│       ├── beatstars.js          # Automação BeatStars
│       └── instagram.js          # Upload Instagram
├── src/
│   ├── App.tsx                   # Root + estados globais + auth layers
│   ├── lib/api.ts                # Cliente HTTP com JWT
│   ├── types/index.ts            # Tipos partilhados
│   ├── pages/
│   │   ├── Overview.tsx
│   │   ├── Videos.tsx
│   │   ├── Analytics.tsx
│   │   ├── Audience.tsx
│   │   ├── Revenue.tsx
│   │   ├── Scheduler.tsx         # Módulo principal
│   │   ├── BeatStore.tsx
│   │   ├── Market.tsx            # MERCADO + LAIS
│   │   ├── Plan.tsx
│   │   └── Settings.tsx
│   └── components/
│       ├── Sidebar.tsx
│       └── Header.tsx
├── Dockerfile
├── package.json
└── vite.config.ts
```

---

## Modelo de IA — LAIS

**LAIS** (nome interno da IA do dashboard) usa o modelo `llama-3.3-70b-versatile` via Groq API com fallback automático para `llama-3.1-8b-instant` em caso de rate limit.

**Casos de uso:**
| Endpoint | Input | Output |
|---|---|---|
| `POST /api/ai/analyze-beat` | áudio + contexto mercado | artistas, hashtags, título, descrição, thumbnail |
| `POST /api/ai/chat` (SSE) | prompt livre | streaming de texto (Market, Plan, Engagement) |

**Contexto de mercado injetado no prompt:**
Quando o beat vem da aba MERCADO, a LAIS recebe artista primário, nicho, keywords de referência, BPM sugerido e tom — e usa esses dados para sobrepor escolhas genéricas com escolhas orientadas por tendência real.

---

*Documento gerado em Maio 2026*

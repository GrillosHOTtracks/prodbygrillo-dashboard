import { useState, useRef, useCallback, useEffect } from 'react'
import { ThumbnailBuilder } from '../components/scheduler/ThumbnailBuilder'

// ─── Types ────────────────────────────────────────────────────────────────────
interface BeatAnalysis {
  seoScore: number
  titleAnalysis: {
    score: number
    charCount: number
    strengths: string[]
    issues: string[]
    alternatives: string[]
  }
  optimizedTitle: string
  description: string
  tags: string[]
  hashtags: string[]
  thumbnail: {
    concept: string
    colors: string[]
    mainText: string
    subText: string
    style: string
  }
  postingSchedule: {
    bestDay: string
    bestTime: string
    timezone: string
    reasoning: string
  }
  trendingComparison: {
    matchingArtists: string[]
    vibes: string[]
    uniquenessScore: number
    competitionLevel: string
    suggestion: string
  }
}

interface UploadEntry {
  id: string
  title: string
  publishedAt: string
  status: 'scheduled' | 'live' | 'error'
  thumbnailUrl: string | null
  videoUrl: string
  views: number
  uploadedAt: string
}

type Status      = 'idle' | 'loading' | 'done' | 'error'
type UploadPhase = 'idle' | 'sending' | 'uploading' | 'processing' | 'done' | 'error'
type IgPhase     = 'idle' | 'creating' | 'processing' | 'publishing' | 'done' | 'error'

interface IgStatus {
  authenticated: boolean
  username?:  string
  pageName?:  string
  expiresAt?: number | null
  daysLeft?:  number | null
  warning?:   string | null
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '12px',
}

const label10: React.CSSProperties = {
  color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: '0 0 4px',
}

const retro: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #333333',
  color: '#707070',
  fontSize: '10px',
  padding: '3px 10px',
  cursor: 'pointer',
  fontFamily: 'Courier New, monospace',
  letterSpacing: '1px',
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
      style={{ background: 'transparent', border: `1px solid ${copied ? '#00ff00' : '#333333'}`, color: copied ? '#00ff00' : '#555555', fontSize: '10px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '1px', flexShrink: 0 }}
    >{copied ? '✓ OK' : '[ CP ]'}</button>
  )
}

function ScoreBar({ score, label }: { score: number; label?: string }) {
  const color  = score >= 75 ? '#00ff00' : score >= 50 ? '#ffaa00' : '#ff4400'
  const filled = Math.round((score / 100) * 20)
  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px' }}>{label}</span>
          <span style={{ color, fontSize: '11px', fontWeight: 'bold' }}>{score}/100</span>
        </div>
      )}
      <div style={{ fontSize: '12px', letterSpacing: '-1px', lineHeight: 1 }}>
        <span style={{ color }}>{'█'.repeat(filled)}</span>
        <span style={{ color: '#1a1a1a' }}>{'░'.repeat(20 - filled)}</span>
      </div>
    </div>
  )
}

function Chip({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <span style={{ border: `1px solid ${accent ? '#1a3a1a' : '#222222'}`, backgroundColor: accent ? '#0a1a0a' : 'transparent', color: accent ? '#00aa00' : '#707070', fontSize: '10px', padding: '2px 8px', letterSpacing: '0.5px' }}>
      {text}
    </span>
  )
}

// ─── History section ──────────────────────────────────────────────────────────
function UploadHistory({ refreshKey }: { refreshKey: number }) {
  const [history, setHistory]       = useState<UploadEntry[]>([])
  const [loading, setLoading]       = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/upload/history')
      if (r.ok) setHistory(await r.json())
    } finally { setLoading(false) }
  }

  async function refreshViews() {
    setRefreshing(true)
    try {
      const r = await fetch('/api/upload/history/refresh', { method: 'POST' })
      if (r.ok) setHistory(await r.json())
    } finally { setRefreshing(false) }
  }

  async function deleteEntry(id: string) {
    await fetch(`/api/upload/history/${id}`, { method: 'DELETE' })
    setHistory(h => h.filter(e => e.id !== id))
  }

  useEffect(() => { load() }, [refreshKey])

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
          ┌─ HISTÓRICO DE UPLOADS ({history.length})
        </p>
        <button
          onClick={refreshViews}
          disabled={refreshing}
          style={retro}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}
        >
          {refreshing ? '[ ATUALIZANDO... ]' : '[ ATUALIZAR VIEWS ]'}
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#333333', fontSize: '11px', letterSpacing: '2px' }}>CARREGANDO<span className="blink">_</span></p>
      ) : history.length === 0 ? (
        <p style={{ color: '#333333', fontSize: '11px', letterSpacing: '1px' }}>*** NENHUM UPLOAD REALIZADO ***</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>
                {['THUMB', 'TÍTULO', 'DATA', 'STATUS', 'VIEWS', 'LINK', ''].map(h => (
                  <th key={h} style={{ color: '#444444', fontSize: '10px', letterSpacing: '1px', textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #1a1a1a' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map(entry => (
                <tr key={entry.id} style={{ borderBottom: '1px solid #111111' }}>
                  <td style={{ padding: '6px 8px' }}>
                    {entry.thumbnailUrl
                      ? <img src={entry.thumbnailUrl} alt="" style={{ width: '80px', height: '45px', objectFit: 'cover', display: 'block', border: '1px solid #1a1a1a' }} />
                      : <div style={{ width: 80, height: 45, background: '#111' }} />
                    }
                  </td>
                  <td style={{ color: '#c0c0c0', padding: '6px 8px', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.title}
                  </td>
                  <td style={{ color: '#555555', padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {new Date(entry.publishedAt).toLocaleDateString('pt-BR')}
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    <span style={{ color: entry.status === 'live' ? '#00ff00' : entry.status === 'scheduled' ? '#ffaa00' : '#ff4400' }}>
                      {entry.status === 'live' ? '🟢 LIVE' : entry.status === 'scheduled' ? '🟡 AGENDADO' : '🔴 ERRO'}
                    </span>
                  </td>
                  <td style={{ color: '#707070', padding: '6px 8px', textAlign: 'right' }}>
                    {entry.views.toLocaleString('pt-BR')}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <a href={entry.videoUrl} target="_blank" rel="noreferrer"
                       style={{ color: '#00aa00', fontSize: '11px', textDecoration: 'none' }}>
                      ▶ YT
                    </a>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <button onClick={() => deleteEntry(entry.id)}
                      style={{ background: 'transparent', border: 'none', color: '#333333', cursor: 'pointer', fontSize: '12px' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff4400' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#333333' }}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function Scheduler() {
  // ── Analysis state
  const [beatName, setBeatName]       = useState('')
  const [status, setStatus]           = useState<Status>('idle')
  const [streamText, setStreamText]   = useState('')
  const [analysis, setAnalysis]       = useState<BeatAnalysis | null>(null)
  const [error, setError]             = useState('')
  const terminalRef                   = useRef<HTMLDivElement>(null)

  // ── Thumbnail state
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null)

  // ── Upload state
  const [videoFile, setVideoFile]         = useState<File | null>(null)
  const [uploadPhase, setUploadPhase]     = useState<UploadPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadVideoId, setUploadVideoId] = useState<string | null>(null)
  const [uploadError, setUploadError]     = useState('')
  const [scheduledAt, setScheduledAt]     = useState('')
  const fileInputRef                      = useRef<HTMLInputElement>(null)

  // ── History refresh trigger
  const [histRefreshKey, setHistRefreshKey] = useState(0)

  // ── Instagram state
  const [igStatus, setIgStatus]       = useState<IgStatus | null>(null)
  const [igCaption, setIgCaption]     = useState('')
  const [igPhase, setIgPhase]         = useState<IgPhase>('idle')
  const [igProgress, setIgProgress]   = useState(0)
  const [igPermalink, setIgPermalink] = useState('')
  const [igError, setIgError]         = useState('')

  // ── Instagram auth + auto-populate
  useEffect(() => {
    fetch('/api/instagram/auth/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setIgStatus(d) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('instagram_auth')) return
    fetch('/api/instagram/auth/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setIgStatus(d) })
      .catch(() => {})
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  useEffect(() => {
    if (!analysis) return
    const firstLine = analysis.description.split('\n').find(l => l.trim()) || ''
    setIgCaption(firstLine.trim())
  }, [analysis])

  const connectInstagram = useCallback(async () => {
    try {
      const origin = window.location.origin + window.location.pathname
      const r = await fetch(`/api/instagram/auth/url?origin=${encodeURIComponent(origin)}`)
      if (!r.ok) return
      const { url } = await r.json()
      window.location.href = url
    } catch {}
  }, [])

  const handleIgUpload = useCallback(async () => {
    if (!videoFile || igPhase !== 'idle') return
    setIgPhase('creating')
    setIgProgress(10)
    setIgError('')
    setIgPermalink('')

    try {
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('meta', JSON.stringify({
        caption:  igCaption,
        hashtags: analysis?.hashtags ?? [],
      }))

      const res = await fetch('/api/instagram/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let rawBuf = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        rawBuf += decoder.decode(value, { stream: true })
        const lines = rawBuf.split('\n')
        rawBuf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') break outer
          try {
            const evt = JSON.parse(payload)
            if (evt.status === 'CREATING_CONTAINER') { setIgPhase('creating');   setIgProgress(10) }
            if (evt.status === 'PROCESSING')         { setIgPhase('processing'); setIgProgress(evt.progress ?? 40) }
            if (evt.status === 'PUBLISHING')         { setIgPhase('publishing'); setIgProgress(90) }
            if (evt.status === 'DONE')               { setIgPhase('done');       setIgProgress(100); setIgPermalink(evt.permalink || '') }
            if (evt.status === 'ERROR')              throw new Error(evt.error || 'Erro no upload Instagram')
          } catch (e) { if (!(e instanceof SyntaxError)) throw e }
        }
      }
    } catch (err: any) { setIgError(err.message); setIgPhase('error') }
  }, [videoFile, igCaption, igPhase, analysis])

  // ─ AI Analysis
  const analyze = useCallback(async () => {
    if (!beatName.trim() || status === 'loading') return
    setStatus('loading')
    setStreamText('')
    setAnalysis(null)
    setError('')
    setThumbDataUrl(null)
    setUploadPhase('idle')
    setUploadVideoId(null)

    try {
      const res = await fetch('/api/ai/analyze-beat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beatName: beatName.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: body.code })
      }

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let rawBuf = '', jsonBuf = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        rawBuf += decoder.decode(value, { stream: true })
        const lines = rawBuf.split('\n')
        rawBuf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') {
            try { setAnalysis(JSON.parse(jsonBuf.trim()) as BeatAnalysis); setStatus('done') }
            catch { throw new Error('Resposta da IA inválida — tente novamente.') }
            break outer
          }
          try {
            const evt = JSON.parse(payload)
            if (evt.error) throw new Error(evt.error)
            if (evt.text) { jsonBuf += evt.text; setStreamText(jsonBuf); if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight }
          } catch (e) { if (!(e instanceof SyntaxError)) throw e }
        }
      }
    } catch (err: any) { setError(err.message); setStatus('error') }
  }, [beatName, status])

  // ─ Upload
  const handleUpload = useCallback(async () => {
    if (!videoFile || !analysis || uploadPhase !== 'idle') return
    setUploadPhase('sending')
    setUploadProgress(0)
    setUploadError('')
    setUploadVideoId(null)

    try {
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('meta', JSON.stringify({
        title:            analysis.optimizedTitle,
        description:      analysis.description,
        tags:             analysis.tags,
        thumbnailDataUrl: thumbDataUrl,
        scheduledAt:      scheduledAt || undefined,
      }))

      const res = await fetch('/api/upload/video', { method: 'POST', body: formData })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: body.code })
      }

      setUploadPhase('uploading')

      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let rawBuf = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        rawBuf += decoder.decode(value, { stream: true })
        const lines = rawBuf.split('\n')
        rawBuf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') break outer
          try {
            const evt = JSON.parse(payload)
            if (evt.status === 'UPLOADING')   setUploadProgress(evt.progress)
            if (evt.status === 'PROCESSING')  setUploadPhase('processing')
            if (evt.status === 'LIVE' || evt.status === 'SCHEDULED') {
              setUploadPhase('done')
              setUploadVideoId(evt.videoId)
              setHistRefreshKey(k => k + 1)
            }
            if (evt.status === 'ERROR') throw new Error(evt.error || 'Upload failed')
          } catch (e) { if (!(e instanceof SyntaxError)) throw e }
        }
      }
    } catch (err: any) { setUploadError(err.message); setUploadPhase('error') }
  }, [videoFile, analysis, thumbDataUrl, scheduledAt, uploadPhase])

  const results = status === 'done' && analysis

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ══ HEADER ══ */}
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '2px', margin: 0 }}>
        ┌─ AI BEAT ANALYZER · SCHEDULER ────────────────────────────
      </p>

      {/* ══ INPUT ══ */}
      <div style={panel}>
        <p style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: '0 0 10px' }}>
          Digite o nome do beat · a IA gera todos os metadados para upload no YouTube · modelo: llama-3.3-70b
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ color: '#00ff00', fontSize: '13px', alignSelf: 'center', flexShrink: 0 }}>&gt;</span>
          <input
            value={beatName}
            onChange={e => setBeatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyze()}
            placeholder="ex: Drake x PartyNextDoor Type Beat 2025 | Dark RnB"
            disabled={status === 'loading'}
            style={{ flex: 1, backgroundColor: '#111111', border: '1px solid #333333', borderBottom: '2px solid #00ff00', color: '#c0c0c0', fontSize: '13px', padding: '8px 12px', fontFamily: 'Courier New, monospace', outline: 'none' }}
          />
          <button
            onClick={analyze}
            disabled={!beatName.trim() || status === 'loading'}
            style={{ padding: '8px 18px', flexShrink: 0, backgroundColor: status === 'loading' ? '#001a00' : '#00ff00', color: status === 'loading' ? '#00ff00' : '#000000', border: status === 'loading' ? '1px solid #004400' : 'none', cursor: !beatName.trim() || status === 'loading' ? 'not-allowed' : 'pointer', fontFamily: 'Courier New, monospace', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}
          >
            {status === 'loading' ? '[ PROCESSANDO... ]' : '[ ANALISAR COM IA ]'}
          </button>
        </div>
      </div>

      {/* ══ STREAMING TERMINAL ══ */}
      {(status === 'loading' || status === 'done') && streamText && (
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
              ┌─ AI OUTPUT {status === 'loading' ? '── GERANDO' : '── COMPLETO'}
            </p>
            <span style={{ color: '#2a2a2a', fontSize: '10px' }}>llama-3.3-70b-versatile</span>
          </div>
          <div ref={terminalRef} style={{ backgroundColor: '#060606', border: '1px solid #1a1a1a', padding: '8px 10px', maxHeight: status === 'done' ? '60px' : '180px', overflowY: 'auto', fontFamily: 'Courier New, monospace', fontSize: '9px', color: '#1e5c1e', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-all', transition: 'max-height 0.5s' }}>
            {streamText}
            {status === 'loading' && <span className="blink" style={{ color: '#00ff00' }}>█</span>}
          </div>
        </div>
      )}

      {/* ══ ERROR ══ */}
      {status === 'error' && (
        <div style={{ ...panel, borderTopColor: '#ff4400', borderLeftColor: '#ff4400' }}>
          <p style={{ color: '#ff4400', fontSize: '11px', margin: '0 0 6px' }}>⚠ ERRO: {error}</p>
          {(error.includes('GROQ_API_KEY') || error.includes('NO_API_KEY')) && (
            <p style={{ color: '#555555', fontSize: '10px', margin: 0, lineHeight: '1.7' }}>
              Crie um arquivo <span style={{ color: '#707070' }}>.env</span> na raiz do projeto:<br />
              <span style={{ color: '#707070' }}>GROQ_API_KEY=gsk_...</span><br />
              Obtenha em <span style={{ color: '#707070' }}>console.groq.com</span>
            </p>
          )}
        </div>
      )}

      {/* ══ ANÁLISE + THUMBNAIL + UPLOAD ══ */}
      {results && (
        <>
          {/* ── SEO SCORE ── */}
          <div style={panel}>
            <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 10px' }}>┌─ SEO SCORE GLOBAL</p>
            <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: '260px', flex: 1 }}>
                <ScoreBar score={analysis.seoScore} label="SCORE GERAL" />
              </div>
              <div style={{ display: 'flex', gap: '28px' }}>
                {[{ label: 'TÍTULO', val: analysis.titleAnalysis.score }, { label: 'UNICIDADE', val: analysis.trendingComparison.uniquenessScore }].map(({ label, val }) => (
                  <div key={label}>
                    <p style={label10}>{label}</p>
                    <p style={{ color: val >= 75 ? '#00ff00' : val >= 50 ? '#ffaa00' : '#ff4400', fontSize: '22px', fontWeight: 'bold', margin: 0 }}>{val}</p>
                  </div>
                ))}
                <div>
                  <p style={label10}>COMPETIÇÃO</p>
                  <p style={{ color: analysis.trendingComparison.competitionLevel === 'low' ? '#00ff00' : analysis.trendingComparison.competitionLevel === 'medium' ? '#ffaa00' : '#ff4400', fontSize: '22px', fontWeight: 'bold', margin: 0, textTransform: 'uppercase' }}>
                    {analysis.trendingComparison.competitionLevel}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── TÍTULO + HORÁRIO ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '12px' }}>
            <div style={panel}>
              <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 10px' }}>
                ┌─ ANÁLISE DO TÍTULO · {analysis.titleAnalysis.charCount} CHARS
              </p>
              <ScoreBar score={analysis.titleAnalysis.score} label="SCORE DO TÍTULO" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
                <div>
                  <p style={{ color: '#00ff00', fontSize: '10px', letterSpacing: '1px', margin: '0 0 5px' }}>✓ PONTOS FORTES</p>
                  {analysis.titleAnalysis.strengths.map((s, i) => <p key={i} style={{ color: '#707070', fontSize: '10px', margin: '0 0 3px', lineHeight: '1.5' }}>· {s}</p>)}
                </div>
                <div>
                  <p style={{ color: '#ff6600', fontSize: '10px', letterSpacing: '1px', margin: '0 0 5px' }}>⚠ PROBLEMAS</p>
                  {analysis.titleAnalysis.issues.map((s, i) => <p key={i} style={{ color: '#707070', fontSize: '10px', margin: '0 0 3px', lineHeight: '1.5' }}>· {s}</p>)}
                </div>
              </div>
              <div style={{ borderTop: '1px solid #1a1a1a', marginTop: '10px', paddingTop: '10px' }}>
                <p style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: '0 0 6px' }}>ALTERNATIVAS SUGERIDAS</p>
                {analysis.titleAnalysis.alternatives.map((alt, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', gap: '8px' }}>
                    <p style={{ color: '#c0c0c0', fontSize: '11px', margin: 0 }}><span style={{ color: '#333333' }}>{i + 1}.</span> {alt}</p>
                    <CopyBtn text={alt} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ ...panel, display: 'flex', flexDirection: 'column' }}>
              <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }}>┌─ MELHOR HORÁRIO</p>
              <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: '8px' }}>
                <p style={label10}>DIA DA SEMANA</p>
                <p style={{ color: '#00ff00', fontSize: '17px', fontWeight: 'bold', margin: '0 0 14px', letterSpacing: '1px' }}>{analysis.postingSchedule.bestDay.toUpperCase()}</p>
                <p style={label10}>HORÁRIO ({analysis.postingSchedule.timezone})</p>
                <p style={{ color: '#ffffff', fontSize: '36px', fontWeight: 'bold', margin: 0, fontVariantNumeric: 'tabular-nums', letterSpacing: '2px' }}>{analysis.postingSchedule.bestTime}</p>
              </div>
              <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '8px' }}>
                <p style={{ color: '#444444', fontSize: '10px', lineHeight: '1.6', margin: 0 }}>{analysis.postingSchedule.reasoning}</p>
              </div>
            </div>
          </div>

          {/* ── TÍTULO OTIMIZADO ── */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>┌─ TÍTULO OTIMIZADO PARA YOUTUBE</p>
              <CopyBtn text={analysis.optimizedTitle} />
            </div>
            <p style={{ color: '#ffffff', fontSize: '15px', fontWeight: 'bold', margin: 0, lineHeight: '1.4' }}>{analysis.optimizedTitle}</p>
            <p style={{ color: '#333333', fontSize: '10px', margin: '4px 0 0' }}>
              {analysis.optimizedTitle.length} caracteres
              <span style={{ color: analysis.optimizedTitle.length > 70 ? '#ff6600' : '#333333', marginLeft: '8px' }}>
                {analysis.optimizedTitle.length > 100 ? '⚠ muito longo' : analysis.optimizedTitle.length > 70 ? '⚠ acima do ideal' : '✓ tamanho ok'}
              </span>
            </p>
          </div>

          {/* ── DESCRIÇÃO ── */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>┌─ DESCRIÇÃO YOUTUBE</p>
              <CopyBtn text={analysis.description} />
            </div>
            <pre style={{ color: '#707070', fontSize: '11px', margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.7', fontFamily: 'Courier New, monospace' }}>
              {analysis.description}
            </pre>
          </div>

          {/* ── TAGS + HASHTAGS ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={panel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>┌─ TAGS ({analysis.tags.length})</p>
                <CopyBtn text={analysis.tags.join(', ')} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {analysis.tags.map((tag, i) => <span key={i} style={{ backgroundColor: '#111111', border: '1px solid #252525', color: '#707070', fontSize: '10px', padding: '2px 7px' }}>{tag}</span>)}
              </div>
            </div>
            <div style={panel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>┌─ HASHTAGS ({analysis.hashtags.length})</p>
                <CopyBtn text={analysis.hashtags.join(' ')} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {analysis.hashtags.map((tag, i) => <Chip key={i} text={tag} accent />)}
              </div>
            </div>
          </div>

          {/* ── THUMBNAIL CONCEITO + TRENDING ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={panel}>
              <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 10px' }}>┌─ CONCEITO DE THUMBNAIL (IA)</p>
              <div style={{ backgroundColor: analysis.thumbnail.colors[0] || '#111111', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', border: '1px solid #222222', overflow: 'hidden', position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, transparent 40%, rgba(0,0,0,0.4))' }} />
                <p style={{ color: analysis.thumbnail.colors[1] || '#00ff00', fontSize: '20px', fontWeight: 'bold', margin: 0, letterSpacing: '4px', textShadow: `0 0 24px ${analysis.thumbnail.colors[1] || '#00ff00'}80`, fontFamily: 'Courier New, monospace', textAlign: 'center', padding: '0 8px', position: 'relative', zIndex: 1 }}>{analysis.thumbnail.mainText}</p>
                <p style={{ color: analysis.thumbnail.colors[2] || '#c0c0c0', fontSize: '9px', margin: '6px 0 0', letterSpacing: '3px', fontFamily: 'Courier New, monospace', position: 'relative', zIndex: 1 }}>{analysis.thumbnail.subText}</p>
              </div>
              <p style={label10}>PALETA DE CORES</p>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                {analysis.thumbnail.colors.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: 22, height: 22, backgroundColor: c, border: '1px solid #333333' }} />
                    <span style={{ color: '#444444', fontSize: '10px' }}>{c}</span>
                  </div>
                ))}
              </div>
              <p style={{ color: '#444444', fontSize: '10px', lineHeight: '1.6', margin: 0 }}>{analysis.thumbnail.concept}</p>
            </div>
            <div style={panel}>
              <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }}>┌─ COMPARAÇÃO COM TRENDING</p>
              <p style={label10}>ARTISTAS EM ALTA COMPATÍVEIS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                {analysis.trendingComparison.matchingArtists.map((a, i) => (
                  <span key={i} style={{ border: `1px solid ${i === 0 ? '#555555' : '#222222'}`, color: i === 0 ? '#c0c0c0' : '#555555', fontSize: '11px', padding: '3px 10px', fontWeight: i === 0 ? 'bold' : 'normal' }}>
                    {i === 0 ? '★ ' : ''}{a}
                  </span>
                ))}
              </div>
              <p style={label10}>VIBES DETECTADAS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                {analysis.trendingComparison.vibes.map((v, i) => <Chip key={i} text={v} accent />)}
              </div>
              <div style={{ marginBottom: '12px' }}>
                <ScoreBar score={analysis.trendingComparison.uniquenessScore} label="UNICIDADE" />
              </div>
              <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '8px' }}>
                <p style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: '0 0 4px' }}>💡 COMO SE DIFERENCIAR</p>
                <p style={{ color: '#707070', fontSize: '10px', lineHeight: '1.7', margin: 0 }}>{analysis.trendingComparison.suggestion}</p>
              </div>
            </div>
          </div>

          {/* ══ THUMBNAIL AUTOMÁTICA ══ */}
          <ThumbnailBuilder
            beatName={beatName}
            artists={analysis.trendingComparison.matchingArtists}
            onReady={setThumbDataUrl}
          />

          {/* ══ UPLOAD 1 CLIQUE ══ */}
          <div style={panel}>
            <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }}>
              ┌─ UPLOAD 1 CLIQUE · YOUTUBE
            </p>

            {/* File selector */}
            {(uploadPhase === 'idle' || uploadPhase === 'error') && (
              <>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{ border: `1px dashed ${videoFile ? '#00aa00' : '#2a2a2a'}`, padding: '16px', textAlign: 'center', cursor: 'pointer', marginBottom: '14px', backgroundColor: '#080808' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = videoFile ? '#00ff00' : '#444444' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = videoFile ? '#00aa00' : '#2a2a2a' }}
                >
                  <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }}
                    onChange={e => setVideoFile(e.target.files?.[0] || null)} />
                  {videoFile ? (
                    <p style={{ color: '#00aa00', fontSize: '11px', margin: 0, letterSpacing: '1px' }}>
                      ✓ {videoFile.name}<br />
                      <span style={{ color: '#555555', fontSize: '10px' }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB</span>
                    </p>
                  ) : (
                    <p style={{ color: '#333333', fontSize: '11px', margin: 0, letterSpacing: '1px' }}>
                      CLIQUE PARA SELECIONAR O ARQUIVO MP4<br />
                      <span style={{ fontSize: '10px' }}>máx 2 GB</span>
                    </p>
                  )}
                </div>

                {/* Metadata confirmation table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: '14px' }}>
                  <tbody>
                    {[
                      ['TÍTULO',      analysis.optimizedTitle],
                      ['DESCRIÇÃO',   `${analysis.description.slice(0, 80)}...`],
                      ['TAGS',        `${analysis.tags.length} tags`],
                      ['HASHTAGS',    `${analysis.hashtags.length} hashtags`],
                      ['CATEGORIA',   'Music (10)'],
                      ['IDIOMA',      'Português'],
                      ['THUMBNAIL',   thumbDataUrl ? '✓ Thumbnail gerada (1280×720)' : '✗ Sem thumbnail personalizada'],
                    ].map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid #111111' }}>
                        <td style={{ color: '#444444', padding: '5px 8px', width: '120px', whiteSpace: 'nowrap', letterSpacing: '1px' }}>{k}</td>
                        <td style={{ color: '#707070', padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Schedule */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <span style={{ color: '#444444', fontSize: '10px', letterSpacing: '1px', flexShrink: 0 }}>AGENDAR PARA</span>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    style={{ backgroundColor: '#111111', border: '1px solid #2a2a2a', color: '#707070', fontSize: '11px', padding: '4px 8px', fontFamily: 'Courier New, monospace', outline: 'none', flex: 1 }}
                  />
                  {scheduledAt && (
                    <button onClick={() => setScheduledAt('')} style={{ ...retro, color: '#444', border: 'none' }}>✕</button>
                  )}
                </div>

                {/* Publish button */}
                <button
                  onClick={handleUpload}
                  disabled={!videoFile}
                  style={{
                    width: '100%', padding: '12px',
                    backgroundColor: videoFile ? '#00ff00' : '#111111',
                    color: videoFile ? '#000000' : '#333333',
                    border: videoFile ? 'none' : '1px solid #222222',
                    cursor: videoFile ? 'pointer' : 'not-allowed',
                    fontFamily: 'Courier New, monospace', fontSize: '13px',
                    fontWeight: 'bold', letterSpacing: '2px',
                  }}
                >
                  {scheduledAt ? '[ CONFIRMAR E AGENDAR ]' : '[ CONFIRMAR E PUBLICAR ]'}
                </button>

                {uploadPhase === 'error' && (
                  <p style={{ color: '#ff4400', fontSize: '10px', margin: '8px 0 0' }}>
                    ⚠ {uploadError}
                    {uploadError.includes('Permissão') && (
                      <span style={{ color: '#555555' }}><br />Faça logout em SETTINGS e conecte novamente para conceder acesso de upload.</span>
                    )}
                  </p>
                )}
              </>
            )}

            {/* Progress states */}
            {uploadPhase === 'sending' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ color: '#00ff00', fontSize: '12px', letterSpacing: '2px', margin: '0 0 8px' }}>
                  ENVIANDO ARQUIVO<span className="blink">_</span>
                </p>
                <p style={{ color: '#333333', fontSize: '10px', margin: 0 }}>aguardando servidor receber o arquivo...</p>
              </div>
            )}

            {uploadPhase === 'uploading' && (
              <div style={{ padding: '8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px' }}>ENVIANDO PARA YOUTUBE</span>
                  <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: 'bold' }}>{uploadProgress}%</span>
                </div>
                <div style={{ backgroundColor: '#111111', height: '8px', border: '1px solid #1a1a1a' }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', backgroundColor: '#00ff00', transition: 'width 0.3s' }} />
                </div>
                <p style={{ color: '#333333', fontSize: '10px', margin: '6px 0 0' }}>
                  {'█'.repeat(Math.floor(uploadProgress / 5))}{'░'.repeat(20 - Math.floor(uploadProgress / 5))} {uploadProgress}%
                </p>
              </div>
            )}

            {uploadPhase === 'processing' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ color: '#ffaa00', fontSize: '12px', letterSpacing: '2px', margin: '0 0 8px' }}>
                  YOUTUBE PROCESSANDO VÍDEO<span className="blink">_</span>
                </p>
                <p style={{ color: '#333333', fontSize: '10px', margin: 0 }}>pode levar alguns minutos...</p>
              </div>
            )}

            {uploadPhase === 'done' && uploadVideoId && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ color: '#00ff00', fontSize: '14px', fontWeight: 'bold', letterSpacing: '2px', margin: '0 0 10px' }}>
                  ✓ {scheduledAt ? 'AGENDADO COM SUCESSO' : 'PUBLICADO COM SUCESSO'}
                </p>
                <a
                  href={`https://youtu.be/${uploadVideoId}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#707070', fontSize: '12px', letterSpacing: '1px' }}
                >
                  youtu.be/{uploadVideoId} ↗
                </a>
                <div style={{ marginTop: '12px' }}>
                  <button
                    onClick={() => { setUploadPhase('idle'); setVideoFile(null); setUploadVideoId(null) }}
                    style={retro}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}
                  >
                    [ NOVO UPLOAD ]
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ══ INSTAGRAM REELS ══ */}
          <div style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <p style={{ color: '#e1306c', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
                ┌─ PUBLICAR NO INSTAGRAM · REELS
              </p>
              {igStatus?.authenticated && (
                <span style={{ color: '#555555', fontSize: '10px' }}>
                  @{igStatus.username}
                  {igStatus.daysLeft != null && (
                    <span style={{ color: igStatus.daysLeft < 10 ? '#ff6600' : '#333333', marginLeft: '8px' }}>
                      · token {igStatus.daysLeft}d
                    </span>
                  )}
                </span>
              )}
            </div>

            {/* Loading */}
            {igStatus === null && (
              <p style={{ color: '#333333', fontSize: '11px', letterSpacing: '2px' }}>VERIFICANDO<span className="blink">_</span></p>
            )}

            {/* Not connected */}
            {igStatus && !igStatus.authenticated && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ color: '#555555', fontSize: '10px', margin: '0 0 12px', letterSpacing: '1px' }}>
                  CONTA INSTAGRAM NÃO CONECTADA
                </p>
                <button
                  onClick={connectInstagram}
                  style={{ padding: '10px 24px', backgroundColor: '#e1306c', color: '#ffffff', border: 'none', cursor: 'pointer', fontFamily: 'Courier New, monospace', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}
                >[ CONECTAR INSTAGRAM ]</button>
                <p style={{ color: '#333333', fontSize: '10px', margin: '10px 0 0' }}>
                  Requer conta Instagram Business ligada a uma Facebook Page
                </p>
              </div>
            )}

            {/* Connected — idle or error */}
            {igStatus?.authenticated && (igPhase === 'idle' || igPhase === 'error') && (
              <>
                {igStatus.warning && (
                  <p style={{ color: '#ff6600', fontSize: '10px', margin: '0 0 10px' }}>⚠ {igStatus.warning}</p>
                )}

                {!videoFile && (
                  <p style={{ color: '#444444', fontSize: '10px', margin: '0 0 12px', letterSpacing: '1px' }}>
                    Seleciona o arquivo de vídeo na secção YouTube acima para publicar no Instagram.
                  </p>
                )}

                <div style={{ marginBottom: '10px' }}>
                  <p style={label10}>LEGENDA</p>
                  <textarea
                    value={igCaption}
                    onChange={e => setIgCaption(e.target.value)}
                    rows={3}
                    placeholder="Legenda do Reel..."
                    style={{ width: '100%', backgroundColor: '#111111', border: '1px solid #2a2a2a', color: '#c0c0c0', fontSize: '11px', padding: '8px', fontFamily: 'Courier New, monospace', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>

                {analysis.hashtags.length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    <p style={label10}>HASHTAGS (adicionadas automaticamente)</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {analysis.hashtags.map((h, i) => <Chip key={i} text={h} accent />)}
                    </div>
                  </div>
                )}

                <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '0 0 10px', lineHeight: '1.6' }}>
                  ⚠ O servidor precisa estar acessível publicamente (Railway) para o Instagram processar o vídeo.
                </p>

                <button
                  onClick={handleIgUpload}
                  disabled={!videoFile}
                  style={{
                    width: '100%', padding: '12px',
                    backgroundColor: videoFile ? '#e1306c' : '#1a1a1a',
                    color: videoFile ? '#ffffff' : '#333333',
                    border: videoFile ? 'none' : '1px solid #222222',
                    cursor: videoFile ? 'pointer' : 'not-allowed',
                    fontFamily: 'Courier New, monospace', fontSize: '13px',
                    fontWeight: 'bold', letterSpacing: '2px',
                  }}
                >[ PUBLICAR REEL NO INSTAGRAM ]</button>

                {igPhase === 'error' && (
                  <p style={{ color: '#ff4400', fontSize: '10px', margin: '8px 0 0' }}>⚠ {igError}</p>
                )}
              </>
            )}

            {/* Progress */}
            {igStatus?.authenticated && (igPhase === 'creating' || igPhase === 'processing' || igPhase === 'publishing') && (
              <div style={{ padding: '8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: '#e1306c', fontSize: '11px', letterSpacing: '1px' }}>
                    {igPhase === 'creating'   ? 'CRIANDO CONTAINER' :
                     igPhase === 'processing' ? 'INSTAGRAM PROCESSANDO' :
                     'PUBLICANDO REEL'}<span className="blink">_</span>
                  </span>
                  <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: 'bold' }}>{igProgress}%</span>
                </div>
                <div style={{ backgroundColor: '#111111', height: '8px', border: '1px solid #1a1a1a' }}>
                  <div style={{ width: `${igProgress}%`, height: '100%', backgroundColor: '#e1306c', transition: 'width 0.5s' }} />
                </div>
                {igPhase === 'processing' && (
                  <p style={{ color: '#333333', fontSize: '10px', margin: '6px 0 0' }}>
                    Instagram a processar o vídeo — pode demorar até 5 minutos...
                  </p>
                )}
              </div>
            )}

            {/* Done */}
            {igPhase === 'done' && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ color: '#e1306c', fontSize: '14px', fontWeight: 'bold', letterSpacing: '2px', margin: '0 0 10px' }}>
                  ✓ REEL PUBLICADO COM SUCESSO
                </p>
                {igPermalink && (
                  <a href={igPermalink} target="_blank" rel="noreferrer"
                     style={{ color: '#707070', fontSize: '12px', letterSpacing: '1px' }}>
                    ver no instagram ↗
                  </a>
                )}
                <div style={{ marginTop: '12px' }}>
                  <button
                    onClick={() => { setIgPhase('idle'); setIgPermalink(''); setIgError('') }}
                    style={retro}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}
                  >[ PUBLICAR OUTRO ]</button>
                </div>
              </div>
            )}
          </div>

          {/* ── RESET ── */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={() => { setStatus('idle'); setAnalysis(null); setStreamText(''); setBeatName(''); setThumbDataUrl(null); setUploadPhase('idle'); setVideoFile(null); setIgPhase('idle'); setIgProgress(0); setIgPermalink(''); setIgError('') }}
              style={retro}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}
            >
              [ ANALISAR OUTRO BEAT ]
            </button>
          </div>
        </>
      )}

      {/* ══ HISTÓRICO ══ */}
      <UploadHistory refreshKey={histRefreshKey} />

    </div>
  )
}

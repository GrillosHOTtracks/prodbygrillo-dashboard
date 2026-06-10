import { useState, useRef, useCallback, useEffect } from 'react'
import { ThumbnailBuilder } from '../components/scheduler/ThumbnailBuilder'
import { analyzeAudio } from '../lib/audioAnalysis'


// ─── Types ────────────────────────────────────────────────────────────────────
interface BeatAnalysis {
  seoScore: number
  bpm?: number
  key?: string
  titleAnalysis: { score: number; charCount: number; strengths: string[]; issues: string[]; alternatives: string[] }
  optimizedTitle: string
  description: string
  tags: string[]
  hashtags: string[]
  thumbnail: { concept: string; colors: string[]; mainText: string; subText: string; style: string }
  postingSchedule: { bestDay: string; bestTime: string; timezone: string; reasoning: string }
  trendingComparison: { matchingArtists: string[]; vibes: string[]; uniquenessScore: number; competitionLevel: string; suggestion: string }
}

interface UploadEntry {
  id: string; title: string; publishedAt: string
  status: 'scheduled' | 'live' | 'error'
  thumbnailUrl: string | null; videoUrl: string; views: number; uploadedAt: string
  isShort?: boolean
}

type AiStatus    = 'idle' | 'loading' | 'done' | 'error'
type UploadPhase = 'idle' | 'sending' | 'uploading' | 'processing' | 'done' | 'error'

// ─── Styles ───────────────────────────────────────────────────────────────────
const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '14px',
}
const dim: React.CSSProperties = { color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: '0 0 4px' }
const retro: React.CSSProperties = {
  background: 'transparent', border: '1px solid #333333', color: '#707070',
  fontSize: '10px', padding: '3px 10px', cursor: 'pointer',
  fontFamily: 'Courier New, monospace', letterSpacing: '1px',
}
const fieldStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#111111', border: '1px solid #2a2a2a',
  color: '#c0c0c0', fontSize: '12px', padding: '8px 10px',
  fontFamily: 'Courier New, monospace', outline: 'none', boxSizing: 'border-box',
}

// ─── Small components ─────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }) }}
      style={{ background: 'transparent', border: `1px solid ${ok ? '#00ff00' : '#333333'}`, color: ok ? '#00ff00' : '#555555', fontSize: '10px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '1px', flexShrink: 0 }}>
      {ok ? '✓ OK' : '[ CP ]'}
    </button>
  )
}

function ScoreBar({ score, label }: { score: number; label?: string }) {
  const color  = score >= 75 ? '#00ff00' : score >= 50 ? '#ffaa00' : '#ff4400'
  const filled = Math.round((score / 100) * 20)
  return (
    <div>
      {label && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px' }}>{label}</span>
        <span style={{ color, fontSize: '11px', fontWeight: 'bold' }}>{score}/100</span>
      </div>}
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

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepIndicator({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ['UPLOAD', 'ANÁLISE IA', 'PUBLICAÇÃO', 'CONCLUÍDO']
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '20px' }}>
      {steps.map((label, i) => {
        const n = i + 1 as 1|2|3|4
        const active = n === step
        const done   = n < step
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'flex-start', flex: i < 3 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
              <div style={{
                width: 28, height: 28, border: `2px solid ${done ? '#00ff00' : active ? '#00ff00' : '#2a2a2a'}`,
                backgroundColor: done ? '#00ff00' : active ? '#001a00' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontFamily: 'Courier New, monospace', fontWeight: 'bold',
                color: done ? '#000000' : active ? '#00ff00' : '#2a2a2a',
              }}>{done ? '✓' : n}</div>
              <span style={{ color: active ? '#00ff00' : done ? '#555555' : '#2a2a2a', fontSize: 9, letterSpacing: '1px', marginTop: 4, textAlign: 'center' }}>{label}</span>
            </div>
            {i < 3 && (
              <div style={{ flex: 1, height: 1, backgroundColor: done ? '#00ff00' : '#1a1a1a', marginTop: 14, marginLeft: 4, marginRight: 4 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Upload history ───────────────────────────────────────────────────────────
function UploadHistory({ refreshKey }: { refreshKey: number }) {
  const [history, setHistory]         = useState<UploadEntry[]>([])
  const [loading, setLoading]         = useState(false)
  const [refreshing, setRefreshing]   = useState(false)
  const [creatingShort, setCreatingShort] = useState<string | null>(null)
  const [shortMsg, setShortMsg]       = useState<Record<string, string>>({})
  const [autoStatus, setAutoStatus]   = useState<{ running: boolean; pending: number; msUntilNext: number; lastResult: any } | null>(null)

  async function load() {
    setLoading(true)
    try { const r = await fetch('/api/upload/history'); if (r.ok) setHistory(await r.json()) }
    finally { setLoading(false) }
  }
  async function refreshViews() {
    setRefreshing(true)
    try { const r = await fetch('/api/upload/history/refresh', { method: 'POST' }); if (r.ok) setHistory(await r.json()) }
    finally { setRefreshing(false) }
  }
  async function del(id: string) {
    await fetch(`/api/upload/history/${id}`, { method: 'DELETE' })
    setHistory(h => h.filter(e => e.id !== id))
  }
  async function createShort(e: UploadEntry) {
    if (creatingShort) return
    setCreatingShort(e.id)
    setShortMsg(m => ({ ...m, [e.id]: 'A descarregar...' }))
    try {
      const res = await fetch('/api/upload/create-short', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: e.id, title: e.title }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') break outer
          try {
            const evt = JSON.parse(payload)
            if (evt.status === 'DOWNLOADING') setShortMsg(m => ({ ...m, [e.id]: 'A descarregar vídeo...' }))
            if (evt.status === 'CUTTING')     setShortMsg(m => ({ ...m, [e.id]: 'A cortar short (59s)...' }))
            if (evt.status === 'UPLOADING')   setShortMsg(m => ({ ...m, [e.id]: 'A enviar para YouTube...' }))
            if (evt.status === 'DONE') {
              setShortMsg(m => ({ ...m, [e.id]: `✓ Short publicado` }))
              load()
            }
            if (evt.status === 'ERROR') setShortMsg(m => ({ ...m, [e.id]: `⚠ ${evt.error}` }))
          } catch {}
        }
      }
    } catch (err: any) {
      setShortMsg(m => ({ ...m, [e.id]: `⚠ ${err.message}` }))
    } finally {
      setCreatingShort(null)
    }
  }

  // Set of video IDs that already have a short in history
  const shortedIds = new Set(
    history
      .filter(e => e.isShort)
      .map(e => e.title.replace(/\s*#shorts\s*$/i, '').trim())
  )

  async function loadAutoStatus() {
    try {
      const r = await fetch('/api/upload/auto-shorts/status')
      if (r.ok) setAutoStatus(await r.json())
    } catch {}
  }
  async function runNow() {
    await fetch('/api/upload/auto-shorts/run-now', { method: 'POST' })
    setTimeout(loadAutoStatus, 1000)
  }
  function fmtCountdown(ms: number) {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return `${h}h ${m}m`
  }

  useEffect(() => { load(); loadAutoStatus() }, [refreshKey])
  useEffect(() => {
    const t = setInterval(loadAutoStatus, 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>┌─ HISTÓRICO DE UPLOADS ({history.length})</p>
        <button onClick={refreshViews} disabled={refreshing} style={retro}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}>
          {refreshing ? '[ ATUALIZANDO... ]' : '[ ATUALIZAR VIEWS ]'}
        </button>
      </div>
      {autoStatus && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', padding: '6px 10px', backgroundColor: '#080810', border: '1px solid #1a1a2a' }}>
          <span style={{ color: autoStatus.running ? '#44aaff' : autoStatus.pending > 0 ? '#ffaa00' : '#333', fontSize: '10px', letterSpacing: '1px' }}>
            {autoStatus.running ? '⟳ A CRIAR SHORT...' : autoStatus.pending > 0 ? `◌ ${autoStatus.pending} SHORT${autoStatus.pending > 1 ? 'S' : ''} PENDENTE${autoStatus.pending > 1 ? 'S' : ''}` : '✓ TODOS OS SHORTS CRIADOS'}
          </span>
          {!autoStatus.running && autoStatus.pending > 0 && (
            <span style={{ color: '#333', fontSize: '10px' }}>próximo em {fmtCountdown(autoStatus.msUntilNext)}</span>
          )}
          {autoStatus.lastResult && (
            <span style={{ color: autoStatus.lastResult.status === 'done' ? '#44aaff' : autoStatus.lastResult.status === 'error' ? '#ff4400' : '#333', fontSize: '10px' }}>
              {autoStatus.lastResult.status === 'done' ? `✓ último: ${autoStatus.lastResult.title}` : autoStatus.lastResult.status === 'error' ? `⚠ erro: ${autoStatus.lastResult.error}` : ''}
            </span>
          )}
          <button onClick={runNow} disabled={autoStatus.running || autoStatus.pending === 0}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #1a2a44', color: autoStatus.running || autoStatus.pending === 0 ? '#333' : '#44aaff', cursor: autoStatus.running || autoStatus.pending === 0 ? 'not-allowed' : 'pointer', fontSize: '9px', padding: '2px 8px', letterSpacing: '0.5px', fontFamily: 'Courier New, monospace' }}>
            EXECUTAR AGORA
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: '#333333', fontSize: '11px' }}>CARREGANDO<span className="blink">_</span></p>
      ) : history.length === 0 ? (
        <p style={{ color: '#333333', fontSize: '11px', letterSpacing: '1px' }}>*** NENHUM UPLOAD REALIZADO ***</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>{['THUMB','TÍTULO','DATA','STATUS','VIEWS','LINK','SHORT',''].map(h => (
                <th key={h} style={{ color: '#444444', fontSize: '10px', letterSpacing: '1px', textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #1a1a1a' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {history.map(e => {
                const hasShort = e.isShort || shortedIds.has(e.title.trim())
                const isProcessing = creatingShort === e.id
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #111111' }}>
                    <td style={{ padding: '6px 8px' }}>
                      {e.thumbnailUrl ? <img src={e.thumbnailUrl} alt="" style={{ width: 80, height: 45, objectFit: 'cover', border: '1px solid #1a1a1a' }} /> : <div style={{ width: 80, height: 45, background: '#111' }} />}
                    </td>
                    <td style={{ color: '#c0c0c0', padding: '6px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.isShort && <span style={{ color: '#ff6600', fontSize: '9px', border: '1px solid #ff6600', padding: '1px 4px', marginRight: '5px', letterSpacing: '1px' }}>SHORT</span>}
                      {e.title}
                    </td>
                    <td style={{ color: '#555555', padding: '6px 8px', whiteSpace: 'nowrap' }}>{new Date(e.publishedAt).toLocaleDateString('pt-BR')}</td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{ color: e.status === 'live' ? '#00ff00' : e.status === 'scheduled' ? '#ffaa00' : '#ff4400' }}>
                        {e.status === 'live' ? '● LIVE' : e.status === 'scheduled' ? '◌ AGENDADO' : '✕ ERRO'}
                      </span>
                    </td>
                    <td style={{ color: '#707070', padding: '6px 8px', textAlign: 'right' }}>{e.views.toLocaleString('pt-BR')}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <a href={e.videoUrl} target="_blank" rel="noreferrer" style={{ color: '#00aa00', fontSize: '11px', textDecoration: 'none' }}>▶ YT</a>
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', minWidth: 90 }}>
                      {!e.isShort && (
                        isProcessing ? (
                          <span style={{ color: '#44aaff', fontSize: '9px', letterSpacing: '0.5px' }}>{shortMsg[e.id] || '...'}</span>
                        ) : shortMsg[e.id]?.startsWith('✓') ? (
                          <span style={{ color: '#44aaff', fontSize: '9px' }}>{shortMsg[e.id]}</span>
                        ) : hasShort ? (
                          <span style={{ color: '#333', fontSize: '9px', letterSpacing: '0.5px' }}>✓ tem short</span>
                        ) : (
                          <button onClick={() => createShort(e)} disabled={!!creatingShort}
                            style={{ background: 'transparent', border: '1px solid #1a2a44', color: '#44aaff', cursor: creatingShort ? 'not-allowed' : 'pointer', fontSize: '9px', padding: '2px 6px', letterSpacing: '0.5px', fontFamily: 'Courier New, monospace', opacity: creatingShort ? 0.4 : 1 }}>
                            + SHORT
                          </button>
                        )
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <button onClick={() => del(e.id)} style={{ background: 'transparent', border: 'none', color: '#333333', cursor: 'pointer', fontSize: '12px' }}
                        onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.color = '#ff4400' }}
                        onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.color = '#333333' }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function Scheduler() {
  const [step, setStep] = useState<1|2|3|4>(1)

  // ── Etapa 1: files
  const [videoFile, setVideoFile]       = useState<File | null>(null)
  const [thumbFile, setThumbFile]       = useState<File | null>(null)
  const [thumbPreview, setThumbPreview] = useState<string | null>(null)
  const [beatName, setBeatName]         = useState('')
  const videoInputRef                   = useRef<HTMLInputElement>(null)
  const thumbInputRef                   = useRef<HTMLInputElement>(null)

  // ── Etapa 2: AI analysis
  const [aiStatus, setAiStatus]     = useState<AiStatus>('idle')
  const [streamText, setStreamText] = useState('')
  const [analysis, setAnalysis]     = useState<BeatAnalysis | null>(null)
  const [aiError, setAiError]       = useState('')
  const terminalRef                 = useRef<HTMLDivElement>(null)

  // ── Editable fields (populated from analysis, editable by user)
  const [editTitle, setEditTitle]         = useState('')
  const [editDesc, setEditDesc]           = useState('')
  const [editTags, setEditTags]           = useState('')
  const [editHashtags, setEditHashtags]   = useState('')
  const [scheduledAt, setScheduledAt]     = useState('')

  // ── Thumbnail
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null)

  // ── Etapa 3: YouTube upload
  const [uploadPhase, setUploadPhase]       = useState<UploadPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadVideoId, setUploadVideoId]   = useState<string | null>(null)
  const [uploadError, setUploadError]       = useState('')
  const [publishShort, setPublishShort]     = useState(true)
  const [shortStatus, setShortStatus]       = useState<'idle'|'cutting'|'uploading'|'done'|'error'>('idle')
  const [shortVideoId, setShortVideoId]     = useState<string | null>(null)

  // ── Audio detection
  const [audioStatus, setAudioStatus] = useState<'idle' | 'detecting' | 'done' | 'error'>('idle')
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null)
  const [detectedKey, setDetectedKey] = useState<string | null>(null)
  const [mainArtist, setMainArtist]   = useState<string | null>(null)

  // ── History
  const [histRefreshKey, setHistRefreshKey] = useState(0)

  // ── Agenda integration
  const [plannedBeats, setPlannedBeats]         = useState<{ id: string; date: string; anchorArtist: string; beatName: string; secondaryArtist: string; filenameTemplate: string }[]>([])
  const [selectedPlanId, setSelectedPlanId]     = useState<string | null>(null)
  const [plannedSecondary, setPlannedSecondary] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/schedule')
      .then(r => r.ok ? r.json() : [])
      .then((data: { id: string; date: string; anchorArtist: string; beatName: string; secondaryArtist: string; filenameTemplate: string; status: string }[]) =>
        setPlannedBeats(data.filter(e => e.status === 'planned').sort((a, b) => a.date.localeCompare(b.date)))
      )
      .catch(() => {})
  }, [])

  // ── Published links (etapa 4)
  const [publishedYt, setPublishedYt] = useState<string | null>(null)

  // ── Thumbnail AI prompt
  const [thumbPrompt, setThumbPrompt]               = useState('')
  const [thumbPromptLoading, setThumbPromptLoading] = useState(false)

  // Parse filename to extract clean beat name, BPM, and key.
  // Handles patterns like: "YT [FREE] Hurricane Wisdom Type Beat 2026 - My Truth 176bpm F MAJOR.mp4"
  function parseFilename(filename: string): { beatName: string; mainArtist: string | null; bpm: number | null; key: string | null } {
    let raw = filename.replace(/\.[^.]+$/, '') // remove extension

    // Extract BPM: "176bpm", "176 BPM", "176 bpm"
    let bpm: number | null = null
    const bpmMatch = raw.match(/\b(\d{2,3})\s*bpm\b/i)
    if (bpmMatch) {
      const v = parseInt(bpmMatch[1])
      if (v >= 60 && v <= 300) { bpm = v; raw = raw.replace(bpmMatch[0], ' ') }
    }

    // Extract key: "F MAJOR", "F# Minor", "Am", "C#m", "FM", "Fm"
    let key: string | null = null
    const keyPatterns: RegExp[] = [
      /\b([A-G][#b]?)\s+(major|minor)\b/i,
      /\b([A-G][#b]?)\s+(maj|min)\b/i,
      /\b([A-G][#b])(m)\b/,     // Am, C#m — lowercase m = minor
      /\b([A-G][#b]?)(M)\b/,    // CM, FM — uppercase M = major
    ]
    for (const pat of keyPatterns) {
      const m = raw.match(pat)
      if (m) {
        const note = m[1]
        const modeStr = m[2]
        const isMinor = /^(minor|min|m)$/i.test(modeStr) && modeStr !== 'M'
        key = `${note} ${isMinor ? 'Minor' : 'Major'}`
        raw = raw.replace(m[0], ' ')
        break
      }
    }

    raw = raw.replace(/\s+/g, ' ').trim()

    const NOISE = (s: string) => s
      .replace(/\[?free\]?/gi, '')
      .replace(/\byt\b/gi, '')
      .replace(/\btype\s+beat\b/gi, '')
      .replace(/\b20\d\d\b/g, '')
      .replace(/^[-\s]+|[-\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    // Split on " - ": part before = artist reference, part after = beat name
    const dashParts = raw.split(' - ')
    let beatName: string
    let mainArtist: string | null = null

    if (dashParts.length > 1) {
      beatName   = NOISE(dashParts[dashParts.length - 1])
      mainArtist = NOISE(dashParts.slice(0, -1).join(' - ')) || null
    } else {
      beatName = NOISE(raw)
    }

    if (!beatName) beatName = NOISE(raw) || raw

    return { beatName, mainArtist, bpm, key }
  }

  // Handle video selection — extract beat name + start audio detection
  async function onVideoSelect(file: File) {
    setVideoFile(file)

    const { beatName: parsedName, mainArtist: parsedArtist, bpm: parsedBpm, key: parsedKey } = parseFilename(file.name)
    // Keep plan values if one is selected — only update from filename if no plan is active
    if (!selectedPlanId) setBeatName(parsedName)
    if (!selectedPlanId) setMainArtist(parsedArtist)

    // Apply filename values immediately — producer named the file correctly
    setDetectedBpm(parsedBpm)
    setDetectedKey(parsedKey)
    setAudioStatus('detecting')

    try {
      const result = await analyzeAudio(file)
      // Filename values win; audio fills only what the filename didn't have
      setDetectedBpm(parsedBpm !== null ? parsedBpm : result.bpm)
      setDetectedKey(parsedKey !== null ? parsedKey : result.key)
      setAudioStatus('done')
    } catch {
      // Keep filename values if available, otherwise mark error
      setAudioStatus(parsedBpm !== null || parsedKey !== null ? 'done' : 'error')
    }
  }

  // Auto-trigger AI analysis once audio detection finishes
  useEffect(() => {
    if ((audioStatus === 'done' || audioStatus === 'error') && beatName.trim() && aiStatus === 'idle') {
      analyze(beatName.trim(), detectedBpm, detectedKey, mainArtist, plannedSecondary)
    }
  }, [audioStatus]) // eslint-disable-line

  // Handle thumbnail selection
  function onThumbSelect(file: File) {
    setThumbFile(file)
    const reader = new FileReader()
    reader.onload = e => {
      const url = e.target?.result as string
      setThumbPreview(url)
      setThumbDataUrl(url)
    }
    reader.readAsDataURL(file)
  }

  // ── AI Analysis
  const analyze = useCallback(async (name: string, bpm: number | null = null, key: string | null = null, artist: string | null = null, secondary: string | null = null) => {
    if (!name.trim() || aiStatus === 'loading') return
    setAiStatus('loading')
    setStreamText('')
    setAnalysis(null)
    setAiError('')
    setThumbDataUrl(thumbFile ? thumbPreview : null)
    setStep(2)

    try {
      const res = await fetch('/api/ai/analyze-beat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beatName: name, bpm, key, mainArtist: artist, secondaryArtist: secondary }),
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
            try {
              const parsed = JSON.parse(jsonBuf.trim()) as BeatAnalysis
              setAnalysis(parsed)
              setEditTitle(parsed.optimizedTitle)
              setEditDesc(parsed.description)
              setEditTags(parsed.tags.join(', '))
              setEditHashtags(parsed.hashtags.join(' '))
              setAiStatus('done')
              setStep(3)
            } catch { throw new Error('Resposta da IA inválida — tenta novamente.') }
            break outer
          }
          try {
            const evt = JSON.parse(payload)
            if (evt.error) throw new Error(evt.error)
            if (evt.text) {
              jsonBuf += evt.text
              setStreamText(jsonBuf)
              if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight
            }
          } catch (e) { if (!(e instanceof SyntaxError)) throw e }
        }
      }
    } catch (err: any) { setAiError(err.message); setAiStatus('error') }
  }, [aiStatus, thumbFile, thumbPreview])

  // ── YouTube upload
  const handleUpload = useCallback(async () => {
    if (!videoFile || !analysis || uploadPhase !== 'idle') return
    setUploadPhase('sending')
    setUploadProgress(0)
    setUploadError('')
    setUploadVideoId(null)

    const tags     = editTags.split(',').map(t => t.trim()).filter(Boolean)
    const hashtags = editHashtags.split(/\s+/).filter(t => t.startsWith('#'))

    try {
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('meta', JSON.stringify({
        title:            editTitle,
        description:      editDesc + (hashtags.length ? '\n\n' + hashtags.join(' ') : ''),
        tags,
        thumbnailDataUrl: thumbDataUrl,
        scheduledAt:      scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        publishShort,
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
            if (evt.status === 'UPLOADING')  setUploadProgress(evt.progress)
            if (evt.status === 'PROCESSING') setUploadPhase('processing')
            if (evt.status === 'LIVE' || evt.status === 'SCHEDULED') {
              setUploadPhase('done')
              setUploadVideoId(evt.videoId)
              setPublishedYt(`https://youtu.be/${evt.videoId}`)
              setHistRefreshKey(k => k + 1)
              setStep(4)
              // Mark planned beat as posted
              if (selectedPlanId) {
                fetch(`/api/schedule/${selectedPlanId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'posted' }),
                }).catch(() => {})
                setPlannedBeats(p => p.filter(e => e.id !== selectedPlanId))
                setSelectedPlanId(null)
              }
            }
            if (evt.status === 'SHORT_CUTTING')   setShortStatus('cutting')
            if (evt.status === 'SHORT_UPLOADING') setShortStatus('uploading')
            if (evt.status === 'SHORT_DONE') {
              setShortStatus('done')
              setShortVideoId(evt.shortVideoId)
              setHistRefreshKey(k => k + 1)
            }
            if (evt.status === 'SHORT_ERROR') setShortStatus('error')
            if (evt.status === 'ERROR') throw new Error(evt.error || 'Upload failed')
          } catch (e) { if (!(e instanceof SyntaxError)) throw e }
        }
      }
    } catch (err: any) { setUploadError(err.message); setUploadPhase('error') }
  }, [videoFile, analysis, editTitle, editDesc, editTags, editHashtags, thumbDataUrl, scheduledAt, uploadPhase, publishShort, selectedPlanId])

  // ── Thumbnail AI prompt generator
  const generateThumbPrompt = useCallback(async () => {
    if (!analysis) return
    setThumbPromptLoading(true)
    setThumbPrompt('')
    const artists = analysis.trendingComparison.matchingArtists.slice(0, 3).join(', ')
    const vibes   = analysis.trendingComparison.vibes.join(', ')
    const colors  = analysis.thumbnail.colors.join(', ')
    const msg = `You are a visual art director for music YouTube thumbnails. Generate a detailed Midjourney prompt for a beat named "${beatName}". BPM: ${detectedBpm ?? analysis.bpm ?? '?'}, Key: ${detectedKey ?? analysis.key ?? '?'}, Artists: ${artists}, Vibes: ${vibes}. Thumbnail text: "${analysis.thumbnail.mainText}". Aesthetic: cyberpunk, neon green chrome, dark futuristic, opium trap, metallic surfaces, glowing neon. Colors: ${colors}. Output ONLY the Midjourney prompt, nothing else. End with --ar 16:9 --style raw --q 2`
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: msg }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let rawBuf = '', full = ''
      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        rawBuf += decoder.decode(value, { stream: true })
        const lines = rawBuf.split('\n')
        rawBuf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') break outer
          try { const evt = JSON.parse(payload); if (evt.text) { full += evt.text; setThumbPrompt(full) } } catch {}
        }
      }
    } catch (err: any) { setThumbPrompt(`Erro: ${err.message}`) }
    finally { setThumbPromptLoading(false) }
  }, [analysis, beatName, detectedBpm, detectedKey])

  // ── Full reset
  function reset() {
    setStep(1); setVideoFile(null); setThumbFile(null); setThumbPreview(null); setBeatName('')
    setAiStatus('idle'); setStreamText(''); setAnalysis(null); setAiError('')
    setAudioStatus('idle'); setDetectedBpm(null); setDetectedKey(null); setMainArtist(null)
    setEditTitle(''); setEditDesc(''); setEditTags(''); setEditHashtags(''); setScheduledAt('')
    setThumbDataUrl(null); setUploadPhase('idle'); setUploadVideoId(null); setUploadError('')
    setShortStatus('idle'); setShortVideoId(null); setSelectedPlanId(null); setPlannedSecondary(null)
    setPublishedYt(null)
    setThumbPrompt(''); setThumbPromptLoading(false)
  }

  const showResults = aiStatus === 'done' && analysis !== null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.8 }}>
        ┌─ AI BEAT SCHEDULER · PRODBYGRILLO ─────────────────────────
      </p>

      <StepIndicator step={step} />

      {/* ══════════════════════════════════════════════════════════
          ETAPA 1 — UPLOAD
      ══════════════════════════════════════════════════════════ */}
      <div style={panel}>
        <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 14px', opacity: 0.8 }}>
          ┌─ ETAPA 1 · UPLOAD DO BEAT ───────────────────────────────
        </p>

        {/* Planned beats selector */}
        {plannedBeats.length > 0 && (
          <div style={{ marginBottom: '14px', padding: '10px', border: '1px solid #2a1a44', backgroundColor: '#0d0818' }}>
            <p style={{ color: '#cc88ff', fontSize: '10px', letterSpacing: '1px', margin: '0 0 8px' }}>◈ BEATS PLANEADOS NA AGENDA</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {plannedBeats.slice(0, 7).map(plan => (
                <button
                  key={plan.id}
                  onClick={() => {
                    if (selectedPlanId === plan.id) {
                      setSelectedPlanId(null)
                      setBeatName('')
                      setMainArtist(null)
                      setPlannedSecondary(null)
                    } else {
                      setSelectedPlanId(plan.id)
                      setBeatName(plan.beatName)
                      setMainArtist(plan.anchorArtist)
                      setPlannedSecondary(plan.secondaryArtist)
                    }
                  }}
                  style={{
                    background: selectedPlanId === plan.id ? '#2a1a44' : 'transparent',
                    border: `1px solid ${selectedPlanId === plan.id ? '#cc88ff' : '#2a1a44'}`,
                    color: selectedPlanId === plan.id ? '#cc88ff' : '#666',
                    cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '10px', padding: '3px 10px', letterSpacing: '0.5px',
                  }}
                >
                  {plan.date.slice(5)} · "{plan.beatName}"
                </button>
              ))}
            </div>
            {selectedPlanId && (
              <p style={{ color: '#5a3a77', fontSize: '9px', margin: '6px 0 0', letterSpacing: '0.5px' }}>
                ◈ Selecionado — será marcado como feito após publicar
              </p>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>

          {/* Video drop zone */}
          <div>
            <p style={dim}>ARQUIVO DE VÍDEO · MP4 / MOV · obrigatório</p>
            <div
              onClick={() => { if (aiStatus !== 'loading') videoInputRef.current?.click() }}
              style={{
                border: `2px dashed ${videoFile ? '#00aa00' : '#2a2a2a'}`,
                padding: '28px 16px', textAlign: 'center', cursor: aiStatus === 'loading' ? 'default' : 'pointer',
                backgroundColor: '#080808', transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => { if (aiStatus !== 'loading') (e.currentTarget as HTMLElement).style.borderColor = videoFile ? '#00ff00' : '#444444' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = videoFile ? '#00aa00' : '#2a2a2a' }}
            >
              <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onVideoSelect(f) }} />
              {videoFile ? (
                <>
                  <p style={{ color: '#00ff00', fontSize: '13px', margin: '0 0 4px', fontWeight: 'bold' }}>✓ {videoFile.name}</p>
                  <p style={{ color: '#444444', fontSize: '10px', margin: 0 }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                </>
              ) : (
                <>
                  <p style={{ color: '#333333', fontSize: '24px', margin: '0 0 8px', lineHeight: 1 }}>▶</p>
                  <p style={{ color: '#444444', fontSize: '11px', margin: '0 0 4px', letterSpacing: '1px' }}>CLIQUE PARA SELECIONAR O VÍDEO</p>
                  <p style={{ color: '#2a2a2a', fontSize: '10px', margin: 0 }}>MP4 ou MOV · máx 2 GB</p>
                </>
              )}
            </div>

            {/* Beat name */}
            {videoFile && (
              <div style={{ marginTop: '10px' }}>
                <p style={dim}>NOME DO BEAT · extraído automaticamente · editável</p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#00ff00', fontSize: '13px', flexShrink: 0 }}>&gt;</span>
                  <input
                    value={beatName}
                    onChange={e => setBeatName(e.target.value)}
                    disabled={aiStatus === 'loading'}
                    style={{ ...fieldStyle, borderBottom: '2px solid #00ff00' }}
                  />
                  {aiStatus === 'idle' && beatName.trim() && (
                    <button onClick={() => analyze(beatName.trim(), detectedBpm, detectedKey, mainArtist, plannedSecondary)} style={{ ...retro, color: '#00ff00', border: '1px solid #00ff00', flexShrink: 0, padding: '6px 12px' }}>[ RE-ANALISAR ]</button>
                  )}
                </div>
                {audioStatus === 'detecting' && (
                  <p style={{ color: '#ffaa00', fontSize: '10px', margin: '6px 0 0', letterSpacing: '1px' }}>
                    ● DETECTANDO BPM/KEY<span className="blink">_</span>
                  </p>
                )}
                {audioStatus === 'done' && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ color: '#00ff00', fontSize: '10px', letterSpacing: '1px' }}>● ÁUDIO DETECTADO · editável</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#444', fontSize: '10px', letterSpacing: '1px' }}>BPM</span>
                        <input
                          type="number"
                          value={detectedBpm ?? ''}
                          onChange={e => setDetectedBpm(e.target.value ? parseInt(e.target.value) : null)}
                          style={{ width: 60, backgroundColor: '#0a0a0a', border: '1px solid #1a3a1a', color: '#00ff00', fontSize: '11px', padding: '2px 6px', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}
                          min={60} max={300}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#444', fontSize: '10px', letterSpacing: '1px' }}>TOM</span>
                        <select
                          value={detectedKey ?? ''}
                          onChange={e => setDetectedKey(e.target.value || null)}
                          style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a3a1a', color: '#00ff00', fontSize: '11px', padding: '2px 4px', fontFamily: 'JetBrains Mono, monospace' }}
                        >
                          <option value="">--</option>
                          {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].flatMap(n => [
                            <option key={n+'M'} value={`${n} Major`}>{n} Major</option>,
                            <option key={n+'m'} value={`${n} Minor`}>{n} Minor</option>,
                          ])}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
                {audioStatus === 'error' && (
                  <p style={{ color: '#444444', fontSize: '10px', margin: '6px 0 0', letterSpacing: '1px' }}>
                    ● BPM/KEY não detectado — continua sem dados
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Thumbnail */}
          <div>
            <p style={dim}>THUMBNAIL · JPG / PNG · opcional</p>
            <div
              onClick={() => thumbInputRef.current?.click()}
              style={{
                border: `2px dashed ${thumbFile ? '#00aa00' : '#2a2a2a'}`,
                aspectRatio: '16/9', cursor: 'pointer', backgroundColor: '#080808',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', transition: 'border-color 0.2s', position: 'relative',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = thumbFile ? '#00ff00' : '#444444' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = thumbFile ? '#00aa00' : '#2a2a2a' }}
            >
              <input ref={thumbInputRef} type="file" accept="image/jpeg,image/png,image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onThumbSelect(f) }} />
              {thumbPreview ? (
                <img src={thumbPreview} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: '#2a2a2a', fontSize: '20px', margin: '0 0 6px' }}>▣</p>
                  <p style={{ color: '#2a2a2a', fontSize: '10px', margin: 0, letterSpacing: '1px' }}>THUMBNAIL<br />OPCIONAL</p>
                </div>
              )}
              {!thumbFile && showResults && (
                <div style={{ position: 'absolute', bottom: 4, right: 6 }}>
                  <span style={{ color: '#00aa00', fontSize: '9px', letterSpacing: '1px', backgroundColor: '#0a1a0a', padding: '2px 5px', border: '1px solid #1a3a1a' }}>AUTO ✓</span>
                </div>
              )}
            </div>
            {thumbFile && (
              <button onClick={() => { setThumbFile(null); setThumbPreview(null); setThumbDataUrl(null) }}
                style={{ ...retro, marginTop: 6, fontSize: 10 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff4400' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}>
                [ REMOVER THUMBNAIL ]
              </button>
            )}
            {!thumbFile && (
              <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '6px 0 0', letterSpacing: '1px' }}>
                Se não enviares, a LAIS gera uma automaticamente
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          ETAPA 2 — ANÁLISE IA
      ══════════════════════════════════════════════════════════ */}
      {(aiStatus === 'loading' || aiStatus === 'done' || aiStatus === 'error') && (
        <div style={panel}>
          <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px', opacity: 0.8 }}>
            ┌─ ETAPA 2 · LAIS A ANALISAR · {aiStatus === 'loading' ? 'PROCESSANDO...' : aiStatus === 'done' ? 'COMPLETO ✓' : 'ERRO'}
          </p>

          {streamText && (
            <div ref={terminalRef} style={{
              backgroundColor: '#060606', border: '1px solid #1a1a1a', padding: '8px 10px',
              maxHeight: aiStatus === 'loading' ? '160px' : '48px',
              overflowY: 'auto', fontFamily: 'Courier New, monospace', fontSize: '9px',
              color: '#1e5c1e', lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              transition: 'max-height 0.6s', marginBottom: '14px',
            }}>
              {streamText}
              {aiStatus === 'loading' && <span className="blink" style={{ color: '#00ff00' }}>█</span>}
            </div>
          )}

          {aiStatus === 'error' && (
            <div>
              <p style={{ color: '#ff4400', fontSize: '11px', margin: '0 0 8px' }}>⚠ {aiError}</p>
              <button onClick={() => analyze(beatName.trim(), detectedBpm, detectedKey, mainArtist, plannedSecondary)} style={{ ...retro, color: '#ff6600', border: '1px solid #333333' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#ff6600' }}>
                [ TENTAR NOVAMENTE ]
              </button>
            </div>
          )}

          {showResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* SEO score */}
              <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap', padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
                <div style={{ flex: 1, minWidth: 200 }}><ScoreBar score={analysis!.seoScore} label="SEO SCORE GLOBAL" /></div>
                {[{ l: 'TÍTULO', v: analysis!.titleAnalysis.score }, { l: 'UNICIDADE', v: analysis!.trendingComparison.uniquenessScore }].map(({ l, v }) => (
                  <div key={l}>
                    <p style={dim}>{l}</p>
                    <p style={{ color: v >= 75 ? '#00ff00' : v >= 50 ? '#ffaa00' : '#ff4400', fontSize: '22px', fontWeight: 'bold', margin: 0 }}>{v}</p>
                  </div>
                ))}
                <div>
                  <p style={dim}>COMPETIÇÃO</p>
                  <p style={{ color: analysis!.trendingComparison.competitionLevel === 'low' ? '#00ff00' : analysis!.trendingComparison.competitionLevel === 'medium' ? '#ffaa00' : '#ff4400', fontSize: '22px', fontWeight: 'bold', margin: 0, textTransform: 'uppercase' }}>
                    {analysis!.trendingComparison.competitionLevel}
                  </p>
                </div>
                {analysis!.bpm && (
                  <div style={{ textAlign: 'center' }}>
                    <p style={dim}>BPM</p>
                    <p style={{ color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: 0 }}>{analysis!.bpm}</p>
                  </div>
                )}
                {analysis!.key && (
                  <div style={{ textAlign: 'center' }}>
                    <p style={dim}>KEY</p>
                    <p style={{ color: '#00ff00', fontSize: '22px', fontWeight: 'bold', margin: 0 }}>{analysis!.key}</p>
                  </div>
                )}
                <div style={{ textAlign: 'center' }}>
                  <p style={dim}>MELHOR HORÁRIO</p>
                  <p style={{ color: '#00ff00', fontSize: '13px', fontWeight: 'bold', margin: 0 }}>{analysis!.postingSchedule.bestDay.toUpperCase()}</p>
                  <p style={{ color: '#ffffff', fontSize: '22px', fontWeight: 'bold', margin: 0 }}>{analysis!.postingSchedule.bestTime}</p>
                  <p style={{ color: '#333333', fontSize: '10px', margin: 0 }}>{analysis!.postingSchedule.timezone}</p>
                </div>
              </div>

              {/* Editable title */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <p style={dim}>TÍTULO OTIMIZADO · editável</p>
                  <CopyBtn text={editTitle} />
                </div>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={{ ...fieldStyle, fontSize: '13px', fontWeight: 'bold', borderColor: '#333333' }} />
                <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '3px 0 0' }}>
                  {editTitle.length} chars{editTitle.length > 100 ? <span style={{ color: '#ff6600' }}> · ⚠ muito longo</span> : editTitle.length > 70 ? <span style={{ color: '#ffaa00' }}> · acima do ideal</span> : <span style={{ color: '#333333' }}> · ✓ ok</span>}
                </p>
              </div>

              {/* Editable description */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <p style={dim}>DESCRIÇÃO · editável</p>
                  <CopyBtn text={editDesc} />
                </div>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={6}
                  style={{ ...fieldStyle, resize: 'vertical', lineHeight: '1.6', fontSize: '11px' }} />
              </div>

              {/* Tags + Hashtags */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <p style={dim}>TAGS · separadas por vírgula · editável</p>
                    <CopyBtn text={editTags} />
                  </div>
                  <textarea value={editTags} onChange={e => setEditTags(e.target.value)} rows={4}
                    style={{ ...fieldStyle, resize: 'vertical', fontSize: '10px' }} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                    {editTags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8).map((t, i) => (
                      <span key={i} style={{ backgroundColor: '#111111', border: '1px solid #222222', color: '#555555', fontSize: '9px', padding: '1px 6px' }}>{t}</span>
                    ))}
                    {editTags.split(',').length > 8 && <span style={{ color: '#333333', fontSize: '9px' }}>+{editTags.split(',').length - 8}</span>}
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <p style={dim}>HASHTAGS · separadas por espaço · editável</p>
                    <CopyBtn text={editHashtags} />
                  </div>
                  <textarea value={editHashtags} onChange={e => setEditHashtags(e.target.value)} rows={4}
                    style={{ ...fieldStyle, resize: 'vertical', fontSize: '10px' }} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                    {editHashtags.split(/\s+/).filter(t => t.startsWith('#')).map((t, i) => <Chip key={i} text={t} accent />)}
                  </div>
                </div>
              </div>

              {/* Thumbnail */}
              {!thumbFile && (
                <ThumbnailBuilder
                  beatName={beatName}
                  artists={analysis!.trendingComparison.matchingArtists}
                  onReady={setThumbDataUrl}
                />
              )}

              {/* Thumbnail AI prompt */}
              <div style={{ border: '1px solid #1a1a1a', backgroundColor: '#080808', padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <p style={{ ...dim, margin: 0 }}>THUMBNAIL AI · PROMPT MIDJOURNEY / FLUX</p>
                  <button
                    onClick={generateThumbPrompt}
                    disabled={thumbPromptLoading}
                    style={{ ...retro, color: thumbPromptLoading ? '#333333' : '#00aa00', border: `1px solid ${thumbPromptLoading ? '#222222' : '#1a3a1a'}`, padding: '4px 12px' }}
                    onMouseEnter={e => { if (!thumbPromptLoading) { (e.currentTarget as HTMLElement).style.color = '#00ff00'; (e.currentTarget as HTMLElement).style.borderColor = '#00aa00' } }}
                    onMouseLeave={e => { if (!thumbPromptLoading) { (e.currentTarget as HTMLElement).style.color = '#00aa00'; (e.currentTarget as HTMLElement).style.borderColor = '#1a3a1a' } }}
                  >
                    {thumbPromptLoading ? '[ GERANDO... ]' : '[ GERAR THUMBNAIL AI ]'}
                  </button>
                </div>
                {thumbPrompt ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <pre style={{ flex: 1, color: '#00cc00', fontSize: '10px', lineHeight: '1.6', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#050505', border: '1px solid #1a3a1a', padding: '8px' }}>
                      {thumbPrompt}
                    </pre>
                    <CopyBtn text={thumbPrompt} />
                  </div>
                ) : (
                  <p style={{ color: '#2a2a2a', fontSize: '10px', margin: 0, letterSpacing: '1px' }}>
                    Clique para gerar prompt cyberpunk/neon para Midjourney ou Flux
                  </p>
                )}
              </div>

              {/* Artistas + vibes */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
                  <p style={{ ...dim, marginBottom: '8px' }}>ARTISTAS COMPATÍVEIS</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {analysis!.trendingComparison.matchingArtists.map((a, i) => (
                      <span key={i} style={{ border: `1px solid ${i === 0 ? '#555555' : '#222222'}`, color: i === 0 ? '#c0c0c0' : '#444444', fontSize: '10px', padding: '2px 8px' }}>
                        {i === 0 ? '★ ' : ''}{a}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ padding: '10px', backgroundColor: '#080808', border: '1px solid #1a1a1a' }}>
                  <p style={{ ...dim, marginBottom: '8px' }}>VIBES DETECTADAS</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    {analysis!.trendingComparison.vibes.map((v, i) => <Chip key={i} text={v} accent />)}
                  </div>
                  <p style={{ color: '#444444', fontSize: '10px', lineHeight: '1.5', margin: 0 }}>{analysis!.trendingComparison.suggestion}</p>
                </div>
              </div>

              {/* Re-analyze button */}
              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={() => analyze(beatName.trim(), detectedBpm, detectedKey, mainArtist, plannedSecondary)}
                  style={{ ...retro, color: '#00aa00', border: '1px solid #1a3a1a', padding: '8px 20px', fontSize: '11px' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ff00'; (e.currentTarget as HTMLElement).style.borderColor = '#00aa00' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#00aa00'; (e.currentTarget as HTMLElement).style.borderColor = '#1a3a1a' }}
                >
                  [ ANALISAR NOVAMENTE — GERAR NOVOS TÍTULOS ]
                </button>
                <p style={{ color: '#2a2a2a', fontSize: '9px', margin: '4px 0 0', letterSpacing: '1px' }}>IA usa ângulo diferente a cada análise · nunca repete</p>
              </div>

            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          ETAPA 3 — PUBLICAÇÃO
      ══════════════════════════════════════════════════════════ */}
      {showResults && (
        <>
          {/* ── YouTube ── */}
          <div style={panel}>
            <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px', opacity: 0.8 }}>
              ┌─ ETAPA 3 · PUBLICAR NO YOUTUBE ──────────────────────
            </p>

            {(uploadPhase === 'idle' || uploadPhase === 'error') && (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: '14px' }}>
                  <tbody>
                    {[
                      ['TÍTULO',    editTitle],
                      ['TAGS',      `${editTags.split(',').filter(t => t.trim()).length} tags`],
                      ['HASHTAGS',  `${editHashtags.split(/\s+/).filter(t => t.startsWith('#')).length} hashtags`],
                      ['THUMBNAIL', thumbDataUrl ? '✓ Pronta (1280×720)' : '✗ Sem thumbnail'],
                    ].map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid #111111' }}>
                        <td style={{ color: '#444444', padding: '5px 8px', width: '110px', whiteSpace: 'nowrap', letterSpacing: '1px' }}>{k}</td>
                        <td style={{ color: '#707070', padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <span style={dim}>AGENDAR PARA</span>
                  <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)}
                    style={{ ...fieldStyle, width: 'auto', flex: 1 }} />
                  {scheduledAt && <button onClick={() => setScheduledAt('')} style={{ ...retro, border: 'none', color: '#444' }}>✕</button>}
                </div>

                {/* Short toggle */}
                <div
                  onClick={() => setPublishShort(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', cursor: 'pointer', userSelect: 'none' }}
                >
                  <div style={{
                    width: 14, height: 14, border: `1px solid ${publishShort ? '#44aaff' : '#333'}`,
                    backgroundColor: publishShort ? '#44aaff' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {publishShort && <span style={{ color: '#000', fontSize: '10px', fontWeight: 'bold', lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{ color: publishShort ? '#44aaff' : '#555', fontSize: '11px', letterSpacing: '1px' }}>
                    PUBLICAR TAMBÉM COMO SHORT (60 seg automático)
                  </span>
                </div>

                <button onClick={handleUpload} disabled={!videoFile || uploadPhase !== 'idle'}
                  style={{
                    width: '100%', padding: '12px',
                    backgroundColor: videoFile && uploadPhase === 'idle' ? '#00ff00' : '#111111',
                    color: videoFile && uploadPhase === 'idle' ? '#000000' : '#333333',
                    border: videoFile && uploadPhase === 'idle' ? 'none' : '1px solid #222222',
                    cursor: videoFile && uploadPhase === 'idle' ? 'pointer' : 'not-allowed',
                    fontFamily: 'Courier New, monospace', fontSize: '13px', fontWeight: 'bold', letterSpacing: '2px',
                  }}>
                  {scheduledAt ? '[ AGENDAR NO YOUTUBE ]' : '[ PUBLICAR NO YOUTUBE ]'}
                </button>

                {uploadPhase === 'error' && (
                  <p style={{ color: '#ff4400', fontSize: '10px', margin: '8px 0 0' }}>⚠ {uploadError}</p>
                )}
              </>
            )}

            {uploadPhase === 'sending' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ color: '#00ff00', fontSize: '12px', letterSpacing: '2px', margin: '0 0 6px' }}>ENVIANDO ARQUIVO<span className="blink">_</span></p>
                <p style={{ color: '#333333', fontSize: '10px', margin: 0 }}>aguardando servidor...</p>
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
                <p style={{ color: '#333333', fontSize: '10px', margin: '6px 0 0', letterSpacing: '-1px' }}>
                  {'█'.repeat(Math.floor(uploadProgress / 5))}{'░'.repeat(20 - Math.floor(uploadProgress / 5))} {uploadProgress}%
                </p>
              </div>
            )}

            {uploadPhase === 'processing' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ color: '#ffaa00', fontSize: '12px', letterSpacing: '2px', margin: '0 0 6px' }}>YOUTUBE PROCESSANDO<span className="blink">_</span></p>
                <p style={{ color: '#333333', fontSize: '10px', margin: 0 }}>pode demorar alguns minutos...</p>
              </div>
            )}

            {uploadPhase === 'done' && uploadVideoId && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <p style={{ color: '#00ff00', fontSize: '13px', fontWeight: 'bold', letterSpacing: '2px', margin: '0 0 8px' }}>
                  ✓ {scheduledAt ? 'AGENDADO' : 'PUBLICADO'} NO YOUTUBE
                </p>
                <a href={`https://youtu.be/${uploadVideoId}`} target="_blank" rel="noreferrer"
                  style={{ color: '#707070', fontSize: '12px', letterSpacing: '1px' }}>
                  youtu.be/{uploadVideoId} ↗
                </a>
              </div>
            )}
          </div>

          {/* ── TikTok (disabled) ── */}
          <div style={{ ...panel, opacity: 0.45 }}>
            <p style={{ color: '#ff0050', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }}>┌─ PUBLICAR NO TIKTOK</p>
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <button disabled style={{ padding: '10px 28px', backgroundColor: '#0d0005', color: '#441122', border: '1px solid #220011', cursor: 'not-allowed', fontFamily: 'Courier New, monospace', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>
                [ PUBLICAR NO TIKTOK ]
              </button>
              <p style={{ color: '#2a2a2a', fontSize: '10px', margin: '10px 0 0', letterSpacing: '1px' }}>
                Aguarda aprovação do TikTok Developer Portal
              </p>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
          ETAPA 4 — CONFIRMAÇÃO
      ══════════════════════════════════════════════════════════ */}
      {step === 4 && (
        <div style={{ ...panel, textAlign: 'center' }}>
          <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 20px', opacity: 0.8 }}>
            ┌─ ETAPA 4 · PUBLICAÇÃO CONCLUÍDA ─────────────────────
          </p>
          <p style={{ color: '#00ff00', fontSize: '28px', margin: '0 0 16px', lineHeight: 1 }}>✓</p>
          <p style={{ color: '#c0c0c0', fontSize: '14px', fontWeight: 'bold', letterSpacing: '2px', margin: '0 0 20px' }}>BEAT PUBLICADO COM SUCESSO</p>

          {publishedYt && (
            <div style={{ marginBottom: '12px' }}>
              <a href={publishedYt} target="_blank" rel="noreferrer"
                style={{ color: '#00ff00', fontSize: '12px', letterSpacing: '1px', textDecoration: 'none', border: '1px solid #1a3a1a', padding: '6px 16px', backgroundColor: '#0a1a0a' }}>
                ▶ YouTube — {publishedYt}
              </a>
            </div>
          )}

          {/* Short status */}
          {publishShort && (
            <div style={{ marginBottom: '20px', padding: '10px', border: `1px solid ${shortStatus === 'done' ? '#1a2a44' : shortStatus === 'error' ? '#330000' : '#1a1a2a'}`, backgroundColor: '#080810' }}>
              {shortStatus === 'cutting' && (
                <p style={{ color: '#44aaff', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
                  ✂ A CORTAR SHORT (59 seg)<span className="blink">_</span>
                </p>
              )}
              {shortStatus === 'uploading' && (
                <p style={{ color: '#44aaff', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
                  ↑ A ENVIAR SHORT PARA YOUTUBE<span className="blink">_</span>
                </p>
              )}
              {shortStatus === 'done' && shortVideoId && (
                <div>
                  <p style={{ color: '#44aaff', fontSize: '11px', letterSpacing: '1px', margin: '0 0 6px' }}>✓ SHORT PUBLICADO</p>
                  <a href={`https://youtu.be/${shortVideoId}`} target="_blank" rel="noreferrer"
                    style={{ color: '#44aaff', fontSize: '11px', textDecoration: 'none', letterSpacing: '1px' }}>
                    ▶ Short — youtu.be/{shortVideoId}
                  </a>
                </div>
              )}
              {shortStatus === 'error' && (
                <p style={{ color: '#ff4400', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>⚠ Erro no Short — vídeo principal publicado com sucesso</p>
              )}
              {shortStatus === 'idle' && (
                <p style={{ color: '#333', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>SHORT — aguardando<span className="blink">_</span></p>
              )}
            </div>
          )}

          <button onClick={reset}
            style={{ padding: '12px 32px', backgroundColor: '#00ff00', color: '#000000', border: 'none', cursor: 'pointer', fontFamily: 'Courier New, monospace', fontSize: '13px', fontWeight: 'bold', letterSpacing: '2px' }}>
            [ ANALISAR OUTRO BEAT ]
          </button>
        </div>
      )}

      {/* ══ HISTÓRICO ══ */}
      <UploadHistory refreshKey={histRefreshKey} />

    </div>
  )
}

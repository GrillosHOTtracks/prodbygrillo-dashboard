import { useState, useRef } from 'react'
import type { Page } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Prefill {
  beatName:    string
  title:       string
  description: string
  tags:        string
  hashtags:    string
  bpm:         number | null
  key:         string | null
  thumbnail:   string | null
}

type PublishPhase = 'idle' | 'launching' | 'logging_in' | 'navigating' | 'uploading_audio' | 'filling_form' | 'setting_prices' | 'publishing' | 'done' | 'error'

// ─── Constants ────────────────────────────────────────────────────────────────
const GENRES = [
  'Trap', 'Hip-Hop', 'R&B', 'Drill', 'Afrobeats', 'Pop', 'Lo-Fi',
  'Dancehall', 'Reggaeton', 'Jersey Club', 'Phonk', 'Boom Bap', 'Other',
]

const MOODS = [
  'Dark', 'Chill', 'Energetic', 'Sad', 'Romantic', 'Aggressive',
  'Happy', 'Mysterious', 'Epic', 'Melancholic',
]

// ─── Styles ───────────────────────────────────────────────────────────────────
const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '14px',
}

const dim: React.CSSProperties = { color: '#555555', fontSize: '10px', letterSpacing: '1px', margin: '0 0 4px' }

const fieldStyle: React.CSSProperties = {
  width: '100%', backgroundColor: '#111111', border: '1px solid #2a2a2a',
  color: '#c0c0c0', fontSize: '12px', padding: '8px 10px',
  fontFamily: 'Courier New, monospace', outline: 'none', boxSizing: 'border-box',
}

const priceInputStyle: React.CSSProperties = {
  ...fieldStyle, textAlign: 'right', fontSize: '18px', fontWeight: 'bold',
  color: '#00ff00', border: '1px solid #1a3a1a', backgroundColor: '#060f06',
}

const selectStyle: React.CSSProperties = {
  ...fieldStyle, cursor: 'pointer',
}

// ─── Phase label map ──────────────────────────────────────────────────────────
const PHASE_LABELS: Record<PublishPhase, string> = {
  idle:           '',
  launching:      'INICIANDO NAVEGADOR',
  logging_in:     'FAZENDO LOGIN NO BEATSTARS',
  navigating:     'ACEDENDO AO PAINEL DE UPLOAD',
  uploading_audio:'ENVIANDO ÁUDIO',
  filling_form:   'PREENCHENDO FORMULÁRIO',
  setting_prices: 'CONFIGURANDO PREÇOS',
  publishing:     'PUBLICANDO BEAT',
  done:           'PUBLICADO',
  error:          'ERRO',
}

const PHASE_ORDER: PublishPhase[] = [
  'launching', 'logging_in', 'navigating', 'uploading_audio',
  'filling_form', 'setting_prices', 'publishing', 'done',
]

// ─── Component ────────────────────────────────────────────────────────────────
export function BeatStore({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  // Pre-fill from localStorage (set by Scheduler)
  const [prefill] = useState<Prefill | null>(() => {
    try {
      const raw = localStorage.getItem('beatstore_prefill')
      if (raw) {
        localStorage.removeItem('beatstore_prefill')
        return JSON.parse(raw) as Prefill
      }
    } catch {}
    return null
  })

  // Form fields
  const [beatName,     setBeatName]     = useState(prefill?.beatName    ?? '')
  const [title,        setTitle]        = useState(prefill?.title       ?? '')
  const [description,  setDescription]  = useState(prefill?.description ?? '')
  const [tags,         setTags]         = useState(prefill?.tags        ?? '')
  const [bpm,          setBpm]          = useState(prefill?.bpm != null ? String(prefill.bpm) : '')
  const [musicalKey,   setMusicalKey]   = useState(prefill?.key         ?? '')
  const [genre,        setGenre]        = useState('Trap')
  const [mood,         setMood]         = useState('Dark')

  // Prices
  const [mp3Price,  setMp3Price]  = useState('24.99')
  const [wavPrice,  setWavPrice]  = useState('34.99')
  const [excPrice,  setExcPrice]  = useState('199.99')

  // Audio file
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  // Thumbnail
  const [thumbnail, setThumbnail] = useState<string | null>(prefill?.thumbnail ?? null)

  // Publish state
  const [phase,        setPhase]        = useState<PublishPhase>('idle')
  const [phaseMessage, setPhaseMessage] = useState('')
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const [error,        setError]        = useState('')

  const hasPrefill = !!prefill

  // Handle audio file select
  function onAudioSelect(file: File) {
    setAudioFile(file)
  }

  // Publish via SSE
  async function handlePublish() {
    if (!audioFile) return
    setPhase('launching')
    setPhaseMessage('')
    setError('')
    setPublishedUrl(null)

    const formData = new FormData()
    formData.append('audio', audioFile)
    formData.append('meta', JSON.stringify({
      title, description, tags, bpm: bpm ? parseFloat(bpm) : null,
      key: musicalKey, genre, mood, thumbnail,
      prices: {
        mp3:       parseFloat(mp3Price)  || 24.99,
        wav:       parseFloat(wavPrice)  || 34.99,
        exclusive: parseFloat(excPrice)  || 199.99,
      },
    }))

    try {
      const res = await fetch('/api/beatstars/publish', { method: 'POST', body: formData })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error || `HTTP ${res.status}`)
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
            if (evt.status === 'ERROR') throw new Error(evt.error || 'Erro desconhecido')
            if (evt.status === 'DONE') {
              setPhase('done')
              setPublishedUrl(evt.url || null)
              break outer
            }
            const phaseKey = evt.status?.toLowerCase() as PublishPhase
            if (phaseKey && PHASE_LABELS[phaseKey]) {
              setPhase(phaseKey)
              setPhaseMessage(evt.message || '')
            }
          } catch (e) { if (!(e instanceof SyntaxError)) throw e }
        }
      }
    } catch (err: any) {
      setError(err.message)
      setPhase('error')
    }
  }

  const publishing = phase !== 'idle' && phase !== 'done' && phase !== 'error'
  const phaseIdx   = PHASE_ORDER.indexOf(phase)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ color: '#aaff00', fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.9 }}>
          ┌─ BEAT STORE · BEATSTARS ───────────────────────────────────
        </p>
        {onNavigate && (
          <button
            onClick={() => onNavigate('scheduler')}
            style={{
              background: 'transparent', border: '1px solid #222222', color: '#555555',
              fontSize: '10px', padding: '3px 10px', cursor: 'pointer',
              fontFamily: 'Courier New, monospace', letterSpacing: '1px',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555555' }}
          >
            ← SCHEDULER
          </button>
        )}
      </div>

      {hasPrefill && (
        <div style={{ backgroundColor: '#060f06', border: '1px solid #1a3a1a', padding: '8px 12px' }}>
          <p style={{ color: '#00aa00', fontSize: '10px', margin: 0, letterSpacing: '1px' }}>
            ✓ DADOS PRÉ-PREENCHIDOS DA ANÁLISE LAIS — revisa e confirma antes de publicar
          </p>
        </div>
      )}

      {!hasPrefill && (
        <div style={{ backgroundColor: '#111111', border: '1px solid #222222', padding: '8px 12px' }}>
          <p style={{ color: '#555555', fontSize: '10px', margin: 0, letterSpacing: '1px' }}>
            Sem dados do Scheduler — preenche manualmente ou volta ao Scheduler para analisar um beat primeiro
          </p>
        </div>
      )}

      {/* ── Beat info ── */}
      <div style={panel}>
        <p style={{ color: '#aaff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 14px', opacity: 0.8 }}>
          ┌─ INFORMAÇÕES DO BEAT ───────────────────────────────────────
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          <div>
            <p style={dim}>NOME DO BEAT</p>
            <input value={beatName} onChange={e => setBeatName(e.target.value)} style={fieldStyle} placeholder="Nome do beat..." />
          </div>
          <div>
            <p style={dim}>TÍTULO (BeatStars)</p>
            <input value={title} onChange={e => setTitle(e.target.value)} style={fieldStyle} placeholder="Título para o BeatStars..." />
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <p style={dim}>DESCRIÇÃO · editável</p>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={6}
            style={{ ...fieldStyle, resize: 'vertical', lineHeight: '1.6', fontSize: '11px' }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <p style={dim}>TAGS · separadas por vírgula</p>
          <input value={tags} onChange={e => setTags(e.target.value)} style={fieldStyle} placeholder="trap, beat, hip hop..." />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <div>
            <p style={dim}>BPM</p>
            <input value={bpm} onChange={e => setBpm(e.target.value)} style={fieldStyle} type="number" placeholder="140" />
          </div>
          <div>
            <p style={dim}>KEY (tom)</p>
            <input value={musicalKey} onChange={e => setMusicalKey(e.target.value)} style={fieldStyle} placeholder="Am" />
          </div>
          <div>
            <p style={dim}>GÉNERO</p>
            <select value={genre} onChange={e => setGenre(e.target.value)} style={selectStyle}>
              {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <p style={dim}>MOOD</p>
            <select value={mood} onChange={e => setMood(e.target.value)} style={selectStyle}>
              {MOODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Audio upload ── */}
      <div style={panel}>
        <p style={{ color: '#aaff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 14px', opacity: 0.8 }}>
          ┌─ FICHEIRO DE ÁUDIO · MP3 / WAV ─────────────────────────────
        </p>

        <div
          onClick={() => audioInputRef.current?.click()}
          style={{
            border: `2px dashed ${audioFile ? '#aaff00' : '#2a2a2a'}`,
            padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
            backgroundColor: '#080808', transition: 'border-color 0.2s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = audioFile ? '#ccff00' : '#444444' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = audioFile ? '#aaff00' : '#2a2a2a' }}
        >
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/*"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) onAudioSelect(f) }}
          />
          {audioFile ? (
            <>
              <p style={{ color: '#aaff00', fontSize: '13px', margin: '0 0 4px', fontWeight: 'bold' }}>♪ {audioFile.name}</p>
              <p style={{ color: '#444444', fontSize: '10px', margin: 0 }}>{(audioFile.size / 1024 / 1024).toFixed(1)} MB</p>
            </>
          ) : (
            <>
              <p style={{ color: '#333333', fontSize: '24px', margin: '0 0 8px', lineHeight: 1 }}>♪</p>
              <p style={{ color: '#444444', fontSize: '11px', margin: '0 0 4px', letterSpacing: '1px' }}>CLIQUE PARA SELECIONAR O ÁUDIO</p>
              <p style={{ color: '#2a2a2a', fontSize: '10px', margin: 0 }}>MP3 ou WAV · máx 500 MB</p>
            </>
          )}
        </div>

        {!audioFile && (
          <p style={{ color: '#ff4400', fontSize: '10px', margin: '8px 0 0', letterSpacing: '1px' }}>
            ⚠ Áudio obrigatório para publicar no BeatStars
          </p>
        )}
      </div>

      {/* ── Prices ── */}
      <div style={panel}>
        <p style={{ color: '#aaff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 14px', opacity: 0.8 }}>
          ┌─ PREÇOS DE LICENÇA ──────────────────────────────────────────
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {[
            { label: 'MP3 LEASE', desc: 'Não exclusivo · MP3', value: mp3Price, set: setMp3Price },
            { label: 'WAV LEASE', desc: 'Não exclusivo · WAV', value: wavPrice, set: setWavPrice },
            { label: 'EXCLUSIVO',  desc: 'Exclusivo completo',  value: excPrice, set: setExcPrice },
          ].map(({ label, desc, value, set }) => (
            <div key={label} style={{ backgroundColor: '#060f06', border: '1px solid #1a2a1a', padding: '12px' }}>
              <p style={{ color: '#aaff00', fontSize: '10px', letterSpacing: '1px', margin: '0 0 2px' }}>{label}</p>
              <p style={{ color: '#2a4a2a', fontSize: '9px', margin: '0 0 8px' }}>{desc}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#00aa00', fontSize: '16px', fontWeight: 'bold' }}>$</span>
                <input
                  value={value}
                  onChange={e => set(e.target.value)}
                  type="number"
                  step="0.01"
                  style={{ ...priceInputStyle, flex: 1 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Thumbnail preview ── */}
      {thumbnail && (
        <div style={panel}>
          <p style={{ color: '#aaff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 10px', opacity: 0.8 }}>
            ┌─ THUMBNAIL (do Scheduler)
          </p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <img src={thumbnail} alt="thumbnail" style={{ width: 160, height: 90, objectFit: 'cover', border: '1px solid #1a1a1a', flexShrink: 0 }} />
            <div>
              <p style={{ color: '#555555', fontSize: '10px', margin: '0 0 8px', letterSpacing: '1px' }}>
                Thumbnail gerada pelo Scheduler — será enviada para o BeatStars
              </p>
              <button
                onClick={() => setThumbnail(null)}
                style={{ background: 'transparent', border: '1px solid #333', color: '#555', fontSize: '10px', padding: '3px 10px', cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '1px' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff4400' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555555' }}
              >
                [ REMOVER ]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Progress indicator ── */}
      {(publishing || phase === 'done' || phase === 'error') && (
        <div style={panel}>
          <p style={{ color: '#aaff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 14px', opacity: 0.8 }}>
            ┌─ PROGRESSO DA PUBLICAÇÃO ────────────────────────────────────
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
            {PHASE_ORDER.filter(p => p !== 'done').map((p, i) => {
              const done   = phaseIdx > i
              const active = phase === p
              return (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${done ? '#00ff00' : active ? '#ffaa00' : '#222222'}`,
                    backgroundColor: done ? '#00ff00' : 'transparent',
                    fontSize: 9, color: done ? '#000' : active ? '#ffaa00' : '#222',
                    flexShrink: 0,
                  }}>
                    {done ? '✓' : active ? '●' : '○'}
                  </span>
                  <span style={{ color: done ? '#00aa00' : active ? '#ffaa00' : '#2a2a2a', fontSize: '10px', letterSpacing: '1px' }}>
                    {PHASE_LABELS[p]}
                    {active && <span className="blink">_</span>}
                  </span>
                </div>
              )
            })}
          </div>

          {phaseMessage && (
            <p style={{ color: '#555555', fontSize: '10px', margin: '0 0 10px', letterSpacing: '1px' }}>{phaseMessage}</p>
          )}

          {phase === 'done' && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <p style={{ color: '#00ff00', fontSize: '20px', margin: '0 0 8px' }}>✓</p>
              <p style={{ color: '#00ff00', fontSize: '13px', fontWeight: 'bold', letterSpacing: '2px', margin: '0 0 12px' }}>
                BEAT PUBLICADO NO BEATSTARS
              </p>
              {publishedUrl && (
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#aaff00', fontSize: '11px', letterSpacing: '1px' }}
                >
                  ↗ {publishedUrl}
                </a>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div>
              <p style={{ color: '#ff4400', fontSize: '11px', margin: '0 0 10px' }}>⚠ {error}</p>
              <p style={{ color: '#444444', fontSize: '10px', margin: 0, lineHeight: '1.6' }}>
                Se o erro for de sessão expirada: corre setup-beatstars-session.cjs e atualiza BEATSTARS_COOKIES no Railway.<br/>
                Se for de seletores: os elementos da página do BeatStars podem ter mudado.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Publish button ── */}
      {(phase === 'idle' || phase === 'error') && (
        <button
          onClick={handlePublish}
          disabled={!audioFile}
          style={{
            width: '100%', padding: '14px',
            backgroundColor: audioFile ? '#aaff00' : '#111111',
            color: audioFile ? '#000000' : '#333333',
            border: audioFile ? 'none' : '1px solid #222222',
            cursor: audioFile ? 'pointer' : 'not-allowed',
            fontFamily: 'Courier New, monospace', fontSize: '14px',
            fontWeight: 'bold', letterSpacing: '2px',
            boxShadow: audioFile ? '0 0 16px rgba(170,255,0,0.2)' : 'none',
          }}
        >
          [ PUBLICAR NO BEATSTARS ]
        </button>
      )}

      {!audioFile && phase === 'idle' && (
        <p style={{ color: '#444444', fontSize: '10px', textAlign: 'center', margin: '-10px 0 0', letterSpacing: '1px' }}>
          Seleciona o ficheiro de áudio para ativar o botão
        </p>
      )}

      {/* ── Env vars info ── */}
      <div style={{ backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', padding: '10px 14px' }}>
        <p style={{ color: '#333333', fontSize: '10px', margin: '0 0 4px', letterSpacing: '1px' }}>
          ┌─ CONFIGURAÇÃO RAILWAY
        </p>
        <p style={{ color: '#2a2a2a', fontSize: '10px', margin: 0, lineHeight: '1.7', letterSpacing: '0.5px' }}>
          Adiciona no Railway: <span style={{ color: '#444444' }}>BEATSTARS_EMAIL</span> e <span style={{ color: '#444444' }}>BEATSTARS_PASSWORD</span><br/>
          O servidor usa Puppeteer (Chrome headless) para automatizar o upload no BeatStars.
        </p>
      </div>

    </div>
  )
}

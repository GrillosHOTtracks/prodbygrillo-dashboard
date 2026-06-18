import { useState, useRef, useCallback } from 'react'
import type { DailyRow, ChannelInfo, Video, TrafficSource } from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  role: 'user' | 'assistant'
  text: string
}

interface ChatContext {
  channel: { name: string; subscribers: number; totalViews: number; totalVideos: number } | null
  analytics: {
    days: number
    totalViews: number
    totalWatchTime: number
    avgCtr: string
    totalSubscribers: number
    bestDay:  DailyRow | undefined
    worstDay: DailyRow | undefined
    daily:    DailyRow[]
  } | null
  traffic: TrafficSource[] | null
  videos:  { title: string; views: number; ctr: number; publishedAt: string; revenue: number }[] | null
}

const SUGGESTIONS = [
  'O que devo criar hoje?',
  'Quais beats tenho planeados esta semana?',
  'Que beat publicar amanhã?',
  'Por que meu canal caiu essa semana?',
  'Qual meu melhor horário para postar?',
  'Quais vídeos estão performando melhor?',
  'Como aumentar meu CTR?',
  'Estou a crescer ou a cair?',
]

// ─── Shared styles ────────────────────────────────────────────────────────────
const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '12px',
}

const retro: React.CSSProperties = {
  background: 'transparent', border: '1px solid #333333',
  color: '#707070', fontSize: '10px', padding: '3px 10px',
  cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '1px',
}

// ─── Component ────────────────────────────────────────────────────────────────
export function AIChat({ analytics, channelInfo, videos, traffic }: {
  analytics:   DailyRow[] | null
  channelInfo: ChannelInfo | null
  videos:      Video[] | null
  traffic:     TrafficSource[] | null
}) {
  const [messages,    setMessages]    = useState<Message[]>([])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [streamText,  setStreamText]  = useState('')
  const [error,       setError]       = useState('')
  const messagesEndRef                = useRef<HTMLDivElement>(null)
  const inputRef                      = useRef<HTMLInputElement>(null)

  const scrollBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })

  const buildContext = useCallback((): ChatContext => {
    const daily = analytics ?? []
    const sorted = [...daily].sort((a, b) => b.views - a.views)
    const active = daily.filter(d => d.views > 0)

    return {
      channel: channelInfo ? {
        name:        channelInfo.name,
        subscribers: channelInfo.subscribers,
        totalViews:  channelInfo.totalViews,
        totalVideos: channelInfo.totalVideos,
      } : null,
      analytics: daily.length ? {
        days:             daily.length,
        totalViews:       daily.reduce((s, d) => s + d.views, 0),
        totalWatchTime:   daily.reduce((s, d) => s + d.watchTime, 0),
        avgCtr:           daily.length ? (daily.reduce((s, d) => s + d.ctr, 0) / daily.length).toFixed(1) : '0',
        totalSubscribers: daily.reduce((s, d) => s + d.subscribers, 0),
        bestDay:          sorted[0],
        worstDay:         active.sort((a, b) => a.views - b.views)[0],
        daily,
      } : null,
      traffic: traffic ?? null,
      videos: videos ? videos.slice(0, 10).map(v => ({
        title:       v.title,
        views:       v.views,
        ctr:         v.ctr,
        publishedAt: v.publishedAt,
        revenue:     v.revenue,
      })) : null,
    }
  }, [analytics, channelInfo, videos, traffic])

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q || loading) return

    const userMsg: Message = { role: 'user', text: q }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setStreamText('')
    setError('')
    setTimeout(scrollBottom, 50)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          history:  messages.slice(-6).map(m => ({ role: m.role, text: m.text })),
          context:  buildContext(),
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

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
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') break outer
          try {
            const evt = JSON.parse(payload)
            if (evt.error) throw new Error(evt.error)
            if (evt.text) { full += evt.text; setStreamText(full); scrollBottom() }
          } catch (e) { if (!(e instanceof SyntaxError)) throw e }
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', text: full }])
      setStreamText('')
    } catch (err: any) {
      setError(err.message)
      setMessages(prev => [...prev, { role: 'assistant', text: `⚠ ${err.message}` }])
      setStreamText('')
    } finally {
      setLoading(false)
      setTimeout(() => { scrollBottom(); inputRef.current?.focus() }, 100)
    }
  }, [loading, messages, buildContext])

  const hasData = !!(analytics?.length || channelInfo || videos?.length)

  return (
    <div style={panel}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
          ┌─ LAIS · ANALISTA DO CANAL
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!hasData && (
            <span style={{ color: '#444444', fontSize: '10px' }}>sem dados carregados</span>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setStreamText(''); setError('') }}
              style={retro}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}
            >[ LIMPAR ]</button>
          )}
        </div>
      </div>

      {/* ── Suggested questions (only when chat is empty) ── */}
      {messages.length === 0 && (
        <div style={{ marginBottom: '12px' }}>
          <p style={{ color: '#2a2a2a', fontSize: '10px', letterSpacing: '1px', margin: '0 0 7px' }}>
            PERGUNTAS SUGERIDAS
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={loading || !hasData}
                style={{
                  background: 'transparent', border: '1px solid #222222',
                  color: '#444444', fontSize: '10px', padding: '4px 10px',
                  cursor: hasData ? 'pointer' : 'not-allowed',
                  fontFamily: 'Courier New, monospace', letterSpacing: '0.5px',
                }}
                onMouseEnter={e => {
                  if (!hasData) return
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = '#444444'; el.style.color = '#c0c0c0'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = '#222222'; el.style.color = '#444444'
                }}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Message history ── */}
      {messages.length > 0 && (
        <div style={{
          maxHeight: '380px', overflowY: 'auto', marginBottom: '12px',
          display: 'flex', flexDirection: 'column', gap: '12px',
          scrollbarWidth: 'thin', scrollbarColor: '#1a1a1a transparent',
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ color: msg.role === 'user' ? '#444444' : '#00aa00', fontSize: '10px', letterSpacing: '1px' }}>
                {msg.role === 'user' ? '> TU' : '> LAIS'}
              </span>
              <p style={{
                color:       msg.role === 'user' ? '#606060' : '#c0c0c0',
                fontSize:    '12px', margin: 0, lineHeight: '1.75',
                fontFamily:  'Courier New, monospace', whiteSpace: 'pre-wrap',
                paddingLeft: '8px',
                borderLeft:  `2px solid ${msg.role === 'user' ? '#1e1e1e' : '#003300'}`,
              }}>{msg.text}</p>
            </div>
          ))}

          {/* Streaming assistant response */}
          {loading && streamText && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ color: '#00aa00', fontSize: '10px', letterSpacing: '1px' }}>
                {'> LAIS'}
              </span>
              <p style={{
                color: '#c0c0c0', fontSize: '12px', margin: 0, lineHeight: '1.75',
                fontFamily: 'Courier New, monospace', whiteSpace: 'pre-wrap',
                paddingLeft: '8px', borderLeft: '2px solid #003300',
              }}>
                {streamText}<span className="blink" style={{ color: '#00ff00' }}>█</span>
              </p>
            </div>
          )}

          {loading && !streamText && (
            <p style={{ color: '#333333', fontSize: '11px', margin: 0, letterSpacing: '2px' }}>
              A ANALISAR<span className="blink">_</span>
            </p>
          )}

          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ── Input ── */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span style={{ color: '#00ff00', fontSize: '13px', flexShrink: 0 }}>&gt;</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) } }}
          placeholder={hasData ? 'Pergunta sobre o teu canal...' : 'Carrega os dados do canal primeiro...'}
          disabled={loading || !hasData}
          style={{
            flex: 1, backgroundColor: '#111111',
            border: '1px solid #333333', borderBottom: '2px solid #00ff00',
            color: '#c0c0c0', fontSize: '12px', padding: '7px 10px',
            fontFamily: 'Courier New, monospace', outline: 'none',
          }}
        />
        <button
          onClick={() => ask(input)}
          disabled={!input.trim() || loading || !hasData}
          style={{
            padding: '7px 16px', flexShrink: 0,
            backgroundColor: !input.trim() || loading || !hasData ? '#001a00' : '#00ff00',
            color:            !input.trim() || loading || !hasData ? '#00ff00' : '#000000',
            border:           !input.trim() || loading || !hasData ? '1px solid #004400' : 'none',
            cursor:           !input.trim() || loading || !hasData ? 'not-allowed' : 'pointer',
            fontFamily: 'Courier New, monospace', fontSize: '11px',
            fontWeight: 'bold', letterSpacing: '1px',
          }}
        >{loading ? '...' : '[ ENVIAR ]'}</button>
      </div>

      {/* Compact suggested questions after first message */}
      {messages.length > 0 && !loading && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
          {SUGGESTIONS.slice(0, 4).map(s => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={loading}
              style={{
                background: 'transparent', border: '1px solid #1a1a1a',
                color: '#333333', fontSize: '9px', padding: '2px 7px',
                cursor: 'pointer', fontFamily: 'Courier New, monospace',
              }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#555555'; el.style.borderColor = '#333333' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#333333'; el.style.borderColor = '#1a1a1a' }}
            >{s}</button>
          ))}
        </div>
      )}

      {error && !messages.length && (
        <p style={{ color: '#ff4400', fontSize: '10px', margin: '8px 0 0' }}>⚠ {error}</p>
      )}
    </div>
  )
}

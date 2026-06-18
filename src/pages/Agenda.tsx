import { useState, useEffect } from 'react'
import { useToast } from '../components/ui/Toast'

interface UploadEntry {
  id: string
  title: string
  publishedAt: string
  status: 'live' | 'scheduled' | 'error'
  thumbnailUrl: string | null
  videoUrl: string
  views: number
}

interface PlanEntry {
  id: string
  date: string
  anchorArtist: string
  secondaryArtist: string
  beatName: string
  genre: string
  filenameTemplate: string
  status: 'planned' | 'posted' | 'skipped'
}

const WEEK_DAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']
const MONTHS    = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']

function toLocalDateKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const panel: React.CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555', borderLeft: '2px solid #555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '14px',
}
const btnRetro: React.CSSProperties = {
  background: 'transparent', border: '1px solid #333', color: '#555',
  cursor: 'pointer', fontFamily: 'Courier New, monospace',
  fontSize: '11px', padding: '4px 12px', letterSpacing: '1px',
}

export function Agenda() {
  const toast = useToast()
  const today = new Date()
  const [year,      setYear]      = useState(today.getFullYear())
  const [month,     setMonth]     = useState(today.getMonth())
  const [history,   setHistory]   = useState<UploadEntry[]>([])
  const [schedule,  setSchedule]  = useState<PlanEntry[]>([])
  const [loading,   setLoading]   = useState(true)
  const [genLoading,setGenLoading]= useState(false)
  const [genWeeks,  setGenWeeks]  = useState(1)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    try {
      const [h, s] = await Promise.all([
        fetch('/api/upload/history').then(r => r.ok ? r.json() : []),
        fetch('/api/schedule').then(r => r.ok ? r.json() : []),
      ])
      setHistory(h)
      setSchedule(s)
    } catch {}
    finally { setLoading(false) }
  }
  useEffect(() => { loadAll() }, [])

  async function deletePlan(id: string) {
    const entry = schedule.find(e => e.id === id)
    await fetch(`/api/schedule/${id}`, { method: 'DELETE' })
    setSchedule(s => s.filter(e => e.id !== id))
    toast(`Plano "${entry?.beatName ?? id}" removido`)
  }

  async function markPosted(id: string) {
    const entry = schedule.find(e => e.id === id)
    await fetch(`/api/schedule/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'posted' }),
    })
    setSchedule(s => s.map(e => e.id === id ? { ...e, status: 'posted' } : e))
    toast(`"${entry?.beatName ?? 'Beat'}" marcado como concluído!`)
  }

  async function generateSchedule() {
    setGenLoading(true)
    try {
      const r = await fetch('/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeks: genWeeks, anchorArtist: 'Hurricane Wisdom' }),
      })
      if (r.ok) { await loadAll(); toast(`Cronograma de ${genWeeks}W gerado com sucesso!`) }
    } catch {}
    finally { setGenLoading(false) }
  }

  // Build maps: date → uploads, date → plan entries
  const uploadsByDate = new Map<string, UploadEntry[]>()
  for (const e of history) {
    const k = toLocalDateKey(e.publishedAt)
    if (!uploadsByDate.has(k)) uploadsByDate.set(k, [])
    uploadsByDate.get(k)!.push(e)
  }
  const planByDate = new Map<string, PlanEntry[]>()
  for (const e of schedule) {
    if (!planByDate.has(e.date)) planByDate.set(e.date, [])
    planByDate.get(e.date)!.push(e)
  }

  // Calendar grid
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7
  const totalCells  = Math.ceil((firstDow + daysInMonth) / 7) * 7

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
    setSelectedKey(null)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
    setSelectedKey(null)
  }

  const todayKey = toLocalDateKey(today.toISOString())
  const selUploads = selectedKey ? (uploadsByDate.get(selectedKey) || []) : []
  const selPlans   = selectedKey ? (planByDate.get(selectedKey) || []) : []

  const monthPrefix  = `${year}-${String(month + 1).padStart(2,'0')}-`
  const monthUploads = history.filter(e => toLocalDateKey(e.publishedAt).startsWith(monthPrefix))
  const monthPlans   = schedule.filter(e => e.date.startsWith(monthPrefix) && e.status === 'planned')

  const upcoming = schedule
    .filter(e => e.status === 'planned' && e.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.8 }}>
        ┌─ AGENDA DE PUBLICAÇÕES · PRODBYGRILLO ─────────────────────────
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '12px' }}>
        {[
          { label: 'PUBLICADOS', value: monthUploads.filter(e => e.status === 'live').length,      color: '#00ff00' },
          { label: 'AGENDADOS',  value: monthUploads.filter(e => e.status === 'scheduled').length,  color: '#ffaa00' },
          { label: 'PLANEADOS',  value: monthPlans.length,                                          color: '#cc88ff' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...panel, flex: 1, textAlign: 'center', padding: '10px' }}>
            <p style={{ color: '#444', fontSize: '10px', letterSpacing: '1px', margin: '0 0 4px' }}>{label}</p>
            <p style={{ color, fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <div style={panel}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <button onClick={prevMonth} style={btnRetro}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}>
            [ ◄ PREV ]
          </button>
          <span style={{ color: '#00ff00', fontSize: '13px', fontWeight: 'bold', letterSpacing: '3px' }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} style={btnRetro}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}>
            [ NEXT ► ]
          </button>
        </div>

        {/* Week day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
          {WEEK_DAYS.map(d => (
            <div key={d} style={{ textAlign: 'center', color: '#333', fontSize: '10px', letterSpacing: '1px', padding: '4px 0', borderBottom: '1px solid #1a1a1a' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
          {Array.from({ length: totalCells }).map((_, i) => {
            const day = i - firstDow + 1
            if (day < 1 || day > daysInMonth) return <div key={i} style={{ minHeight: 64 }} />

            const key      = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            const uploads  = uploadsByDate.get(key) || []
            const plans    = planByDate.get(key) || []
            const hasLive   = uploads.some(e => e.status === 'live')
            const hasSched  = uploads.some(e => e.status === 'scheduled')
            const hasPlan   = plans.some(e => e.status === 'planned')
            const hasPosted = plans.some(e => e.status === 'posted')
            const isToday   = key === todayKey
            const isSel    = key === selectedKey
            const clickable = uploads.length > 0 || plans.length > 0

            return (
              <div
                key={i}
                onClick={() => clickable && setSelectedKey(isSel ? null : key)}
                style={{
                  border: `1px solid ${isSel ? '#00ff00' : isToday ? '#00aa00' : '#1a1a1a'}`,
                  backgroundColor: isSel ? '#001a00' : isToday ? '#050f05' : '#080808',
                  padding: '5px 4px 6px',
                  minHeight: 64,
                  cursor: clickable ? 'pointer' : 'default',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => { if (clickable && !isSel) (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a' }}
                onMouseLeave={e => { if (!isSel && !isToday) (e.currentTarget as HTMLElement).style.borderColor = '#1a1a1a' }}
              >
                <span style={{ color: isToday ? '#00ff00' : uploads.length > 0 || plans.length > 0 ? '#c0c0c0' : '#333', fontSize: '11px', fontWeight: isToday ? 'bold' : 'normal' }}>
                  {String(day).padStart(2, '0')}
                </span>
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {hasLive   && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#00ff00', boxShadow: '0 0 5px #00ff00', display: 'inline-block' }} />}
                  {hasSched  && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#ffaa00', boxShadow: '0 0 5px #ffaa00', display: 'inline-block' }} />}
                  {hasPlan   && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#cc88ff', boxShadow: '0 0 5px #cc88ff', display: 'inline-block' }} />}
                  {hasPosted && <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#3a7a4a', boxShadow: '0 0 4px #3a7a4a', display: 'inline-block', border: '1px solid #5aaa6a' }} />}
                </div>
                {(hasPlan || hasPosted) && plans[0]?.beatName && (
                  <span style={{ color: hasPosted && !hasPlan ? '#3a7a4a' : '#7a5a99', fontSize: '8px', textAlign: 'center', lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>
                    {hasPosted && !hasPlan ? '✓ ' : ''}{plans[0].beatName}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #111', flexWrap: 'wrap' }}>
          {[
            { color: '#00ff00', label: 'PUBLICADO' },
            { color: '#ffaa00', label: 'AGENDADO' },
            { color: '#cc88ff', label: 'PLANEADO' },
            { color: '#3a7a4a', label: 'CONCLUÍDO' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, boxShadow: `0 0 4px ${color}`, display: 'inline-block' }} />
              <span style={{ color: '#444', fontSize: '10px', letterSpacing: '1px' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedKey && (selUploads.length > 0 || selPlans.length > 0) && (
        <div style={panel}>
          <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }}>
            ┌─ {selectedKey.split('-').reverse().join('/')}
          </p>

          {/* Uploads */}
          {selUploads.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', borderBottom: '1px solid #111', paddingBottom: '10px', marginBottom: '10px' }}>
              {e.thumbnailUrl
                ? <img src={e.thumbnailUrl} alt="" style={{ width: 96, height: 54, objectFit: 'cover', border: '1px solid #1a1a1a', flexShrink: 0 }} />
                : <div style={{ width: 96, height: 54, backgroundColor: '#0a0a0a', border: '1px solid #1a1a1a', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: '#c0c0c0', fontSize: '12px', margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</p>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <span style={{ color: e.status === 'live' ? '#00ff00' : e.status === 'scheduled' ? '#ffaa00' : '#ff4400', fontSize: '10px' }}>
                    {e.status === 'live' ? '● LIVE' : e.status === 'scheduled' ? '◌ AGENDADO' : '✕ ERRO'}
                  </span>
                  <span style={{ color: '#444', fontSize: '10px' }}>{e.views.toLocaleString('pt-BR')} views</span>
                </div>
              </div>
              <a href={e.videoUrl} target="_blank" rel="noreferrer"
                style={{ color: '#00aa00', fontSize: '11px', textDecoration: 'none', border: '1px solid #1a3a1a', padding: '4px 8px' }}>▶ YT</a>
            </div>
          ))}

          {/* Plans */}
          {selPlans.map(e => (
            <div key={e.id} style={{ border: `1px solid ${e.status === 'posted' ? '#1a3a1a' : '#2a1a44'}`, backgroundColor: e.status === 'posted' ? '#0a1a0a' : '#100818', padding: '10px', marginBottom: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: e.status === 'posted' ? '#00aa00' : '#cc88ff', fontSize: '13px', fontWeight: 'bold', margin: '0 0 4px' }}>
                    {e.status === 'posted' ? '✓ ' : '◈ '}
                    [FREE] {e.anchorArtist} Type Beat - "{e.beatName}"{e.secondaryArtist ? ` | ${e.secondaryArtist} Type Beat` : ''}
                  </p>
                  {e.genre && <p style={{ color: '#555', fontSize: '10px', margin: '0 0 6px', letterSpacing: '0.5px' }}>{e.genre}</p>}
                  <div style={{ backgroundColor: '#080808', border: '1px solid #1a1a1a', padding: '5px 8px' }}>
                    <p style={{ color: '#333', fontSize: '9px', letterSpacing: '1px', margin: '0 0 2px' }}>NOME DO FICHEIRO</p>
                    <p style={{ color: '#888', fontSize: '10px', margin: 0 }}>{e.filenameTemplate}.mp4</p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  {e.status === 'planned' && (
                    <button onClick={() => markPosted(e.id)}
                      style={{ ...btnRetro, color: '#00aa00', border: '1px solid #1a3a1a', fontSize: '10px', padding: '3px 8px' }}
                      onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.color = '#00ff00' }}
                      onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.color = '#00aa00' }}>
                      ✓ FEITO
                    </button>
                  )}
                  <button onClick={() => deletePlan(e.id)}
                    style={{ ...btnRetro, color: '#333', fontSize: '10px', padding: '3px 8px' }}
                    onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.color = '#ff4400' }}
                    onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.color = '#333' }}>
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generate schedule */}
      <div style={panel}>
        <p style={{ color: '#cc88ff', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }}>
          ┌─ GERAR CRONOGRAMA IA
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <span style={{ color: '#555', fontSize: '11px', letterSpacing: '1px' }}>SEMANAS A PLANEAR</span>
          {[1, 2, 4].map(w => (
            <button key={w} onClick={() => setGenWeeks(w)}
              style={{ ...btnRetro, color: genWeeks === w ? '#cc88ff' : '#444', border: `1px solid ${genWeeks === w ? '#5a2a99' : '#222'}`, padding: '3px 10px' }}>
              {w}W
            </button>
          ))}
        </div>
        <p style={{ color: '#333', fontSize: '10px', margin: '0 0 12px', letterSpacing: '0.5px', lineHeight: 1.6 }}>
          A IA gera {genWeeks * 7} nomes de beats únicos, um por dia. Dias já planeados não são substituídos.
        </p>
        <button
          onClick={generateSchedule}
          disabled={genLoading}
          style={{
            width: '100%', padding: '10px',
            backgroundColor: genLoading ? '#1a0a2a' : '#2a0a44',
            color: genLoading ? '#444' : '#cc88ff',
            border: `1px solid ${genLoading ? '#222' : '#5a2a99'}`,
            cursor: genLoading ? 'not-allowed' : 'pointer',
            fontFamily: 'Courier New, monospace', fontSize: '12px', fontWeight: 'bold', letterSpacing: '2px',
          }}
          onMouseEnter={e => { if (!genLoading) (e.currentTarget as HTMLElement).style.backgroundColor = '#3a1255' }}
          onMouseLeave={e => { if (!genLoading) (e.currentTarget as HTMLElement).style.backgroundColor = '#2a0a44' }}>
          {genLoading ? '[ A GERAR CRONOGRAMA... ]' : '[ GERAR CRONOGRAMA COM IA ]'}
        </button>
      </div>

      {/* Upcoming planned */}
      {upcoming.length > 0 && (
        <div style={panel}>
          <p style={{ color: '#cc88ff', fontSize: '11px', letterSpacing: '1px', margin: '0 0 12px' }}>
            ┌─ PRÓXIMOS BEATS A CRIAR ({upcoming.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {upcoming.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '8px 0', borderBottom: i < upcoming.length - 1 ? '1px solid #111' : 'none' }}>
                <span style={{ color: '#333', fontSize: '10px', flexShrink: 0, width: 18, paddingTop: 2 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ color: '#cc88ff', fontSize: '11px', flexShrink: 0, minWidth: 90, paddingTop: 2 }}>{e.date}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ color: '#c0c0c0', fontSize: '12px', fontWeight: 'bold', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    [FREE] {e.anchorArtist} Type Beat - "{e.beatName}"{e.secondaryArtist ? ` | ${e.secondaryArtist} Type Beat` : ''}
                  </p>
                  <p style={{ color: '#555', fontSize: '10px', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.filenameTemplate}.mp4
                  </p>
                </div>
                <button onClick={() => markPosted(e.id)}
                  style={{ background: 'transparent', border: '1px solid #1a3a1a', color: '#2a6a3a', cursor: 'pointer', fontSize: '11px', flexShrink: 0, padding: '1px 6px', fontFamily: 'Courier New, monospace' }}
                  onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.color = '#00cc44'; (ev.currentTarget as HTMLElement).style.borderColor = '#00cc44' }}
                  onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.color = '#2a6a3a'; (ev.currentTarget as HTMLElement).style.borderColor = '#1a3a1a' }}>✓</button>
                <button onClick={() => deletePlan(e.id)}
                  style={{ background: 'transparent', border: 'none', color: '#333', cursor: 'pointer', fontSize: '12px', flexShrink: 0, paddingTop: 2 }}
                  onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.color = '#ff4400' }}
                  onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.color = '#333' }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ ...panel, textAlign: 'center', padding: '20px' }}>
          <p style={{ color: '#333', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>CARREGANDO<span className="blink">_</span></p>
        </div>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { AIChat } from '../components/AIChat'
import { StatCard } from '../components/StatCard'
import { IconEye, IconClock, IconUsers, IconDollar, IconPlay, IconCursor } from '../components/PixelIcons'
import { ViewsChart } from '../components/charts/ViewsChart'
import { TrafficSourcesChart } from '../components/charts/TrafficChart'
import { VideoTable } from '../components/VideoTable'
import { SkeletonCard, SkeletonTable } from '../components/ui/Skeleton'
import { fmtNum, fmtSecs, fmtPct } from '../utils/format'
import type { DailyMetric, Video } from '../types'
import type { ChannelInfo, Video as ApiVideo, ArtistTrend, TrafficSource } from '../lib/api'

// ─── Producer daily tips — rotates by day of week ─────────────────────────────
const DAILY_TIPS = [
  { day: 'DOMINGO',   tip: 'Planeia a semana: define 3 beats a produzir, 1 upload e 1 ação de marketing.', action: 'Abre o Scheduler → agenda o teu próximo beat' },
  { day: 'SEGUNDA',   tip: 'Analisa os 5 type beats mais vistos do mês. O que têm em comum? BPM, tom, instrumentos?', action: 'Pesquisa no YouTube: "[artista top 1] type beat 2026"' },
  { day: 'TERÇA',     tip: 'Produz um beat do zero hoje. Usa os vibes do artista com maior opportunidade no ranking.', action: 'Abre o Scheduler → analisa com a LAIS após terminar' },
  { day: 'QUARTA',    tip: 'Optimiza 3 beats antigos: novo título SEO, nova thumbnail, nova descrição com hashtags.', action: 'Usa o template de descrição no Scheduler' },
  { day: 'QUINTA',    tip: 'Upload dia. Publica com thumbnail profissional e agenda para o melhor horário sugerido pela LAIS.', action: 'Scheduler → Publicar no YouTube' },
  { day: 'SEXTA',     tip: 'Interage nas plataformas. Responde a comentários, faz collab com outro produtor, partilha no Instagram.', action: 'Beat Store → publica no BeatStars' },
  { day: 'SÁBADO',    tip: 'Estuda os artistas com maior opportunity score. Mercados inexplorados = menos competição = mais views.', action: 'Vê o separador OPORTUNIDADES abaixo' },
]

const panel: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  padding: '14px',
  transition: `border-color var(--t-fast)`,
}

function apiToLocal(v: ApiVideo): Video {
  return {
    id: v.id, title: v.title, thumbnail: '▶',
    views: v.views, watchTime: v.watchTime, likes: v.likes,
    comments: v.comments, ctr: v.ctr, avgDuration: v.avgDuration,
    publishedAt: v.publishedAt, revenue: v.revenue,
    status: v.status as Video['status'],
  }
}

// ─── Channel banner ───────────────────────────────────────────────────────────
function ChannelBanner({ info }: { info: ChannelInfo }) {
  const seeded = info._seeded && !info._innertube
  return (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
      <pre style={{ margin: 0, fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.7' }}>{
`*** CHANNEL INFO ***
nick    : ${info.name || '...'}
handle  : ${info.handle || '...'}
country : ${info.country}
joined  : ${info.publishedAt?.slice(0, 10) || 'N/A'}`
      }</pre>
      <div style={{ flex: 1, display: 'flex', gap: '28px', flexWrap: 'wrap', paddingLeft: '20px', borderLeft: '1px solid var(--border)' }}>
        {[
          { label: 'SUBSCRIBERS',  value: seeded && !info.subscribers ? '—' : fmtNum(info.subscribers) },
          { label: 'TOTAL VIEWS',  value: seeded && !info.totalViews  ? '—' : fmtNum(info.totalViews)  },
          { label: 'TOTAL VIDEOS', value: seeded && !info.totalVideos ? '—' : info.totalVideos.toString() },
        ].map(stat => (
          <div key={stat.label}>
            <p style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px', margin: 0 }}>{stat.label}</p>
            <p style={{ color: seeded ? 'var(--text-faint)' : 'var(--text-bright)', fontSize: '22px', fontWeight: 'bold', margin: '2px 0 0', letterSpacing: '1px' }}>{stat.value}</p>
          </div>
        ))}
        {seeded && (
          <p style={{ color: 'var(--text-faint)', fontSize: '10px', alignSelf: 'center', margin: 0 }}>
            ⟳ dados reais disponíveis após reset de quota (08:00 UTC)
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Artist Hub — full intelligence panel ─────────────────────────────────────
function ArtistHub({ artists }: { artists: ArtistTrend[] }) {
  const [tab, setTab] = useState<'ranking' | 'oportunidades' | 'inspiracao'>('ranking')
  const now       = new Date()
  const year      = now.getFullYear()
  const monthLabel = now.toLocaleString('pt', { month: 'long', year: 'numeric' }).toUpperCase()
  const dayIdx    = now.getDay()
  const tipToday  = DAILY_TIPS[dayIdx]

  // Top opportunity: high deezerFans + low beatCount
  const topOpp = [...artists].sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0))
  const hotArtist = artists[0]

  // Summary stats
  const avgSat = artists.filter(a => a.saturation === 'high').length
  const satPct  = Math.round((avgSat / artists.length) * 100)

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '6px 16px', fontSize: '10px', letterSpacing: '1px',
        fontFamily: 'Courier New, monospace', cursor: 'pointer',
        backgroundColor: tab === id ? 'var(--accent-muted)' : 'transparent',
        color: tab === id ? 'var(--accent)' : 'var(--text-faint)',
        border: tab === id ? '1px solid var(--accent-border)' : '1px solid var(--border)',
        borderBottom: tab === id ? '1px solid var(--accent-muted)' : '1px solid var(--border)',
        transition: 'all var(--t-fast)',
      }}
    >{label}</button>
  )

  // Artist avatar (Deezer photo or initial)
  function Avatar({ a, size = 36 }: { a: ArtistTrend; size?: number }) {
    return a.photo
      ? <img src={a.photo} alt={a.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }} />
      : <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: size * 0.4, fontWeight: 'bold', flexShrink: 0 }}>
          {a.name[0]}
        </div>
  }

  function SatBadge({ s }: { s?: ArtistTrend['saturation'] }) {
    const cfg = s === 'high' ? { color: '#ff6600', label: 'ALTO' }
              : s === 'medium' ? { color: '#ffaa00', label: 'MED' }
              : { color: '#00aa00', label: 'BAIXO' }
    return (
      <span style={{ fontSize: '9px', padding: '1px 5px', border: `1px solid ${cfg.color}33`, color: cfg.color, letterSpacing: '1px', whiteSpace: 'nowrap' }}>
        {cfg.label}
      </span>
    )
  }

  function DemandBar({ score, maxW = 80 }: { score: number; maxW?: number }) {
    const w = Math.round((score / 100) * maxW)
    const c = score >= 70 ? '#00ff00' : score >= 40 ? '#ffaa00' : '#555555'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: maxW, height: 4, backgroundColor: 'var(--border)', position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: w, backgroundColor: c, transition: 'width 0.4s' }} />
        </div>
        <span style={{ color: c, fontSize: '10px', fontWeight: 'bold', minWidth: 26 }}>{score}</span>
      </div>
    )
  }

  const ytLink = (name: string) =>
    `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} type beat ${year}`)}`

  const TH: React.CSSProperties = {
    textAlign: 'left', padding: '5px 8px',
    color: 'var(--text-dim)', fontSize: '9px', letterSpacing: '1px',
    borderBottom: '1px solid var(--border)', fontWeight: 'normal', whiteSpace: 'nowrap',
  }
  const TD: React.CSSProperties = {
    padding: '8px 8px', fontSize: '11px',
    borderBottom: '1px solid rgba(34,34,34,0.5)', whiteSpace: 'nowrap', overflow: 'hidden',
    color: 'var(--text)',
  }

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '12px', padding: '8px 12px', backgroundColor: 'rgba(0,255,0,0.03)', border: '1px solid var(--border)' }}>
        <div>
          <p style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px', margin: '0 0 2px' }}>ARTISTAS RASTREADOS</p>
          <p style={{ color: 'var(--text-bright)', fontSize: '18px', fontWeight: 'bold', margin: 0 }}>{artists.length}</p>
        </div>
        {hotArtist && (
          <div>
            <p style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px', margin: '0 0 2px' }}>🔥 TOP {monthLabel}</p>
            <p style={{ color: 'var(--accent)', fontSize: '14px', fontWeight: 'bold', margin: 0 }}>{hotArtist.name}</p>
          </div>
        )}
        {topOpp[0] && (
          <div>
            <p style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px', margin: '0 0 2px' }}>💎 MAIOR OPORTUNIDADE</p>
            <p style={{ color: '#aaff00', fontSize: '14px', fontWeight: 'bold', margin: 0 }}>{topOpp[0].name}</p>
          </div>
        )}
        <div>
          <p style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px', margin: '0 0 2px' }}>SATURAÇÃO DO MERCADO</p>
          <p style={{ color: satPct > 60 ? '#ff6600' : satPct > 30 ? '#ffaa00' : '#00aa00', fontSize: '18px', fontWeight: 'bold', margin: 0 }}>{satPct}%</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '14px' }}>
        {tabBtn('ranking',      '[ RANKING ]')}
        {tabBtn('oportunidades','[ OPORTUNIDADES ]')}
        {tabBtn('inspiracao',   '[ INSPIRAÇÃO ]')}
      </div>

      {/* ── RANKING tab ─────────────────────────────────────────────────────── */}
      {tab === 'ranking' && (
        <div style={{ overflowX: 'auto' }}>
          <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginBottom: '10px', letterSpacing: '1px' }}>
            type beats em {monthLabel} · Innertube (zero quota) · {artists.length} artistas · demand = views × frequência
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={TH}>#</th>
                <th style={TH}></th>
                <th style={{ ...TH, width: '16%' }}>ARTISTA</th>
                <th style={{ ...TH, width: '16%' }}>DEMAND</th>
                <th style={{ ...TH, textAlign: 'right' }}>FÃNS</th>
                <th style={{ ...TH, textAlign: 'center' }}>SAT.</th>
                <th style={{ ...TH, textAlign: 'right' }}>BEATS</th>
                <th style={{ ...TH, textAlign: 'right' }}>∅ VIEWS</th>
                <th style={{ ...TH, textAlign: 'right' }}>TOTAL VIEWS</th>
                <th style={TH}></th>
              </tr>
            </thead>
            <tbody>
              {artists.map((a, i) => {
                const rankColor = i === 0 ? 'var(--accent)' : i === 1 ? '#c0c0c0' : i === 2 ? '#aa7700' : 'var(--text-faint)'
                return (
                  <tr key={a.name}
                    style={{ transition: `background var(--t-fast)` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                  >
                    <td style={{ ...TD, color: rankColor, fontWeight: 'bold', fontSize: '13px', paddingRight: 4 }}>
                      {String(i + 1).padStart(2, '0')}
                    </td>
                    <td style={{ ...TD, padding: '6px 6px' }}>
                      <Avatar a={a} size={30} />
                    </td>
                    <td style={{ ...TD, maxWidth: 140 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ color: 'var(--text-bright)', fontWeight: 'bold', letterSpacing: '0.5px' }}>{a.name}</span>
                        {a.hotTag && (
                          <span style={{ fontSize: '9px', color: 'var(--text-faint)', letterSpacing: '0.5px' }}>{a.hotTag}</span>
                        )}
                        {a.vibes && a.vibes.length > 0 && (
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {a.vibes.slice(0, 2).map(v => (
                              <span key={v} style={{ fontSize: '8px', padding: '1px 4px', border: '1px solid var(--border)', color: 'var(--text-faint)', letterSpacing: '0.5px' }}>{v}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={TD}>
                      <DemandBar score={a.demandScore ?? 0} />
                    </td>
                    <td style={{ ...TD, textAlign: 'right', color: 'var(--text-dim)', fontSize: '10px' }}>
                      {a.deezerFans ? fmtNum(a.deezerFans) : '—'}
                    </td>
                    <td style={{ ...TD, textAlign: 'center' }}>
                      <SatBadge s={a.saturation} />
                    </td>
                    <td style={{ ...TD, textAlign: 'right', color: 'var(--text-dim)' }}>{a.beatCount}</td>
                    <td style={{ ...TD, textAlign: 'right', color: 'var(--text-dim)', fontSize: '10px' }}>
                      {fmtNum(a.avgViews ?? 0)}
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <span style={{ color: i === 0 ? 'var(--accent)' : 'var(--text-dim)', fontWeight: i === 0 ? 'bold' : 'normal' }}>
                        {fmtNum(a.totalViews)}
                      </span>
                    </td>
                    <td style={{ ...TD, paddingLeft: 8 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <a href={ytLink(a.name)} target="_blank" rel="noopener noreferrer"
                          style={{ padding: '3px 7px', border: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: '9px', textDecoration: 'none', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}
                          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--accent)'; el.style.borderColor = 'var(--accent-border)' }}
                          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--text-dim)'; el.style.borderColor = 'var(--border)' }}
                        >▶ YT</a>
                        {a.deezerLink && (
                          <a href={a.deezerLink} target="_blank" rel="noopener noreferrer"
                            style={{ padding: '3px 7px', border: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: '9px', textDecoration: 'none', letterSpacing: '0.5px' }}
                            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#ff6699'; el.style.borderColor = '#ff669933' }}
                            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--text-dim)'; el.style.borderColor = 'var(--border)' }}
                          >DZ</a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p style={{ color: 'var(--text-faint)', fontSize: '9px', marginTop: 10, letterSpacing: '0.5px' }}>
            Fãns = Deezer · Demand = score composto (frequência × views médias) · Sat. = saturação do mercado de type beats
          </p>
        </div>
      )}

      {/* ── OPORTUNIDADES tab ────────────────────────────────────────────────── */}
      {tab === 'oportunidades' && (
        <div>
          <p style={{ color: 'var(--text-faint)', fontSize: '10px', marginBottom: '14px', letterSpacing: '1px', lineHeight: '1.6' }}>
            Artistas com muitos fãs mas poucos type beats no YouTube = mercado inexplorado = menos concorrência = mais fácil de rankear.<br/>
            <span style={{ color: 'var(--text-faint)', fontSize: '9px' }}>Fórmula: (fãs Deezer / 1M) × 15 ÷ √(n° beats + 1)</span>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
            {topOpp.slice(0, 8).map((a, i) => {
              const opp  = a.opportunityScore ?? 0
              const color = opp >= 70 ? '#00ff00' : opp >= 40 ? '#aaff00' : '#ffaa00'
              const filled = Math.round((opp / 100) * 16)
              return (
                <div key={a.name} style={{ padding: '12px', border: `1px solid ${color}22`, backgroundColor: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Avatar a={a} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--text-bright)', fontWeight: 'bold', fontSize: '13px' }}>{a.name}</span>
                        {i === 0 && <span style={{ fontSize: '9px', color: '#aaff00', padding: '1px 5px', border: '1px solid #aaff0033' }}>💎 TOP OPP</span>}
                      </div>
                      {a.deezerFans ? <p style={{ color: 'var(--text-faint)', fontSize: '10px', margin: '2px 0 0' }}>{fmtNum(a.deezerFans)} fãs · {a.beatCount} type beats/mês</p>
                        : <p style={{ color: 'var(--text-faint)', fontSize: '10px', margin: '2px 0 0' }}>{a.beatCount} type beats este mês</p>}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-faint)', fontSize: '9px', letterSpacing: '1px' }}>OPPORTUNITY SCORE</span>
                      <span style={{ color, fontSize: '11px', fontWeight: 'bold' }}>{opp}/100</span>
                    </div>
                    <div style={{ backgroundColor: 'var(--border)', height: '3px' }}>
                      <div style={{ height: '100%', width: `${opp}%`, backgroundColor: color }} />
                    </div>
                    <p style={{ fontSize: '9px', letterSpacing: '-0.5px', color: 'var(--text-faint)', margin: '2px 0 0' }}>
                      {'█'.repeat(filled)}{'░'.repeat(16 - filled)}
                    </p>
                  </div>

                  {a.vibes && a.vibes.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {a.vibes.map(v => <span key={v} style={{ fontSize: '9px', padding: '1px 5px', border: '1px solid var(--border)', color: 'var(--text-faint)' }}>{v}</span>)}
                    </div>
                  )}

                  <p style={{ color: 'var(--text-faint)', fontSize: '10px', lineHeight: '1.5', margin: 0 }}>
                    {opp >= 70
                      ? `Poucos produtores cobrem ${a.name} → grande janela de oportunidade agora.`
                      : opp >= 40
                      ? `Mercado moderado — há espaço para um beat de qualidade destacar.`
                      : `Mercado mais competitivo mas com audience garantida.`}
                  </p>

                  <a href={ytLink(a.name)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '7px', textAlign: 'center', border: `1px solid ${color}55`, color, fontSize: '10px', textDecoration: 'none', letterSpacing: '1px', fontFamily: 'Courier New, monospace', fontWeight: 'bold' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = `${color}11` }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                  >
                    ▶ CRIAR {a.name.toUpperCase()} TYPE BEAT
                  </a>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── INSPIRAÇÃO tab ───────────────────────────────────────────────────── */}
      {tab === 'inspiracao' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Daily tip */}
          <div style={{ padding: '12px 16px', border: '1px solid var(--accent-border)', backgroundColor: 'var(--accent-muted)' }}>
            <p style={{ color: 'var(--accent)', fontSize: '10px', letterSpacing: '2px', margin: '0 0 6px' }}>
              ┌─ DIA A DIA · {tipToday.day}
            </p>
            <p style={{ color: 'var(--text-bright)', fontSize: '12px', margin: '0 0 6px', lineHeight: '1.6' }}>{tipToday.tip}</p>
            <p style={{ color: 'var(--accent)', fontSize: '10px', margin: 0, letterSpacing: '0.5px' }}>→ {tipToday.action}</p>
          </div>

          {/* Beat ideas from top 5 artists */}
          <div>
            <p style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px', margin: '0 0 10px' }}>
              ┌─ IDEIAS DE BEAT · baseado nos trends de {monthLabel}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {artists.slice(0, 6).map((a) => {
                const idea = a.beatIdea
                if (!idea) return null
                return (
                  <div key={a.name} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 12px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}>
                    <Avatar a={a} size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-bright)', fontWeight: 'bold', fontSize: '12px' }}>{a.name} Type Beat</span>
                        <span style={{ color: 'var(--text-faint)', fontSize: '9px', padding: '1px 5px', border: '1px solid var(--border)' }}>{idea.bpm} BPM</span>
                        {idea.keys.slice(0, 2).map(k => (
                          <span key={k} style={{ color: 'var(--accent)', fontSize: '9px', padding: '1px 5px', border: '1px solid var(--accent-border)', backgroundColor: 'var(--accent-muted)' }}>{k}</span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {idea.elements.map((el, i) => (
                          <span key={i} style={{ fontSize: '9px', color: 'var(--text-faint)', padding: '1px 6px', border: '1px solid var(--border)' }}>{el}</span>
                        ))}
                      </div>
                      {a.vibes && a.vibes.length > 0 && (
                        <p style={{ color: 'var(--text-faint)', fontSize: '9px', margin: '4px 0 0', letterSpacing: '0.5px' }}>
                          vibes detectadas: {a.vibes.join(' · ')}
                        </p>
                      )}
                    </div>
                    <a href={ytLink(a.name)} target="_blank" rel="noopener noreferrer"
                      style={{ padding: '4px 8px', border: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: '9px', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--accent)'; el.style.borderColor = 'var(--accent-border)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = 'var(--text-dim)'; el.style.borderColor = 'var(--border)' }}
                    >▶ PESQUISAR</a>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Checklist */}
          <div style={{ padding: '12px 16px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}>
            <p style={{ color: 'var(--text-dim)', fontSize: '10px', letterSpacing: '1px', margin: '0 0 10px' }}>┌─ CHECKLIST DO PRODUTOR</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {[
                `Título com "Type Beat ${year}" + artista do ranking`,
                'Thumbnail 1280×720 com nome do artista e BPM visível',
                'Descrição com link BeatStars + hashtags (usa o Scheduler)',
                '808 calibrado: verifica que o kick não corta junto com o 808',
                'Export em WAV 44.1kHz 24bit + MP3 320kbps',
                'Tags: nome artista, tipo de beat, BPM, tom, ano',
                'Upload no YouTube + BeatStars no mesmo dia para indexar junto',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ color: 'var(--text-faint)', fontSize: '10px', flexShrink: 0, marginTop: 1 }}>□</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '10px', lineHeight: '1.5' }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '2px', margin: 0, opacity: 0.8 }}>
      ┌─ {children}
    </p>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function Overview({
  data, channelInfo: realChannel, loading,
  videos, videosLoading,
  trending, trendingLoading,
  trafficSources,
}: {
  data: DailyMetric[]
  channelInfo?: ChannelInfo | null
  loading?: boolean
  videos?: ApiVideo[] | null
  videosLoading?: boolean
  trending?: ArtistTrend[] | null
  trendingLoading?: boolean
  trafficSources?: TrafficSource[] | null
}) {
  const stats = useMemo(() => {
    if (!data.length) return null
    const totalViews     = data.reduce((s, d) => s + d.views, 0)
    const totalWatchTime = data.reduce((s, d) => s + d.watchTime, 0)
    const totalSubs      = data.reduce((s, d) => s + d.subscribers, 0)
    const totalRevenue   = data.reduce((s, d) => s + d.revenue, 0)
    const avgDuration    = data.reduce((s, d) => s + d.impressions, 0) / data.length
    const avgCtr         = data.reduce((s, d) => s + d.ctr, 0) / data.length
    return { totalViews, totalWatchTime, totalSubs, totalRevenue, avgDuration, avgCtr }
  }, [data])

  const topVideos = useMemo(
    () => videos?.slice(0, 5).map(apiToLocal) ?? [],
    [videos],
  )

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── CHANNEL ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SectionLabel>MEU CANAL ────────────────────────────────────────────────</SectionLabel>

        <div style={panel}>
          {realChannel
            ? <ChannelBanner info={realChannel} />
            : <p style={{ color: 'var(--text-faint)', fontSize: '11px', padding: '8px 0' }}>
                &gt; LOADING CHANNEL DATA...
              </p>
          }
        </div>

        {/* Stat cards */}
        {loading && !data.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height="60px" />)}
          </div>
        ) : stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            <StatCard label="Views"        value={fmtNum(stats.totalViews)}                     change={null} icon={<IconEye    size={22}/>} />
            <StatCard label="Watch Time"   value={`${(stats.totalWatchTime / 60).toFixed(0)}h`} change={null} icon={<IconClock  size={22}/>} />
            <StatCard label="New Subs"     value={`+${fmtNum(stats.totalSubs)}`}                change={null} icon={<IconUsers  size={22}/>} />
            <StatCard label="Revenue"      value={`$${stats.totalRevenue.toFixed(0)}`}          change={null} icon={<IconDollar size={22}/>} />
            <StatCard label="Avg Duration" value={fmtSecs(stats.avgDuration)}                   change={null} icon={<IconPlay   size={22}/>} />
            <StatCard label="Avg CTR"      value={stats.avgCtr > 0 ? fmtPct(stats.avgCtr) : '—'} change={null} icon={<IconCursor size={22}/>} />
          </div>
        ) : null}

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
          <ViewsChart data={data} />
          <TrafficSourcesChart sources={trafficSources ?? null} />
        </div>

        {/* Top videos */}
        <div style={panel}>
          <p style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px', opacity: 0.8 }}>
            ┌─ TOP VIDEOS ─────────────────────────────────────────
          </p>
          {videosLoading
            ? <SkeletonTable rows={5} />
            : <VideoTable videos={topVideos} compact />
          }
        </div>
      </div>

      {/* ── TOP ARTISTAS ────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SectionLabel>TOP ARTISTAS EM ALTA · INTELIGÊNCIA DE MERCADO ──────────────</SectionLabel>

        <div style={panel}>
          {trendingLoading ? (
            <SkeletonTable rows={8} />
          ) : trending && trending.length > 0 ? (
            <ArtistHub artists={trending} />
          ) : (
            <p style={{ color: 'var(--text-faint)', fontSize: '11px', padding: '16px 0', textAlign: 'center' }}>
              *** SEM DADOS — NENHUM TYPE BEAT ENCONTRADO OU INNERTUBE INDISPONÍVEL ***
            </p>
          )}
        </div>
      </div>

      {/* ── AI ANALYST ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SectionLabel>LAIS · ANALISTA DO CANAL ────────────────────────────────────</SectionLabel>
        <AIChat
          analytics={data.length ? data : null}
          channelInfo={realChannel ?? null}
          videos={videos ?? null}
          traffic={trafficSources ?? null}
        />
      </div>

    </div>
  )
}

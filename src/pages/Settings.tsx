import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { api } from '../lib/api'
import type { AccountsStatus, TikTokStatus } from '../lib/api'

const panel: CSSProperties = {
  backgroundColor: '#0d0d0d',
  borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
  borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
  padding: '12px',
  maxWidth: '600px',
}

function Toggle({ label, description, defaultChecked = false }: {
  label: string; description: string; defaultChecked?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: '1px solid #1a1a1a',
    }}>
      <div>
        <p style={{ color: '#c0c0c0', fontSize: '12px', margin: 0 }}>{label}</p>
        <p style={{ color: '#555555', fontSize: '10px', margin: '2px 0 0' }}>{description}</p>
      </div>
      <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '12px' }}>
        <input type="checkbox" defaultChecked={defaultChecked}
          style={{ accentColor: '#00ff00', width: '13px', height: '13px', cursor: 'pointer' }} />
        <span style={{ color: defaultChecked ? '#00ff00' : '#555555', fontSize: '10px', minWidth: '32px' }}>
          {defaultChecked ? '[ON]' : '[OFF]'}
        </span>
      </label>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={panel}>
      <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', marginBottom: '10px' }}>
        ┌─ {title} {'─'.repeat(Math.max(0, 40 - title.length))}
      </p>
      {children}
    </div>
  )
}

export function Settings({ onLogout }: { authenticated?: boolean; onLogout?: () => void }) {
  const [status, setStatus]         = useState<AccountsStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [tiktok, setTiktok]         = useState<TikTokStatus | null>(null)
  const [ttConnecting, setTtConn]   = useState(false)

  function loadStatus() {
    api.accounts.status().then(setStatus).catch(() => {})
    api.tiktok.status().then(setTiktok).catch(() => {})
  }

  useEffect(() => {
    loadStatus()
    const iv = setInterval(loadStatus, 4000)
    // Handle redirect back from TikTok OAuth
    const params = new URLSearchParams(window.location.search)
    if (params.get('tiktok') === 'ok') {
      window.history.replaceState({}, '', window.location.pathname)
      api.tiktok.status().then(setTiktok).catch(() => {})
    }
    return () => clearInterval(iv)
  }, [])

  async function handleConnect() {
    setConnecting(true)
    try {
      const { url } = await api.accounts.connect()
      window.open(url, '_blank', 'width=500,height=650')
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    await api.accounts.disconnect()
    loadStatus()
    if (onLogout) onLogout()
  }



  async function handleTikTokConnect() {
    setTtConn(true)
    try {
      const { url } = await api.tiktok.auth()
      window.open(url, '_blank', 'width=500,height=700')
    } finally {
      setTtConn(false)
    }
  }

  async function handleTikTokDisconnect() {
    await api.tiktok.logout()
    setTiktok(null)
    loadStatus()
  }

  const oauth = status?.oauth
  const keys  = status?.keys ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── CANAL PRINCIPAL ─────────────────────────────────────────────── */}
      <Section title="CANAL PRINCIPAL">
        {!oauth?.hasCredFile ? (
          <p style={{ color: '#555555', fontSize: '11px', lineHeight: '1.8' }}>
            Arquivo <span style={{ color: '#707070' }}>client_secret_1.json</span> não encontrado.<br />
            Baixe em Google Cloud Console → APIs &amp; Services → Credentials.
          </p>
        ) : (
          <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px', border: '1px solid #222222', backgroundColor: '#111111',
          }}>
            <div>
              {oauth.authenticated && oauth.channelName ? (
                <>
                  <p style={{ color: '#00ff00', fontSize: '12px', margin: 0, letterSpacing: '0.5px' }}>
                    ✓ {oauth.channelName}
                  </p>
                  <p style={{ color: '#555555', fontSize: '10px', margin: '2px 0 0' }}>
                    {oauth.channelHandle || ''}{oauth.accountEmail ? ` · ${oauth.accountEmail}` : ''}
                  </p>
                </>
              ) : (
                <p style={{ color: '#c0c0c0', fontSize: '12px', margin: 0, letterSpacing: '0.5px' }}>
                  OAuth 2.0 · YouTube Data + Analytics + Upload
                </p>
              )}
              <p style={{
                color: oauth.quotaExceeded ? '#ff6600' : oauth.authenticated ? '#336633' : '#555555',
                fontSize: '10px', margin: '4px 0 0', letterSpacing: '0.5px',
              }}>
                {oauth.quotaExceeded
                  ? '⚠ QUOTA EXCEDIDA — reset 05:00 BRT / 08:00 UTC'
                  : oauth.authenticated
                  ? 'conectado · YouTube Data + Analytics + Upload'
                  : '✗ NÃO CONECTADO'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              {oauth.authenticated && (
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  style={{
                    backgroundColor: '#0d0d0d',
                    color: connecting ? '#555555' : '#ffaa00',
                    border: '1px solid #3a2a00',
                    padding: '4px 10px', fontSize: '10px', cursor: connecting ? 'wait' : 'pointer',
                    fontFamily: 'Courier New, monospace', letterSpacing: '1px',
                  }}
                  title="Trocar conta Google"
                >
                  {connecting ? '[...]' : '[TROCAR CONTA]'}
                </button>
              )}
              <button
                onClick={oauth.authenticated ? handleDisconnect : handleConnect}
                disabled={connecting}
                style={{
                  backgroundColor: '#0d0d0d',
                  color:  oauth.authenticated ? '#ff4400' : connecting ? '#555555' : '#00ff00',
                  border: `1px solid ${oauth.authenticated ? '#3a1a1a' : '#1a3a1a'}`,
                  padding: '4px 12px', fontSize: '11px', cursor: connecting ? 'wait' : 'pointer',
                  fontFamily: 'Courier New, monospace', letterSpacing: '1px',
                }}
              >
                {oauth.authenticated
                  ? '[DISCONNECT]'
                  : connecting ? '[ABRINDO...]' : '[CONNECT YOUTUBE]'}
              </button>
            </div>
          </div>

          {/* Wrong channel warning */}
          {oauth.authenticated && oauth.channelHandle && !oauth.channelHandle.toLowerCase().includes('prodbygrillo') && (
            <div style={{
              marginTop: '8px', padding: '8px 10px',
              border: '1px solid #553300', backgroundColor: '#1a0a00',
            }}>
              <p style={{ color: '#ff6600', fontSize: '10px', margin: '0 0 4px', letterSpacing: '1px' }}>
                ⚠ CONTA ERRADA DETECTADA
              </p>
              <p style={{ color: '#884422', fontSize: '10px', margin: '0 0 6px', lineHeight: 1.6 }}>
                Canal conectado: <strong style={{ color: '#cc6633' }}>{oauth.channelHandle}</strong> — não é o canal prodbygrillo.
              </p>
              <p style={{ color: '#664422', fontSize: '10px', margin: 0, lineHeight: 1.7 }}>
                1. Clica [DISCONNECT]<br />
                2. Vai ao <strong>youtube.com</strong> e muda para o canal <strong>@prodbygrillo</strong><br />
                3. Volta aqui e clica [CONNECT YOUTUBE]<br />
                4. Na janela do Google, escolhe o email associado ao canal prodbygrillo
              </p>
            </div>
          )}
          </>
        )}
        <p style={{ color: '#333333', fontSize: '10px', marginTop: '8px', lineHeight: '1.6' }}>
          Acesso completo: analytics, dados do canal, upload de vídeos. Requer OAuth com sua conta Google.
        </p>
      </Section>

      {/* ── TIKTOK ──────────────────────────────────────────────────────── */}
      <Section title="TIKTOK">
        {!tiktok?.configured ? (
          <p style={{ color: '#555555', fontSize: '11px', lineHeight: '1.8' }}>
            Adicione <span style={{ color: '#707070' }}>TIKTOK_CLIENT_SECRET</span> no arquivo <span style={{ color: '#707070' }}>.env</span> para ativar.
          </p>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px', border: '1px solid #222222', backgroundColor: '#111111',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {tiktok?.user?.avatar_url && (
                <img
                  src={tiktok.user.avatar_url}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #333333', objectFit: 'cover' }}
                />
              )}
              <div>
                <p style={{ color: '#c0c0c0', fontSize: '12px', margin: 0, letterSpacing: '0.5px' }}>
                  {tiktok?.user?.display_name
                    ? `@${tiktok.user.display_name}${tiktok.user.is_verified ? ' ✓' : ''}`
                    : 'OAuth 2.0 · TikTok Content API'}
                </p>
                {tiktok?.user ? (
                  <p style={{ color: '#555555', fontSize: '10px', margin: '3px 0 0' }}>
                    {tiktok.user.follower_count.toLocaleString()} seguidores ·{' '}
                    {tiktok.user.video_count} vídeos
                  </p>
                ) : (
                  <p style={{
                    color: tiktok?.authenticated ? '#00ff00' : '#555555',
                    fontSize: '10px', margin: '4px 0 0', letterSpacing: '0.5px',
                  }}>
                    {tiktok?.authenticated ? '✓ CONECTADO' : '✗ NÃO CONECTADO'}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={tiktok?.authenticated ? handleTikTokDisconnect : handleTikTokConnect}
              disabled={ttConnecting}
              style={{
                backgroundColor: '#0d0d0d',
                color:  tiktok?.authenticated ? '#ff4400' : ttConnecting ? '#555555' : '#ff0050',
                border: `1px solid ${tiktok?.authenticated ? '#3a1a1a' : '#3a001a'}`,
                padding: '4px 12px', fontSize: '11px', cursor: ttConnecting ? 'wait' : 'pointer',
                fontFamily: 'Courier New, monospace', letterSpacing: '1px',
              }}
            >
              {tiktok?.authenticated
                ? '[DISCONNECT]'
                : ttConnecting ? '[ABRINDO...]' : '[CONNECT TIKTOK]'}
            </button>
          </div>
        )}
        <p style={{ color: '#333333', fontSize: '10px', marginTop: '8px', lineHeight: '1.6' }}>
          Uploads vão para o inbox do TikTok como rascunho. Publica diretamente no app após aprovação do TikTok Developer Portal.
        </p>
      </Section>

      {/* ── QUOTA KEYS ──────────────────────────────────────────────────── */}
      <Section title="QUOTA KEYS (YouTube Data API)">
        {keys.length === 0 ? (
          <p style={{ color: '#555555', fontSize: '11px', lineHeight: '1.8' }}>
            Nenhuma quota key configurada.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
            {keys.map(k => (
              <div key={k.n} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', border: '1px solid #1a1a1a', backgroundColor: '#111111',
              }}>
                <div>
                  <p style={{ color: '#c0c0c0', fontSize: '11px', margin: 0, letterSpacing: '1px' }}>
                    {k.label}
                    {k.active && (
                      <span style={{ color: '#00ff00', fontSize: '9px', marginLeft: '8px' }}>[ATIVA]</span>
                    )}
                  </p>
                  <p style={{
                    color: k.quotaExceeded ? '#ff6600' : k.active ? '#00ff00' : '#555555',
                    fontSize: '10px', margin: '2px 0 0',
                  }}>
                    {k.quotaExceeded ? '⚠ QUOTA EXCEDIDA' : k.active ? 'EM USO' : 'DISPONÍVEL'}
                  </p>
                </div>
                <span style={{ color: '#333333', fontSize: '10px', fontFamily: 'Courier New, monospace' }}>
                  API KEY
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Instructions */}
        <div style={{
          backgroundColor: '#080808', border: '1px solid #1a1a1a',
          padding: '10px 12px',
        }}>
          <p style={{ color: '#555555', fontSize: '10px', margin: '0 0 6px', letterSpacing: '1px' }}>
            &gt; COMO ADICIONAR UMA QUOTA KEY:
          </p>
          <p style={{ color: '#707070', fontSize: '10px', margin: 0, lineHeight: '1.8' }}>
            1. Crie um projeto no{' '}
            <span style={{ color: '#505050' }}>Google Cloud Console</span><br />
            2. Ative a <span style={{ color: '#505050' }}>YouTube Data API v3</span><br />
            3. Crie uma <span style={{ color: '#505050' }}>API Key</span> (sem restrição de OAuth)<br />
            4. Adicione ao arquivo <span style={{ color: '#505050' }}>.env</span>:
          </p>
          <pre style={{ color: '#00cc00', fontSize: '10px', margin: '8px 0 0', letterSpacing: '0.5px' }}>
{`YT_API_KEY_${keys.length + 2}=AIzaSy...`}
          </pre>
          <p style={{ color: '#333333', fontSize: '10px', margin: '6px 0 0' }}>
            Reinicie o servidor após salvar. Cada key tem 10.000 unidades/dia.
          </p>
        </div>

        <p style={{ color: '#333333', fontSize: '10px', marginTop: '8px', lineHeight: '1.6' }}>
          Usadas apenas para buscas públicas (trending, search). Sem acesso a analytics ou upload.
          Rotação automática quando quota esgotada — fallback para canal principal.
        </p>
      </Section>

      {/* ── rest ──────────────────────────────────────────────────────────── */}
      <Section title="NOTIFICATIONS">
        <Toggle label="MILESTONE ALERTS" description="notify when hitting subscriber/view milestones" defaultChecked />
        <Toggle label="DAILY DIGEST"     description="daily summary of channel performance" defaultChecked />
        <Toggle label="NEW COMMENTS"     description="alert when top videos receive new comments" />
        <Toggle label="REVENUE DROPS"    description="alert when RPM drops more than 20%" defaultChecked />
      </Section>

      <Section title="DISPLAY">
        <Toggle label="SCANLINES"       description="enable CRT scanline overlay effect" defaultChecked />
        <Toggle label="COMPACT SIDEBAR" description="collapse sidebar by default" />
        <Toggle label="SHOW REVENUE"    description="display monetary data across all pages" defaultChecked />
      </Section>

      <Section title="DATA & PRIVACY">
        <Toggle label="ANALYTICS SHARING" description="share anonymous usage data" />
        <Toggle label="LOCAL CACHE"       description="store metrics locally for faster loading" defaultChecked />
      </Section>

      <Section title="EXPORT">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {['> EXPORT AS CSV', '> EXPORT AS PDF REPORT', '> EXPORT RAW JSON'].map(label => (
            <button key={label} style={{
              textAlign: 'left', padding: '6px 8px',
              backgroundColor: '#0d0d0d', color: '#707070',
              border: '1px solid #333333', cursor: 'pointer',
              fontSize: '12px', fontFamily: 'Courier New, monospace', letterSpacing: '0.5px',
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#141414'
                ;(e.currentTarget as HTMLElement).style.color = '#c0c0c0'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#0d0d0d'
                ;(e.currentTarget as HTMLElement).style.color = '#707070'
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <p style={{ color: '#333333', fontSize: '10px', textAlign: 'center', paddingBottom: '8px', maxWidth: '600px' }}>
        *** prodbygrillo-dashboard v1.0.0 | react + recharts | mIRC theme ***
      </p>
    </div>
  )
}

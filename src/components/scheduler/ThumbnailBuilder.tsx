import { useEffect, useRef, useState } from 'react'

interface ArtistResult { url: string; title: string; channelId?: string }

interface Props {
  beatName: string
  artists: string[]
  onReady: (dataUrl: string) => void
}

const btn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #333333',
  color: '#707070',
  fontSize: '10px',
  padding: '3px 10px',
  cursor: 'pointer',
  fontFamily: 'Courier New, monospace',
  letterSpacing: '1px',
}

export function ThumbnailBuilder({ beatName, artists, onReady }: Props) {
  const canvasRef                           = useRef<HTMLCanvasElement>(null)
  const [results, setResults]               = useState<ArtistResult[]>([])
  const [idx, setIdx]                       = useState(0)
  const [loading, setLoading]               = useState(false)
  const [previewUrl, setPreviewUrl]         = useState<string | null>(null)
  const [currentArtist, setCurrentArtist]   = useState<string>('')

  // Fetch photos for up to 3 artists in parallel (Deezer — no quota)
  useEffect(() => {
    if (!artists.length) return
    setLoading(true)
    setCurrentArtist(artists[0])

    Promise.all(
      artists.slice(0, 3).map(name =>
        fetch(`/api/upload/artist-photo?name=${encodeURIComponent(name)}`)
          .then(r => r.json())
          .then(data => ({ name, items: (data.results || []) as ArtistResult[] }))
          .catch(() => ({ name, items: [] as ArtistResult[] }))
      )
    ).then(responses => {
      const seen = new Set<string>()
      const combined: ArtistResult[] = []
      for (const { name, items } of responses) {
        let added = 0
        for (const item of items) {
          if (added >= 3 || seen.has(item.url)) continue
          seen.add(item.url)
          combined.push(item)
          added++
        }
        if (combined.length > 0 && currentArtist === artists[0]) setCurrentArtist(name)
      }
      setResults(combined)
      setIdx(0)
      if (!combined.length) setCurrentArtist(artists[0])
    }).finally(() => setLoading(false))
  }, [artists])

  // Redraw canvas whenever result index changes
  useEffect(() => {
    const current = results[idx]
    if (!current?.url) {
      drawWithoutPhoto()
      return
    }
    const proxied = `/api/upload/proxy-image?url=${encodeURIComponent(current.url)}`
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => draw(img)
    img.onerror = ()  => drawWithoutPhoto()
    img.src = proxied
  }, [results, idx, beatName])

  function draw(img: HTMLImageElement) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = 1280, H = 720, PW = 768

    // Background
    ctx.fillStyle = '#0a0a0f'
    ctx.fillRect(0, 0, W, H)

    // Artist photo — object-fit:cover on left 60%
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, PW, H)
    ctx.clip()
    const scale = Math.max(PW / img.width, H / img.height)
    const iw = img.width * scale, ih = img.height * scale
    ctx.drawImage(img, (PW - iw) / 2, (H - ih) / 2, iw, ih)
    ctx.restore()

    // Gradient fade: photo → black
    const grad = ctx.createLinearGradient(PW * 0.3, 0, PW, 0)
    grad.addColorStop(0, 'rgba(10,10,15,0)')
    grad.addColorStop(1, 'rgba(10,10,15,1)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, PW, H)

    renderText(ctx)
    exportCanvas(canvas)
  }

  function drawWithoutPhoto() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    // Full black background with subtle left gradient
    ctx.fillStyle = '#0a0a0f'
    ctx.fillRect(0, 0, 1280, 720)
    const grad = ctx.createLinearGradient(0, 0, 500, 0)
    grad.addColorStop(0, '#0f1a0f')
    grad.addColorStop(1, '#0a0a0f')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 500, 720)

    renderText(ctx)
    exportCanvas(canvas)
  }

  function renderText(ctx: CanvasRenderingContext2D) {
    const cx   = 1028  // center of right half (768–1280)
    const maxW = 460

    ctx.textAlign    = 'center'
    ctx.textBaseline = 'alphabetic'

    // Beat name — wrap to max 3 lines
    ctx.font = 'bold 100px Impact, "Arial Black", sans-serif'
    const words = beatName.toUpperCase().replace(/[()]/g, '').split(' ')
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = w }
      else line = test
    }
    if (line) lines.push(line)
    const display = lines.slice(0, 3)

    const LINE_H  = 108
    const TYPE_H  = 64
    const totalH  = display.length * LINE_H + TYPE_H + 40
    const startY  = Math.round((720 - totalH) / 2) + LINE_H

    // Drop shadow pass
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur  = 18
    ctx.fillStyle   = '#ffffff'
    display.forEach((l, i) => ctx.fillText(l, cx, startY + i * LINE_H, maxW))

    // TYPE BEAT
    const tyY = startY + display.length * LINE_H + 24
    ctx.fillStyle = '#f5e040'
    ctx.font      = 'bold 58px Impact, "Arial Black", sans-serif'
    ctx.fillText('TYPE BEAT', cx, tyY, maxW)

    // Yellow bar below TYPE BEAT
    ctx.shadowBlur = 0
    ctx.fillStyle  = '#f5e040'
    ctx.fillRect(cx - 90, tyY + 14, 180, 5)

    // Credit — "prodbygrillo" only, no "prod."
    ctx.textBaseline = 'bottom'
    ctx.fillStyle    = 'rgba(255,255,255,0.55)'
    ctx.font         = 'bold 22px "Courier New", monospace'
    ctx.fillText('prodbygrillo', cx, 710, maxW)
  }

  function exportCanvas(canvas: HTMLCanvasElement) {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setPreviewUrl(dataUrl)
    onReady(dataUrl)
  }

  const canGoNext = idx < results.length - 1

  return (
    <div style={{
      backgroundColor: '#0d0d0d',
      borderTop: '2px solid #555555', borderLeft: '2px solid #555555',
      borderRight: '2px solid #1a1a1a', borderBottom: '2px solid #1a1a1a',
      padding: '12px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <p style={{ color: '#00ff00', fontSize: '11px', letterSpacing: '1px', margin: 0 }}>
          ┌─ THUMBNAIL AUTOMÁTICA · 1280×720
        </p>
        <div style={{ display: 'flex', gap: '6px' }}>
          {canGoNext && (
            <button
              onClick={() => setIdx(i => i + 1)}
              style={btn}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}
            >
              [ REGENERAR ]
            </button>
          )}
          {previewUrl && (
            <a
              href={previewUrl}
              download={`${beatName.slice(0, 40)}-thumbnail.jpg`}
              style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c0c0c0' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#707070' }}
            >
              [ DOWNLOAD ]
            </a>
          )}
        </div>
      </div>

      {/* Hidden canvas */}
      <canvas ref={canvasRef} width={1280} height={720} style={{ display: 'none' }} />

      {/* Preview */}
      <div style={{
        aspectRatio: '16/9',
        backgroundColor: '#060606',
        border: '1px solid #1a1a1a',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {loading ? (
          <p style={{ color: '#333333', fontSize: '11px', letterSpacing: '2px' }}>
            BUSCANDO FOTO DO ARTISTA<span className="blink">_</span>
          </p>
        ) : previewUrl ? (
          <img src={previewUrl} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} alt="thumbnail" />
        ) : (
          <p style={{ color: '#333333', fontSize: '11px', letterSpacing: '2px' }}>
            GERANDO<span className="blink">_</span>
          </p>
        )}
      </div>

      {/* Caption */}
      <p style={{ color: '#333333', fontSize: '10px', margin: '5px 0 0', letterSpacing: '0.5px' }}>
        {results[idx]
          ? `Foto: ${results[idx].title} · ${idx + 1}/${results.length}`
          : currentArtist ? `Sem foto: ${currentArtist}` : ''}
      </p>
    </div>
  )
}

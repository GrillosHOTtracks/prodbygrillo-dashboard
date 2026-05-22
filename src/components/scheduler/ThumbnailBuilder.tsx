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
  const [quotaError, setQuotaError]         = useState(false)

  // Fetch artist photos on mount
  useEffect(() => {
    if (!artists.length) return
    const name = artists[0]
    setCurrentArtist(name)
    setLoading(true)
    setQuotaError(false)

    fetch(`http://localhost:3010/api/upload/artist-photo?name=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(data => {
        if (data.code === 'quotaExceeded') { setQuotaError(true); return }
        const list: ArtistResult[] = data.results || []
        setResults(list)
        setIdx(0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [artists])

  // Redraw canvas whenever result index changes
  useEffect(() => {
    const current = results[idx]
    if (!current?.url) {
      drawWithoutPhoto()
      return
    }
    const proxied = `http://localhost:3010/api/upload/proxy-image?url=${encodeURIComponent(current.url)}`
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
    const tx = 800, maxW = 440

    ctx.textAlign    = 'left'
    ctx.textBaseline = 'top'

    // Beat name — wrap into lines
    ctx.font = 'bold 86px Impact, "Arial Black", sans-serif'
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

    ctx.fillStyle = '#ffffff'
    display.forEach((l, i) => ctx.fillText(l, tx, 180 + i * 94, maxW))

    // TYPE BEAT
    const tyY = 180 + display.length * 94 + 18
    ctx.fillStyle = '#f5e040'
    ctx.font      = 'bold 50px Impact, "Arial Black", sans-serif'
    ctx.fillText('TYPE BEAT', tx, tyY, maxW)

    // Yellow separator bar
    ctx.fillStyle = '#f5e040'
    ctx.fillRect(tx, tyY + 66, 210, 4)

    // Footer
    ctx.textBaseline = 'bottom'
    ctx.fillStyle    = 'rgba(255,255,255,0.38)'
    ctx.font         = '22px "Courier New", monospace'
    ctx.fillText('prod. prodbygrillo', tx, 704)
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
        ) : quotaError ? (
          <p style={{ color: '#555555', fontSize: '10px', letterSpacing: '1px' }}>
            ⚠ QUOTA EXCEDIDA — thumbnail sem foto
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

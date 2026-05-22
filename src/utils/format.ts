export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

export function fmtNumFull(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

export function fmtMinutes(mins: number): string {
  if (mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0)     return `${m}m`
  if (h >= 1_000)  return `${(h / 1_000).toFixed(1)}Kh`
  return m === 0   ? `${h}h` : `${h}h ${m}m`
}

export function fmtSecs(s: number): string {
  if (s <= 0) return '—'
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

export function fmtPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`
}

export function fmtMoney(n: number): string {
  return `$${n.toFixed(0)}`
}

export function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

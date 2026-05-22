const base: React.CSSProperties = {
  display: 'block',
  backgroundColor: '#141414',
  backgroundImage: 'linear-gradient(90deg, #141414 25%, #1e1e1e 50%, #141414 75%)',
  backgroundSize: '400px 100%',
  animation: 'shimmer 1.6s ease-in-out infinite',
}

export function SkeletonLine({ width = '100%', height = '12px', style }: {
  width?: string | number
  height?: string | number
  style?: React.CSSProperties
}) {
  return <span style={{ ...base, width, height, ...style }} />
}

export function SkeletonCard({ height = '80px' }: { height?: string | number }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      border: '1px solid var(--border)',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      <SkeletonLine width="60%" height="10px" />
      <SkeletonLine width="40%" height="22px" />
      <SkeletonLine width="100%" height={height} />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div style={{ display: 'flex', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <SkeletonLine width="24px" height="12px" />
      <SkeletonLine width="45%" height="12px" />
      <SkeletonLine width="60px" height="12px" style={{ marginLeft: 'auto' }} />
      <SkeletonLine width="50px" height="12px" />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  )
}

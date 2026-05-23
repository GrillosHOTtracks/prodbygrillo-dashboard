// Pixel art isometric 3D SVG icons — 24x24 viewBox, 2px pixel grid
// Face: #00ff00 | Mid: #00cc00 | Shadow R: #007700 | Deep: #003300 | Screen: #001100

const crisp: React.SVGProps<SVGSVGElement> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  shapeRendering: 'crispEdges' as const,
}

// ─── CRT Monitor ──────────────────────────────────────────────────────────────
export function IconMonitor({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* 3D depth - bottom shadow */}
      <rect x="4" y="16" width="18" height="2" fill="#003300"/>
      {/* 3D depth - right shadow */}
      <rect x="20" y="4" width="2" height="12" fill="#005500"/>
      {/* Monitor casing - front face */}
      <rect x="2" y="2" width="18" height="14" fill="#00cc00"/>
      {/* Left/top highlight edge */}
      <rect x="2" y="2" width="18" height="1" fill="#00ff00"/>
      <rect x="2" y="2" width="1" height="14" fill="#00ff00"/>
      {/* Screen bezel */}
      <rect x="3" y="3" width="16" height="12" fill="#001a00"/>
      {/* Screen */}
      <rect x="4" y="4" width="14" height="10" fill="#001100"/>
      {/* Scanlines / terminal content */}
      <rect x="5" y="5"  width="12" height="1" fill="#00ff00"/>
      <rect x="5" y="7"  width="8"  height="1" fill="#00ff00"/>
      <rect x="5" y="9"  width="11" height="1" fill="#00ff00"/>
      <rect x="5" y="11" width="6"  height="1" fill="#00ff00"/>
      {/* Blink cursor */}
      <rect x="11" y="11" width="2" height="1" fill="#00ff00"/>
      {/* Stand neck */}
      <rect x="9"  y="16" width="4" height="2" fill="#00cc00"/>
      <rect x="11" y="16" width="2" height="2" fill="#007700"/>
      {/* Stand base */}
      <rect x="7"  y="18" width="8" height="2" fill="#00cc00"/>
      <rect x="7"  y="19" width="8" height="1" fill="#005500"/>
    </svg>
  )
}

// ─── Camcorder ────────────────────────────────────────────────────────────────
export function IconCamera({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* 3D depth shadow */}
      <rect x="2"  y="16" width="14" height="2" fill="#003300"/>
      <rect x="14" y="8"  width="2"  height="8"  fill="#005500"/>
      {/* Camera body */}
      <rect x="2" y="8" width="12" height="8" fill="#00cc00"/>
      {/* Body highlight */}
      <rect x="2" y="8" width="12" height="1" fill="#00ff00"/>
      <rect x="2" y="8" width="1"  height="8" fill="#00ff00"/>
      {/* Viewfinder on top */}
      <rect x="8"  y="5" width="6" height="3" fill="#00cc00"/>
      <rect x="8"  y="5" width="6" height="1" fill="#00ff00"/>
      <rect x="9"  y="6" width="4" height="2" fill="#001a00"/>
      {/* Lens housing */}
      <rect x="3" y="9"  width="7" height="6" fill="#001a00"/>
      {/* Lens ring outer */}
      <rect x="4" y="10" width="5" height="4" fill="#007700"/>
      {/* Lens glass */}
      <rect x="5" y="11" width="3" height="2" fill="#003300"/>
      {/* Lens reflection */}
      <rect x="5" y="11" width="1" height="1" fill="#00ff00"/>
      {/* Record button */}
      <rect x="10" y="9" width="2" height="2" fill="#660000"/>
      <rect x="10" y="9" width="1" height="1" fill="#ff0000"/>
      {/* Cassette slot */}
      <rect x="6"  y="15" width="6" height="1" fill="#007700"/>
      {/* Tape reel (side) */}
      <rect x="16" y="9"  width="6" height="5" fill="#009900"/>
      <rect x="16" y="9"  width="6" height="1" fill="#00cc00"/>
      <rect x="21" y="10" width="1" height="4" fill="#007700"/>
      <rect x="17" y="11" width="4" height="2" fill="#007700"/>
    </svg>
  )
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────
export function IconBarChart({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Floor */}
      <rect x="2" y="19" width="20" height="1" fill="#007700"/>
      {/* Y-axis */}
      <rect x="2" y="4"  width="1"  height="15" fill="#007700"/>

      {/* Bar 1 - left, short — 3D */}
      <rect x="4" y="18" width="1" height="1" fill="#003300"/>
      <rect x="4" y="14" width="4" height="5" fill="#00cc00"/>
      <rect x="4" y="13" width="4" height="1" fill="#00ff00"/>
      <rect x="8" y="14" width="1" height="5" fill="#007700"/>

      {/* Bar 2 - middle, tallest — 3D */}
      <rect x="10" y="18" width="1" height="1" fill="#003300"/>
      <rect x="10" y="6"  width="4" height="13" fill="#00cc00"/>
      <rect x="10" y="5"  width="4" height="1"  fill="#00ff00"/>
      <rect x="14" y="6"  width="1" height="13" fill="#007700"/>

      {/* Bar 3 - right, medium — 3D */}
      <rect x="16" y="18" width="1" height="1" fill="#003300"/>
      <rect x="16" y="10" width="4" height="9" fill="#00cc00"/>
      <rect x="16" y="9"  width="4" height="1" fill="#00ff00"/>
      <rect x="20" y="10" width="1" height="9" fill="#007700"/>

      {/* Grid dots */}
      <rect x="3" y="5"  width="1" height="1" fill="#005500"/>
      <rect x="3" y="9"  width="1" height="1" fill="#005500"/>
      <rect x="3" y="13" width="1" height="1" fill="#005500"/>
      <rect x="3" y="17" width="1" height="1" fill="#005500"/>
    </svg>
  )
}

// ─── Audience (3 pixel people) ────────────────────────────────────────────────
export function IconAudience({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Person 1 — left */}
      {/* Head */}
      <rect x="2" y="3" width="4" height="4" fill="#00cc00"/>
      <rect x="2" y="3" width="4" height="1" fill="#00ff00"/>
      <rect x="2" y="3" width="1" height="4" fill="#00ff00"/>
      {/* Body */}
      <rect x="2" y="7"  width="4" height="5" fill="#00cc00"/>
      {/* Arms */}
      <rect x="0" y="8"  width="2" height="3" fill="#007700"/>
      <rect x="6" y="8"  width="2" height="3" fill="#007700"/>
      {/* Legs */}
      <rect x="2" y="12" width="2" height="4" fill="#007700"/>
      <rect x="4" y="12" width="2" height="4" fill="#007700"/>
      {/* Shadow */}
      <rect x="1" y="16" width="7" height="1" fill="#003300"/>

      {/* Person 2 — right, slightly larger (closer) */}
      {/* Head */}
      <rect x="14" y="2" width="5" height="5" fill="#00cc00"/>
      <rect x="14" y="2" width="5" height="1" fill="#00ff00"/>
      <rect x="14" y="2" width="1" height="5" fill="#00ff00"/>
      {/* Body */}
      <rect x="14" y="7"  width="5" height="6" fill="#00cc00"/>
      {/* Arms */}
      <rect x="11" y="8"  width="3" height="4" fill="#007700"/>
      <rect x="19" y="8"  width="3" height="4" fill="#007700"/>
      {/* Legs */}
      <rect x="14" y="13" width="2" height="5" fill="#007700"/>
      <rect x="17" y="13" width="2" height="5" fill="#007700"/>
      {/* Shadow */}
      <rect x="13" y="18" width="9" height="1" fill="#003300"/>

      {/* Person 3 — center, behind */}
      <rect x="9" y="5"  width="4" height="3" fill="#009900"/>
      <rect x="9" y="5"  width="4" height="1" fill="#00dd00"/>
      <rect x="9" y="8"  width="4" height="5" fill="#009900"/>
      <rect x="9" y="13" width="2" height="3" fill="#007700"/>
      <rect x="11" y="13" width="2" height="3" fill="#007700"/>
    </svg>
  )
}

// ─── Coin / Money ─────────────────────────────────────────────────────────────
export function IconCoin({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* 3D cylinder depth (stack edge) */}
      <rect x="3"  y="14" width="18" height="3" fill="#005500"/>
      <rect x="3"  y="16" width="18" height="1" fill="#003300"/>
      {/* Outer coin circle — built from rects */}
      <rect x="5"  y="3"  width="14" height="2" fill="#00cc00"/>
      <rect x="3"  y="5"  width="18" height="9" fill="#00cc00"/>
      <rect x="5"  y="14" width="14" height="2" fill="#00cc00"/>
      {/* Inner coin (face) */}
      <rect x="6"  y="4"  width="12" height="1" fill="#00ff00"/>
      <rect x="4"  y="5"  width="16" height="9" fill="#00ff00"/>
      <rect x="6"  y="14" width="12" height="1" fill="#00ff00"/>
      {/* Rim left highlight */}
      <rect x="3"  y="5"  width="1"  height="9" fill="#00ff00"/>
      {/* Rim right shadow */}
      <rect x="20" y="5"  width="1"  height="9" fill="#007700"/>
      {/* Dollar sign */}
      <rect x="11" y="5"  width="2"  height="1" fill="#00cc00"/>
      <rect x="10" y="6"  width="4"  height="1" fill="#003300"/>
      <rect x="9"  y="7"  width="2"  height="2" fill="#003300"/>
      <rect x="10" y="9"  width="4"  height="1" fill="#003300"/>
      <rect x="13" y="10" width="2"  height="2" fill="#003300"/>
      <rect x="10" y="12" width="4"  height="1" fill="#003300"/>
      <rect x="11" y="13" width="2"  height="1" fill="#00cc00"/>
      {/* $ vertical bar */}
      <rect x="11" y="5"  width="2"  height="10" fill="#003300"/>
    </svg>
  )
}

// ─── Gear ─────────────────────────────────────────────────────────────────────
export function IconGear({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Teeth top */}
      <rect x="8"  y="1"  width="3"  height="3" fill="#00cc00"/>
      <rect x="13" y="1"  width="3"  height="3" fill="#00cc00"/>
      {/* Teeth bottom */}
      <rect x="8"  y="20" width="3"  height="3" fill="#007700"/>
      <rect x="13" y="20" width="3"  height="3" fill="#007700"/>
      {/* Teeth left */}
      <rect x="1"  y="8"  width="3"  height="3" fill="#00cc00"/>
      <rect x="1"  y="13" width="3"  height="3" fill="#00cc00"/>
      {/* Teeth right */}
      <rect x="20" y="8"  width="3"  height="3" fill="#007700"/>
      <rect x="20" y="13" width="3"  height="3" fill="#007700"/>
      {/* Teeth diagonal */}
      <rect x="3"  y="3"  width="3"  height="3" fill="#00cc00"/>
      <rect x="18" y="3"  width="3"  height="3" fill="#00aa00"/>
      <rect x="3"  y="18" width="3"  height="3" fill="#007700"/>
      <rect x="18" y="18" width="3"  height="3" fill="#005500"/>
      {/* Outer ring */}
      <rect x="4"  y="4"  width="16" height="16" fill="#00cc00"/>
      {/* Inner ring */}
      <rect x="6"  y="6"  width="12" height="12" fill="#009900"/>
      {/* Center hole */}
      <rect x="8"  y="8"  width="8"  height="8"  fill="#001a00"/>
      {/* Center hole detail */}
      <rect x="10" y="10" width="4"  height="4"  fill="#003300"/>
      {/* Top face highlight */}
      <rect x="4"  y="4"  width="16" height="1"  fill="#00ff00"/>
      <rect x="4"  y="4"  width="1"  height="16" fill="#00ff00"/>
      {/* Right/bottom shadow */}
      <rect x="19" y="5"  width="1"  height="15" fill="#007700"/>
      <rect x="5"  y="19" width="14" height="1"  fill="#007700"/>
      {/* Tooth highlights */}
      <rect x="8"  y="1"  width="3"  height="1" fill="#00ff00"/>
      <rect x="13" y="1"  width="3"  height="1" fill="#00ff00"/>
      <rect x="1"  y="8"  width="1"  height="3" fill="#00ff00"/>
      <rect x="1"  y="13" width="1"  height="3" fill="#00ff00"/>
      <rect x="3"  y="3"  width="1"  height="3" fill="#00ff00"/>
      <rect x="3"  y="3"  width="3"  height="1" fill="#00ff00"/>
    </svg>
  )
}

// ─── Metric icons for stat cards ──────────────────────────────────────────────

export function IconEye({ size = 16 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Shadow */}
      <rect x="3"  y="10" width="18" height="2" fill="#003300"/>
      {/* Eye outline */}
      <rect x="3"  y="6"  width="18" height="6" fill="#00cc00"/>
      <rect x="1"  y="8"  width="22" height="2" fill="#00cc00"/>
      {/* Eye white/inner */}
      <rect x="4"  y="7"  width="16" height="4" fill="#00ff00"/>
      <rect x="2"  y="8"  width="20" height="2" fill="#00ff00"/>
      {/* Iris */}
      <rect x="8"  y="7"  width="8"  height="4" fill="#00cc00"/>
      <rect x="9"  y="6"  width="6"  height="6" fill="#00cc00"/>
      {/* Pupil */}
      <rect x="10" y="8"  width="4"  height="2" fill="#001100"/>
      <rect x="11" y="7"  width="2"  height="4" fill="#001100"/>
      {/* Highlight */}
      <rect x="10" y="8"  width="1"  height="1" fill="#00ff00"/>
      {/* Top highlight edge */}
      <rect x="3"  y="6"  width="18" height="1" fill="#00ff00"/>
      <rect x="1"  y="8"  width="2"  height="1" fill="#00ff00"/>
    </svg>
  )
}

export function IconClock({ size = 16 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* 3D base */}
      <rect x="3"  y="20" width="18" height="2" fill="#003300"/>
      {/* Clock body */}
      <rect x="5"  y="2"  width="14" height="2" fill="#00cc00"/>
      <rect x="3"  y="4"  width="18" height="14" fill="#00cc00"/>
      <rect x="5"  y="18" width="14" height="2" fill="#00cc00"/>
      {/* Face */}
      <rect x="6"  y="3"  width="12" height="1" fill="#00ff00"/>
      <rect x="4"  y="4"  width="16" height="14" fill="#00ff00"/>
      <rect x="6"  y="18" width="12" height="1" fill="#00ff00"/>
      {/* Center dark */}
      <rect x="5"  y="5"  width="14" height="12" fill="#001100"/>
      {/* Clock face rim */}
      <rect x="5"  y="5"  width="14" height="1"  fill="#00ff00"/>
      <rect x="5"  y="5"  width="1"  height="12" fill="#00ff00"/>
      {/* Hour marks */}
      <rect x="11" y="6"  width="2"  height="2" fill="#00cc00"/>
      <rect x="11" y="15" width="2"  height="2" fill="#00cc00"/>
      <rect x="6"  y="10" width="2"  height="2" fill="#00cc00"/>
      <rect x="16" y="10" width="2"  height="2" fill="#007700"/>
      {/* Clock hands */}
      <rect x="11" y="9"  width="2"  height="4" fill="#00ff00"/>
      <rect x="12" y="7"  width="4"  height="2" fill="#00ff00"/>
      {/* Center dot */}
      <rect x="11" y="11" width="2"  height="2" fill="#00ff00"/>
      {/* Right shadow */}
      <rect x="21" y="4"  width="2"  height="14" fill="#005500"/>
      {/* Top highlight */}
      <rect x="3"  y="4"  width="1"  height="14" fill="#00ff00"/>
    </svg>
  )
}

export function IconUsers({ size = 16 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Person 1 head */}
      <rect x="2"  y="2"  width="4"  height="4" fill="#00cc00"/>
      <rect x="2"  y="2"  width="4"  height="1"  fill="#00ff00"/>
      {/* Person 1 body */}
      <rect x="2"  y="6"  width="4"  height="5"  fill="#00cc00"/>
      <rect x="0"  y="7"  width="2"  height="3"  fill="#007700"/>
      <rect x="6"  y="7"  width="2"  height="3"  fill="#007700"/>
      <rect x="2"  y="11" width="2"  height="5"  fill="#007700"/>
      <rect x="4"  y="11" width="2"  height="5"  fill="#007700"/>
      {/* Person 2 head */}
      <rect x="14" y="2"  width="4"  height="4" fill="#00cc00"/>
      <rect x="14" y="2"  width="4"  height="1"  fill="#00ff00"/>
      {/* Person 2 body */}
      <rect x="14" y="6"  width="4"  height="5"  fill="#00cc00"/>
      <rect x="12" y="7"  width="2"  height="3"  fill="#007700"/>
      <rect x="18" y="7"  width="2"  height="3"  fill="#007700"/>
      <rect x="14" y="11" width="2"  height="5"  fill="#007700"/>
      <rect x="16" y="11" width="2"  height="5"  fill="#007700"/>
      {/* Plus sign */}
      <rect x="9"  y="6"  width="6"  height="2" fill="#00ff00"/>
      <rect x="11" y="4"  width="2"  height="6" fill="#00ff00"/>
    </svg>
  )
}

export function IconDollar({ size = 16 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Coin 3D depth */}
      <rect x="3"  y="15" width="18" height="3" fill="#003300"/>
      {/* Coin face */}
      <rect x="5"  y="3"  width="14" height="1" fill="#00cc00"/>
      <rect x="3"  y="4"  width="18" height="11" fill="#00cc00"/>
      <rect x="5"  y="15" width="14" height="1" fill="#00cc00"/>
      {/* Coin shine */}
      <rect x="6"  y="4"  width="12" height="1"  fill="#00ff00"/>
      <rect x="4"  y="5"  width="16" height="9"  fill="#00ff00"/>
      <rect x="6"  y="14" width="12" height="1"  fill="#00ff00"/>
      <rect x="3"  y="4"  width="1"  height="11" fill="#00ff00"/>
      <rect x="20" y="4"  width="1"  height="11" fill="#007700"/>
      {/* $ symbol */}
      <rect x="10" y="4"  width="4"  height="1" fill="#00cc00"/>
      <rect x="9"  y="5"  width="5"  height="1" fill="#003300"/>
      <rect x="8"  y="6"  width="3"  height="2" fill="#003300"/>
      <rect x="9"  y="8"  width="5"  height="1" fill="#003300"/>
      <rect x="12" y="9"  width="3"  height="2" fill="#003300"/>
      <rect x="9"  y="11" width="5"  height="1" fill="#003300"/>
      <rect x="10" y="12" width="4"  height="1" fill="#00cc00"/>
      <rect x="11" y="4"  width="2"  height="10" fill="#003300"/>
    </svg>
  )
}

export function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* 3D box background */}
      <rect x="2"  y="18" width="20" height="2" fill="#003300"/>
      <rect x="20" y="2"  width="2"  height="18" fill="#005500"/>
      {/* Box face */}
      <rect x="2"  y="2"  width="18" height="16" fill="#00cc00"/>
      {/* Top/left highlight */}
      <rect x="2"  y="2"  width="18" height="1"  fill="#00ff00"/>
      <rect x="2"  y="2"  width="1"  height="16" fill="#00ff00"/>
      {/* Screen dark */}
      <rect x="3"  y="3"  width="17" height="15" fill="#001100"/>
      {/* Play triangle — pixel art */}
      <rect x="6"  y="6"  width="2"  height="10" fill="#00ff00"/>
      <rect x="8"  y="7"  width="2"  height="8"  fill="#00ff00"/>
      <rect x="10" y="8"  width="2"  height="6"  fill="#00ff00"/>
      <rect x="12" y="9"  width="2"  height="4"  fill="#00ff00"/>
      <rect x="14" y="10" width="2"  height="2"  fill="#00ff00"/>
      {/* Shadow on triangle */}
      <rect x="8"  y="7"  width="1"  height="8" fill="#007700"/>
      <rect x="10" y="8"  width="1"  height="6" fill="#007700"/>
      <rect x="12" y="9"  width="1"  height="4" fill="#007700"/>
      <rect x="14" y="10" width="1"  height="2" fill="#007700"/>
    </svg>
  )
}

export function IconCursor({ size = 16 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Arrow cursor — isometric pixel art */}
      {/* Shadow */}
      <rect x="4"  y="3"  width="2"  height="1" fill="#003300"/>
      {/* Main arrow body */}
      <rect x="3"  y="2"  width="2"  height="14" fill="#00cc00"/>
      <rect x="3"  y="2"  width="2"  height="1"  fill="#00ff00"/>
      <rect x="5"  y="4"  width="2"  height="2"  fill="#00cc00"/>
      <rect x="7"  y="6"  width="2"  height="2"  fill="#00cc00"/>
      <rect x="9"  y="8"  width="2"  height="2"  fill="#00cc00"/>
      <rect x="7"  y="10" width="2"  height="4"  fill="#00cc00"/>
      {/* Left highlight edge */}
      <rect x="3"  y="2"  width="1"  height="14" fill="#00ff00"/>
      {/* Right shadow */}
      <rect x="4"  y="3"  width="1"  height="11" fill="#007700"/>
      <rect x="5"  y="5"  width="1"  height="3"  fill="#007700"/>
      <rect x="7"  y="7"  width="1"  height="3"  fill="#007700"/>
      <rect x="9"  y="9"  width="1"  height="3"  fill="#007700"/>
      <rect x="7"  y="11" width="1"  height="3"  fill="#007700"/>
      {/* Click rings */}
      <rect x="13" y="10" width="6"  height="2" fill="#00ff00"/>
      <rect x="12" y="12" width="8"  height="2" fill="#00ff00"/>
      <rect x="11" y="14" width="10" height="2" fill="#00ff00"/>
      {/* Ring shadow */}
      <rect x="14" y="11" width="5"  height="1" fill="#007700"/>
      <rect x="13" y="13" width="7"  height="1" fill="#007700"/>
      <rect x="12" y="15" width="9"  height="1" fill="#007700"/>
    </svg>
  )
}

// ─── Store / Shopping Cart ────────────────────────────────────────────────────
export function IconStore({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Cart body shadow */}
      <rect x="4"  y="18" width="16" height="2" fill="#003300"/>
      <rect x="18" y="6"  width="2"  height="12" fill="#005500"/>
      {/* Cart body */}
      <rect x="2"  y="4"  width="16" height="14" fill="#00cc00"/>
      <rect x="2"  y="4"  width="16" height="1"  fill="#00ff00"/>
      <rect x="2"  y="4"  width="1"  height="14" fill="#00ff00"/>
      {/* Cart screen / shelves */}
      <rect x="4"  y="6"  width="12" height="10" fill="#001100"/>
      {/* Shelf 1 */}
      <rect x="5"  y="7"  width="10" height="2"  fill="#00cc00"/>
      <rect x="5"  y="7"  width="10" height="1"  fill="#00ff00"/>
      {/* Shelf 2 */}
      <rect x="5"  y="11" width="10" height="2"  fill="#00cc00"/>
      <rect x="5"  y="11" width="10" height="1"  fill="#00ff00"/>
      {/* Price tags */}
      <rect x="6"  y="9"  width="3"  height="1"  fill="#007700"/>
      <rect x="11" y="9"  width="3"  height="1"  fill="#007700"/>
      <rect x="6"  y="13" width="3"  height="1"  fill="#007700"/>
      <rect x="11" y="13" width="3"  height="1"  fill="#007700"/>
      {/* Handle / top bar */}
      <rect x="8"  y="2"  width="6"  height="2"  fill="#00cc00"/>
      <rect x="8"  y="2"  width="6"  height="1"  fill="#00ff00"/>
      {/* Wheels */}
      <rect x="6"  y="18" width="3"  height="3"  fill="#00cc00"/>
      <rect x="6"  y="20" width="3"  height="1"  fill="#007700"/>
      <rect x="13" y="18" width="3"  height="3"  fill="#00cc00"/>
      <rect x="13" y="20" width="3"  height="1"  fill="#007700"/>
    </svg>
  )
}

// ─── AI / Chip ────────────────────────────────────────────────────────────────
export function IconAI({ size = 20 }: { size?: number }) {
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Chip body shadow */}
      <rect x="5" y="17" width="16" height="2" fill="#003300"/>
      <rect x="19" y="5" width="2"  height="12" fill="#005500"/>
      {/* Chip body */}
      <rect x="3" y="3" width="16" height="14" fill="#00cc00"/>
      <rect x="3" y="3" width="16" height="1"  fill="#00ff00"/>
      <rect x="3" y="3" width="1"  height="14" fill="#00ff00"/>
      {/* Inner circuit */}
      <rect x="6"  y="6"  width="10" height="8"  fill="#001100"/>
      <rect x="8"  y="8"  width="6"  height="1"  fill="#00ff00"/>
      <rect x="8"  y="10" width="4"  height="1"  fill="#00ff00"/>
      <rect x="8"  y="12" width="6"  height="1"  fill="#00ff00"/>
      {/* Pins left */}
      <rect x="1" y="6"  width="2" height="1" fill="#00cc00"/>
      <rect x="1" y="9"  width="2" height="1" fill="#00cc00"/>
      <rect x="1" y="12" width="2" height="1" fill="#00cc00"/>
      {/* Pins top */}
      <rect x="7"  y="1" width="1" height="2" fill="#00cc00"/>
      <rect x="11" y="1" width="1" height="2" fill="#00cc00"/>
      <rect x="15" y="1" width="1" height="2" fill="#00cc00"/>
    </svg>
  )
}

export function IconPlan({ size = 20 }: { size?: number }) {
  const crisp = { style: { imageRendering: 'pixelated' as const }, viewBox: '0 0 20 20', fill: 'none' }
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Calendar body */}
      <rect x="2" y="4" width="16" height="14" fill="currentColor" opacity="0.25"/>
      <rect x="2" y="4" width="16" height="1" fill="currentColor" opacity="0.6"/>
      <rect x="2" y="4" width="1" height="14" fill="currentColor" opacity="0.6"/>
      <rect x="17" y="5" width="1" height="13" fill="currentColor" opacity="0.2"/>
      <rect x="3" y="17" width="14" height="1" fill="currentColor" opacity="0.2"/>
      {/* Header bar */}
      <rect x="2" y="4" width="16" height="4" fill="currentColor" opacity="0.5"/>
      {/* Binding pegs */}
      <rect x="6"  y="2" width="2" height="4" fill="currentColor" opacity="0.8"/>
      <rect x="12" y="2" width="2" height="4" fill="currentColor" opacity="0.8"/>
      {/* Checklist lines */}
      <rect x="5" y="10" width="2" height="1" fill="currentColor" opacity="0.9"/>
      <rect x="8" y="10" width="7" height="1" fill="currentColor" opacity="0.5"/>
      <rect x="5" y="12" width="2" height="1" fill="currentColor" opacity="0.9"/>
      <rect x="8" y="12" width="5" height="1" fill="currentColor" opacity="0.5"/>
      <rect x="5" y="14" width="2" height="1" fill="currentColor" opacity="0.4"/>
      <rect x="8" y="14" width="7" height="1" fill="currentColor" opacity="0.3"/>
      {/* Check mark on first item */}
      <rect x="5" y="10" width="1" height="1" fill="currentColor"/>
      <rect x="6" y="11" width="1" height="1" fill="currentColor"/>
    </svg>
  )
}

export function IconMarket({ size = 20 }: { size?: number }) {
  const crisp = { style: { imageRendering: 'pixelated' as const }, viewBox: '0 0 20 20', fill: 'none' }
  return (
    <svg {...crisp} width={size} height={size}>
      {/* Base line */}
      <rect x="1" y="17" width="18" height="1" fill="currentColor" opacity="0.5"/>
      {/* Bar 1 */}
      <rect x="2"  y="12" width="3" height="5" fill="currentColor" opacity="0.6"/>
      {/* Bar 2 */}
      <rect x="7"  y="9"  width="3" height="8" fill="currentColor" opacity="0.8"/>
      {/* Bar 3 */}
      <rect x="12" y="5"  width="3" height="12" fill="currentColor"/>
      {/* Trend arrow */}
      <rect x="3"  y="11" width="2" height="1" fill="currentColor"/>
      <rect x="5"  y="9"  width="2" height="1" fill="currentColor"/>
      <rect x="7"  y="7"  width="2" height="1" fill="currentColor"/>
      <rect x="9"  y="5"  width="2" height="1" fill="currentColor"/>
      <rect x="11" y="3"  width="2" height="1" fill="currentColor"/>
      {/* Arrow head */}
      <rect x="13" y="2" width="4" height="1" fill="currentColor"/>
      <rect x="16" y="3" width="1" height="3" fill="currentColor"/>
    </svg>
  )
}

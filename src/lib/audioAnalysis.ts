import { analyze as beatDetectorAnalyze } from 'web-audio-beat-detector'

// Krumhansl-Kessler (1982) tonal hierarchy profiles — the foundation of TuneBat,
// Mixed In Key, KeyFinder and virtually every professional key detection tool.
// Derived from listener probe-tone experiments; validated across pop/electronic music.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const FFT_SIZE = 4096
const HOP      = 2048

// ─── Pearson correlation ──────────────────────────────────────────────────────
function pearson(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const ca = a[i] - ma, cb = b[i] - mb
    num += ca * cb; da += ca * ca; db += cb * cb
  }
  return num / (Math.sqrt(da * db) || 1)
}

// ─── In-place radix-2 Cooley-Tukey FFT ───────────────────────────────────────
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang), wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0
      const half = len >> 1
      for (let j = 0; j < half; j++) {
        const k = i + j + half
        const vRe = uRe * re[k] - uIm * im[k]
        const vIm = uRe * im[k] + uIm * re[k]
        re[k] = re[i + j] - vRe;  im[k] = im[i + j] - vIm
        re[i + j] += vRe;         im[i + j] += vIm
        const nr = uRe * wRe - uIm * wIm
        uIm = uRe * wIm + uIm * wRe; uRe = nr
      }
    }
  }
}

// ─── Chromagram (STFT) over a mono segment ───────────────────────────────────
function computeChromagram(seg: Float32Array, sampleRate: number): number[] {
  const chroma = new Array(12).fill(0)
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)
  let frames = 0

  for (let offset = 0; offset + FFT_SIZE <= seg.length; offset += HOP, frames++) {
    for (let i = 0; i < FFT_SIZE; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
      re[i] = seg[offset + i] * w
      im[i] = 0
    }
    fft(re, im)

    // 80 Hz – 2100 Hz: starts above most sub-bass rumble to reduce 808 dominance.
    // Balanced weighting: melody (700Hz+) carries more key information than bass alone.
    for (let bin = 1; bin < FFT_SIZE >> 1; bin++) {
      const freq = (bin * sampleRate) / FFT_SIZE
      if (freq < 80 || freq > 2100) continue
      const midi = 12 * Math.log2(freq / 440) + 69
      const pc   = ((Math.round(midi) % 12) + 12) % 12
      const w    = freq < 300 ? 1.5 : freq < 700 ? 2 : 2.5
      chroma[pc] += (re[bin] * re[bin] + im[bin] * im[bin]) * w
    }
  }

  if (!frames) return chroma
  const max = Math.max(...chroma)
  return max > 0 ? chroma.map(v => v / max) : chroma
}

// ─── KK key detection — returns { root 0-11, mode 'M'|'m', corr } ────────────
function detectKeyFromChroma(chroma: number[]): { root: number; mode: 'M' | 'm'; corr: number } {
  let bestRoot = 9, bestMode: 'M' | 'm' = 'm', bestCorr = -Infinity
  for (let root = 0; root < 12; root++) {
    const maj = KK_MAJOR.map((_, i) => KK_MAJOR[(i - root + 12) % 12])
    const min = KK_MINOR.map((_, i) => KK_MINOR[(i - root + 12) % 12])
    const cMaj = pearson(chroma, maj)
    const cMin = pearson(chroma, min)
    if (cMaj > bestCorr) { bestCorr = cMaj; bestRoot = root; bestMode = 'M' }
    if (cMin > bestCorr) { bestCorr = cMin; bestRoot = root; bestMode = 'm' }
  }
  return { root: bestRoot, mode: bestMode, corr: bestCorr }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function analyzeAudio(
  file: File
): Promise<{ bpm: number | null; key: string | null }> {
  let audioCtx: AudioContext | null = null
  try {
    const arrayBuffer = await file.arrayBuffer()
    audioCtx = new AudioContext()
    const buffer = await audioCtx.decodeAudioData(arrayBuffer)

    // Mix down to mono
    const mono = new Float32Array(buffer.length)
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c)
      for (let i = 0; i < buffer.length; i++) mono[i] += ch[i]
    }
    if (buffer.numberOfChannels > 1) {
      for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels
    }

    // Multi-segment key detection with weighted voting (mimics TuneBat's multi-pass approach).
    // Skip first 10 s (intro), analyse 3 × 30 s segments covering the main body.
    // Each segment casts a vote weighted by its correlation confidence.
    const sr      = buffer.sampleRate
    const SKIP    = 10 * sr
    const SEG_LEN = 30 * sr

    const candidateStarts = [SKIP, SKIP + SEG_LEN, SKIP + 2 * SEG_LEN]
      .filter(s => s + FFT_SIZE <= mono.length)
    if (candidateStarts.length === 0) candidateStarts.push(0)

    // Accumulate confidence-weighted votes per key
    const scores = new Map<string, number>()
    for (const start of candidateStarts) {
      const seg = mono.subarray(start, Math.min(start + SEG_LEN, mono.length))
      const { root, mode, corr } = detectKeyFromChroma(computeChromagram(seg, sr))
      const k = `${root}|${mode}`
      scores.set(k, (scores.get(k) || 0) + Math.max(corr, 0))
    }

    let bestK = '9|m'
    let bestScore = -Infinity
    for (const [k, s] of scores) { if (s > bestScore) { bestScore = s; bestK = k } }

    const [rootStr, mode] = bestK.split('|') as [string, 'M' | 'm']
    const root = parseInt(rootStr)
    const keyStr = mode === 'M'
      ? `${NOTE_NAMES[root]} Major`
      : `${NOTE_NAMES[root]} Minor`

    const [bpmResult] = await Promise.allSettled([beatDetectorAnalyze(buffer)])
    const bpm = bpmResult.status === 'fulfilled' && typeof bpmResult.value === 'number'
      ? Math.round(bpmResult.value)
      : null

    return { bpm, key: keyStr }
  } catch {
    return { bpm: null, key: null }
  } finally {
    audioCtx?.close()
  }
}

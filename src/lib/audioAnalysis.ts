import { analyze as beatDetectorAnalyze } from 'web-audio-beat-detector'

// ─── Bellman-Budge key profiles (rooted at C) — higher contrast than KS ──────
// Ratio tonic:weakest ≈ 33:1 vs 2.85:1 in KS → far less major/minor confusion
const KS_MAJOR = [16.80, 0.86, 12.95, 1.41, 13.49, 11.93, 1.25, 20.28, 1.80, 8.04, 0.62, 10.57]
const KS_MINOR = [18.16, 0.69, 12.99, 13.34, 1.07, 11.15, 1.38, 21.07, 7.49, 1.53, 0.92, 10.21]
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

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

// ─── Chromagram using STFT ────────────────────────────────────────────────────
function computeChromagram(mono: Float32Array, sampleRate: number): number[] {
  const FFT_SIZE = 4096
  const HOP      = 2048
  const chroma   = new Array(12).fill(0)
  // Analyse at most the first 90 s — more data → better statistics
  const limit = Math.min(mono.length, 90 * sampleRate)
  let frames = 0

  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)

  for (let offset = 0; offset + FFT_SIZE <= limit; offset += HOP, frames++) {
    // Hann window + copy
    for (let i = 0; i < FFT_SIZE; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
      re[i] = mono[offset + i] * w
      im[i] = 0
    }
    fft(re, im)

    // Accumulate energy per pitch class with bass-emphasis weighting.
    // Range 65 Hz (C2) – 2100 Hz (C7): captures bass/808 and melody,
    // excludes sub-bass rumble (<65 Hz) and hi-hat/cymbal noise (>2100 Hz).
    for (let bin = 1; bin < FFT_SIZE >> 1; bin++) {
      const freq = (bin * sampleRate) / FFT_SIZE
      if (freq < 65 || freq > 2100) continue
      const midi = 12 * Math.log2(freq / 440) + 69
      const pc   = ((Math.round(midi) % 12) + 12) % 12
      // Weight bass 4×, low-mid 2× — 808/bass establishes the key
      const w = freq < 300 ? 4 : freq < 700 ? 2 : 1
      chroma[pc] += (re[bin] * re[bin] + im[bin] * im[bin]) * w
    }
  }

  if (!frames) return chroma
  const max = Math.max(...chroma)
  return max > 0 ? chroma.map(v => v / max) : chroma
}

// ─── Krumhansl-Schmuckler key detection ──────────────────────────────────────
function detectKeyFromChroma(chroma: number[]): string {
  let bestKey = 'Am', bestCorr = -Infinity
  for (let root = 0; root < 12; root++) {
    const maj = KS_MAJOR.map((_, i) => KS_MAJOR[(i - root + 12) % 12])
    const min = KS_MINOR.map((_, i) => KS_MINOR[(i - root + 12) % 12])
    const cMaj = pearson(chroma, maj)
    const cMin = pearson(chroma, min)
    if (cMaj > bestCorr) { bestCorr = cMaj; bestKey = NOTE_NAMES[root] + 'M' }
    if (cMin > bestCorr) { bestCorr = cMin; bestKey = NOTE_NAMES[root] + 'm' }
  }
  return bestKey
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

    // Run BPM and key detection in parallel
    const [bpmResult, keyResult] = await Promise.allSettled([
      beatDetectorAnalyze(buffer),
      Promise.resolve(detectKeyFromChroma(computeChromagram(mono, buffer.sampleRate))),
    ])

    const bpm = bpmResult.status === 'fulfilled' && typeof bpmResult.value === 'number'
      ? Math.round(bpmResult.value)
      : null
    const key = keyResult.status === 'fulfilled' && keyResult.value
      ? keyResult.value
      : null

    return { bpm, key }
  } catch {
    return { bpm: null, key: null }
  } finally {
    audioCtx?.close()
  }
}

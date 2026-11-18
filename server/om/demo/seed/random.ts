/** A seeded random generator, so the demo catalog is the same on every start. */
export function rng(seed: number) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    normal: (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next()),
  }
}

export const DAY = 86_400_000

/** Midnight UTC today, so time series line up with "today". */
export function today(): number {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

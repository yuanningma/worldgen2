/** Small deterministic generator used by tectonic recipes and tests. */
export interface RandomSource {
  next(): number;
  range(minimum: number, maximum: number): number;
  integer(minimum: number, maximumExclusive: number): number;
}

function hashSeed(seed: string | number): number {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRandom(seed: string | number): RandomSource {
  let state = hashSeed(seed) || 0x9e3779b9;
  const next = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (minimum, maximum) => minimum + (maximum - minimum) * next(),
    integer: (minimum, maximumExclusive) => Math.floor(minimum + (maximumExclusive - minimum) * next()),
  };
}

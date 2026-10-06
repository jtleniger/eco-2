/**
 * Seeded pronounceable word generator for daughter species names. Pure, DOM-free and
 * dependency-free: every draw comes from the caller's `rng`, so a seeded run names its
 * species reproducibly. Uniqueness is the caller's problem.
 */
const ONSETS = [
  'b', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z',
  'br', 'dr', 'fr', 'gr', 'kl', 'pr', 'sl', 'st', 'tr',
];
const NUCLEI = [
  'a', 'e', 'i', 'o', 'u', 'ae', 'ai', 'ea', 'ee', 'oa', 'oo', 'ou', 'ia', 'io',
];
const CODAS = [
  'n', 'm', 'r', 'l', 's', 'th', 'sh', 'll', 'ck', 'st', 'nd', 'rk', 'sk', 'ft', 'mp',
];

/** Pick one element of `arr` using `rng()`. */
function pick(arr: readonly string[], rng: () => number): string {
  return arr[(rng() * arr.length) | 0];
}

/**
 * A lowercase pronounceable word of 2–3 syllables (`onset + nucleus`, with a coda on a
 * syllable 45% of the time), e.g. `veluna`, `minecho`, `vexar`. Deterministic in `rng`.
 */
export function generateName(rng: () => number): string {
  const nSyl = rng() < 0.5 ? 2 : 3;
  let out = '';
  for (let s = 0; s < nSyl; s++) {
    out += pick(ONSETS, rng) + pick(NUCLEI, rng);
    if (rng() < 0.45) out += pick(CODAS, rng);
  }
  return out;
}

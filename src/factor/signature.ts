/**
 * Prime signatures (GDD 5).
 *
 * Every raw material is a prime, and an item's signature is the product of what it
 * is made from. A product is only ever a multiplication, so its factorisation is
 * simply the list of exponents, and by the uniqueness of prime factorisation those
 * exponents are exactly how much of each raw material it costs.
 *
 * Signatures are held as exponent vectors, never as the integer they stand for. The
 * gate component would be a number of roughly 10^100, but as `[40, 72, 40, 16, 64,
 * 4]` it is six small integers: multiplying two signatures is adding vectors, and
 * raising to a power is scaling one. No big integers are needed anywhere.
 *
 * Pure: no renderer, no DOM.
 */

/** The primes assigned to raw materials, in order. Scarcer materials get larger primes. */
export const PRIMES = [2, 3, 5, 7, 11, 13] as const;

export const PRIME_COUNT = PRIMES.length;

/** Exponent of each prime, indexed as `PRIMES`. */
export type Signature = Readonly<Int32Array>;

/** The signature of 1: no prime factors. */
export function unit(): Int32Array {
  return new Int32Array(PRIME_COUNT);
}

/** The signature of a single prime, given its index into `PRIMES`. */
export function primeSignature(index: number): Int32Array {
  if (!Number.isInteger(index) || index < 0 || index >= PRIME_COUNT) {
    throw new RangeError(`prime index ${index} is outside 0..${PRIME_COUNT - 1}`);
  }
  const sig = unit();
  sig[index] = 1;
  return sig;
}

/** Product of two signatures. */
export function multiply(a: Signature, b: Signature): Int32Array {
  const out = new Int32Array(PRIME_COUNT);
  for (let i = 0; i < PRIME_COUNT; i++) out[i] = a[i]! + b[i]!;
  return out;
}

/** A signature raised to a whole-number power: `count` copies multiplied together. */
export function power(a: Signature, count: number): Int32Array {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`cannot raise a signature to the power ${count}`);
  }
  const out = new Int32Array(PRIME_COUNT);
  for (let i = 0; i < PRIME_COUNT; i++) out[i] = a[i]! * count;
  return out;
}

export function equals(a: Signature, b: Signature): boolean {
  for (let i = 0; i < PRIME_COUNT; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Sum of the exponents: how many raw materials the item costs in total. */
export function totalExponent(a: Signature): number {
  let total = 0;
  for (let i = 0; i < PRIME_COUNT; i++) total += a[i]!;
  return total;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** An integer written in superscript digits, e.g. 40 -> ⁴⁰. */
export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((digit) => SUPERSCRIPT[digit] ?? digit)
    .join('');
}

/**
 * The factorisation as text, e.g. `2⁴ · 3 · 5²`.
 *
 * An exponent of 1 is left off, as in ordinary notation. The empty signature, which
 * is the number 1, is written "1".
 */
export function formatSignature(a: Signature): string {
  const parts: string[] = [];
  for (let i = 0; i < PRIME_COUNT; i++) {
    const exponent = a[i]!;
    if (exponent === 0) continue;
    parts.push(exponent === 1 ? `${PRIMES[i]}` : `${PRIMES[i]}${superscript(exponent)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '1';
}

/** The non-zero factors, as `[prime, exponent]`, for drawing each one separately. */
export function factors(a: Signature): { prime: number; index: number; exponent: number }[] {
  const out: { prime: number; index: number; exponent: number }[] = [];
  for (let i = 0; i < PRIME_COUNT; i++) {
    if (a[i]! > 0) out.push({ prime: PRIMES[i]!, index: i, exponent: a[i]! });
  }
  return out;
}

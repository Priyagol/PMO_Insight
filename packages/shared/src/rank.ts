/**
 * Fractional indexing for manual ordering (Kanban columns, lists).
 * Ranks are base-62 strings compared lexicographically (byte order, as MongoDB sorts
 * strings), so a new item can always be placed between two neighbours without
 * renumbering the rest. Adapted from the public-domain "fractional-indexing" approach.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`rank: ${a} >= ${b}`);
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) throw new Error('rank: trailing zero');
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/** Smallest-change rank greater than `a` (appending to the end of a list). Grows ~1 char per 61 appends. */
function after(a: string): string {
  for (let i = 0; i < a.length; i += 1) {
    const d = DIGITS.indexOf(a[i]!);
    if (d < DIGITS.length - 1) return a.slice(0, i) + DIGITS[d + 1]!;
  }
  return `${a}1`; // every digit is 'z': extend
}

/** Rank smaller than `b` (prepending to the start of a list). */
function before(b: string): string {
  for (let i = 0; i < b.length; i += 1) {
    const d = DIGITS.indexOf(b[i]!);
    if (d > 1) return b.slice(0, i) + DIGITS[d - 1]!;
  }
  return midpoint('', b);
}

/** Returns a rank strictly between `lower` and `upper` (either may be null for an open end). */
export function rankBetween(
  lower: string | null | undefined,
  upper: string | null | undefined,
): string {
  if (!lower && !upper) return 'V';
  if (lower && !upper) return after(lower);
  if (!lower && upper) return before(upper);
  return midpoint(lower!, upper!);
}

/** Ranks only grow when many items are inserted at exactly the same spot; 255 is a generous cap. */
export function isValidRank(rank: string): boolean {
  return (
    rank.length > 0 &&
    rank.length <= 255 &&
    !rank.endsWith(ZERO) &&
    [...rank].every((c) => DIGITS.includes(c))
  );
}

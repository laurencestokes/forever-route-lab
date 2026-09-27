/**
 * Maximum-weight strictly increasing subsequence (docs/research/optimizer-m7.md §10, review OP-18).
 *
 * Dynamic programming over positions: `best[i] = w[i] + max{ best[j] : j < i, v[j] < v[i] }`
 * (0 when there is no such j). A max segment tree indexed by the rank of the value answers each
 * prefix maximum in O(log n), so the whole run is O(n log n). The tree's parent of node k is
 * `Math.floor(k / 2)`: no bitwise operators (D-012) and no Fenwick `k & −k`.
 *
 * A subsequence of maximum weight is not unique, so the tie rule is part of the contract:
 * - among predecessors with equal `best`, the one with the smaller value is taken (then the
 *   earlier position, for equal values);
 * - among ends with the maximum `best`, the one with the smaller value is taken (then the earlier
 *   position).
 * Equivalently, of all maximum-weight subsequences, the one whose (value, position) pairs read
 * from the end are lexicographically smallest. Ties are exact for integer weights whose sums stay
 * below 2^53; the diff's weights are 1 and n + 1.
 */

/** A rank per position, and the number of ranks. Integer values in a small range are their own rank. */
function ranksOf(values: ArrayLike<number>): { readonly rank: Int32Array; readonly size: number } {
  const n = values.length;
  const rank = new Int32Array(n);
  const bound = 4 * n + 16;
  let direct = true;
  let max = -1;
  for (let i = 0; i < n; i += 1) {
    const v = values[i] ?? Number.NaN;
    if (!Number.isFinite(v)) throw new RangeError(`values[${String(i)}] is not a finite number`);
    if (direct && Number.isInteger(v) && v >= 0 && v < bound) {
      rank[i] = v;
      if (v > max) max = v;
    } else {
      direct = false;
    }
  }
  if (direct) return { rank, size: max + 1 };
  // Dense ranks by value; equal values share a rank.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0) || a - b);
  let size = 0;
  let previous = Number.NaN;
  for (const i of order) {
    const v = values[i] ?? 0;
    if (size === 0 || v !== previous) size += 1;
    rank[i] = size - 1;
    previous = v;
  }
  return { rank, size };
}

/**
 * The positions (ascending) of the maximum-weight strictly increasing subsequence of `values`,
 * under the tie rule above. `weights` default to 1 (a longest increasing subsequence); each must be
 * a positive finite number.
 */
export function longestIncreasingSubsequence(values: ArrayLike<number>, weights?: ArrayLike<number>): Int32Array {
  const n = values.length;
  if (weights !== undefined && weights.length !== n) {
    throw new RangeError(`weights has ${String(weights.length)} entries for ${String(n)} values`);
  }
  if (n === 0) return new Int32Array(0);
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const w = weights === undefined ? 1 : (weights[i] ?? Number.NaN);
    if (!(w > 0) || !Number.isFinite(w)) throw new RangeError(`weights[${String(i)}] is not a positive finite number`);
    weight[i] = w;
  }
  const { rank, size } = ranksOf(values);
  // Already strictly increasing (an unchanged route): with positive weights the whole sequence is
  // the only maximum.
  let increasing = true;
  for (let i = 1; i < n && increasing; i += 1) increasing = (rank[i - 1] ?? 0) < (rank[i] ?? 0);
  if (increasing) return Int32Array.from({ length: n }, (_, i) => i);
  let leaves = 1;
  while (leaves < size) leaves *= 2;
  // Node k covers a rank range; the root is 1 and leaf r is `leaves + r`. -1: empty.
  const treeBest = new Float64Array(2 * leaves).fill(-1);
  const treePos = new Int32Array(2 * leaves).fill(-1);
  const best = new Float64Array(n);
  const previous = new Int32Array(n);

  // The running prefix maximum: its best and position (-1: none yet).
  let bestPrev = -1;
  let posPrev = -1;
  const consider = (node: number): void => {
    const p = treePos[node] ?? -1;
    if (p < 0) return;
    const b = treeBest[node] ?? -1;
    if (b > bestPrev || (b === bestPrev && (rank[p] ?? 0) < (rank[posPrev] ?? 0))) {
      bestPrev = b;
      posPrev = p;
    }
  };

  for (let i = 0; i < n; i += 1) {
    const w = weight[i] ?? 1;
    const r = rank[i] ?? 0;
    // Prefix maximum over ranks [0, r).
    bestPrev = -1;
    posPrev = -1;
    let lo = leaves;
    let hi = leaves + r;
    while (lo < hi) {
      if (lo % 2 === 1) {
        consider(lo);
        lo += 1;
      }
      if (hi % 2 === 1) {
        hi -= 1;
        consider(hi);
      }
      lo = Math.floor(lo / 2);
      hi = Math.floor(hi / 2);
    }
    const value = w + (posPrev < 0 ? 0 : bestPrev);
    best[i] = value;
    previous[i] = posPrev;
    // Update leaf r; an equal best keeps the earlier position.
    let node = leaves + r;
    if (value <= (treeBest[node] ?? -1)) continue;
    treeBest[node] = value;
    treePos[node] = i;
    node = Math.floor(node / 2);
    while (node >= 1) {
      const left = 2 * node;
      const right = left + 1;
      // The left child holds the smaller ranks, so it wins ties.
      const takeRight = (treeBest[right] ?? -1) > (treeBest[left] ?? -1);
      const from = takeRight ? right : left;
      treeBest[node] = treeBest[from] ?? -1;
      treePos[node] = treePos[from] ?? -1;
      node = Math.floor(node / 2);
    }
  }

  let end = 0;
  for (let i = 1; i < n; i += 1) {
    const b = best[i] ?? 0;
    const e = best[end] ?? 0;
    if (b > e || (b === e && (rank[i] ?? 0) < (rank[end] ?? 0))) end = i;
  }
  let length = 0;
  for (let p = end; p >= 0; p = previous[p] ?? -1) length += 1;
  const out = new Int32Array(length);
  let k = length - 1;
  for (let p = end; p >= 0; p = previous[p] ?? -1) {
    out[k] = p;
    k -= 1;
  }
  return out;
}

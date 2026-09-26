/**
 * The Dijkstra priority queue of `legs.ts` (terrain-navigation.md §9.1): a binary min-heap of
 * (cost, polygon id) pairs ordered by cost, then id, so the expansion order is a total order that
 * depends on nothing but the costs. The parent index is `Math.floor((i − 1) / 2)` (RC-13, G14: no
 * bitwise operators in `src/nav`). Duplicate entries are allowed; the search skips stale ones.
 */
export class CostHeap {
  private cost = new Float64Array(1024);
  private id = new Int32Array(1024);
  private count = 0;

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  /** Cost of the smallest entry (the heap must not be empty). */
  topCost(): number {
    return this.cost[0] ?? 0;
  }

  /** Id of the smallest entry (the heap must not be empty). */
  topId(): number {
    return this.id[0] ?? 0;
  }

  private less(i: number, j: number): boolean {
    const a = this.cost[i] ?? 0;
    const b = this.cost[j] ?? 0;
    return a < b || (a === b && (this.id[i] ?? 0) < (this.id[j] ?? 0));
  }

  private swap(i: number, j: number): void {
    const c = this.cost[i] ?? 0;
    this.cost[i] = this.cost[j] ?? 0;
    this.cost[j] = c;
    const d = this.id[i] ?? 0;
    this.id[i] = this.id[j] ?? 0;
    this.id[j] = d;
  }

  push(cost: number, id: number): void {
    if (this.count === this.cost.length) {
      const c = new Float64Array(this.count * 2);
      c.set(this.cost);
      this.cost = c;
      const d = new Int32Array(this.count * 2);
      d.set(this.id);
      this.id = d;
    }
    let i = this.count;
    this.count += 1;
    this.cost[i] = cost;
    this.id[i] = id;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Removes the smallest entry and returns its id. */
  pop(): number {
    const top = this.id[0] ?? 0;
    this.count -= 1;
    if (this.count > 0) {
      this.cost[0] = this.cost[this.count] ?? 0;
      this.id[0] = this.id[this.count] ?? 0;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.count && this.less(l, m)) m = l;
        if (r < this.count && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

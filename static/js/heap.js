/* Binary Min-Heap / Priority Queue.
 * push / pop are O(log N), peek is O(1).
 * Used by (1) the A* open set and (2) the turn-order scheduler. */
(function (g) {
  const DG = (g.DG = g.DG || {});

  class MinHeap {
    constructor(compare) {
      this.a = [];
      this.cmp = compare || ((x, y) => x - y);
    }

    get size() {
      return this.a.length;
    }

    peek() {
      return this.a[0];
    }

    push(item) {
      const a = this.a;
      a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.cmp(a[i], a[parent]) >= 0) break;
        [a[i], a[parent]] = [a[parent], a[i]];
        i = parent;
      }
    }

    pop() {
      const a = this.a;
      if (a.length === 0) return undefined;
      const top = a[0];
      const last = a.pop();
      if (a.length > 0) {
        a[0] = last;
        let i = 0;
        const n = a.length;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < n && this.cmp(a[l], a[m]) < 0) m = l;
          if (r < n && this.cmp(a[r], a[m]) < 0) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]];
          i = m;
        }
      }
      return top;
    }
  }

  DG.MinHeap = MinHeap;
})(globalThis);

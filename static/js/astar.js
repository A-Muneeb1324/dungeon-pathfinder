/* A* search on the 4-connected tile grid.
 *
 *   f(n) = g(n) + h(n)
 *   g(n) = steps walked from the start
 *   h(n) = Manhattan distance to the goal (admissible on a 4-connected grid,
 *          so the returned path is always a shortest one)
 *
 * The open set is a MinHeap ordered by f (ties broken toward larger g, which
 * keeps the search heading straight at the goal). Stale duplicate heap
 * entries are skipped with a closed-set check ("lazy deletion").
 * g-scores, parents and the closed set are hash maps/sets: O(1) lookups. */
(function (g) {
  const DG = (g.DG = g.DG || {});
  const { MinHeap, key, COLS, DIRS } = DG;

  function astar(start, goal, walkable, maxExpand = 3000) {
    const sk = key(start.x, start.y);
    const gk = key(goal.x, goal.y);
    if (sk === gk) return { found: true, path: [], expanded: 0 };

    const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
    const open = new MinHeap((a, b) => a.f - b.f || b.g - a.g);
    const gScore = new Map([[sk, 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    open.push({ x: start.x, y: start.y, g: 0, f: h(start.x, start.y) });
    let expanded = 0;

    while (open.size > 0) {
      const cur = open.pop();
      const ck = key(cur.x, cur.y);
      if (closed.has(ck)) continue;

      if (ck === gk) {
        const path = [];
        let k = gk;
        while (k !== sk) {
          path.push({ x: k % COLS, y: Math.floor(k / COLS) });
          k = cameFrom.get(k);
        }
        path.reverse();
        return { found: true, path, expanded };
      }

      closed.add(ck);
      if (++expanded > maxExpand) break;

      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nk = key(nx, ny);
        if (closed.has(nk) || !walkable(nx, ny)) continue;
        const ng = cur.g + 1;
        const best = gScore.get(nk);
        if (best === undefined || ng < best) {
          gScore.set(nk, ng);
          cameFrom.set(nk, ck);
          open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny) });
        }
      }
    }
    return { found: false, path: [], expanded };
  }

  DG.astar = astar;
})(globalThis);

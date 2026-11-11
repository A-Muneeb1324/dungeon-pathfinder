/* Procedural dungeon generation.
 *
 *  1. Scatter non-overlapping rooms.
 *  2. Build the complete graph of rooms (edge weight = Manhattan distance).
 *  3. Kruskal's algorithm + Disjoint Set Union picks the Minimum Spanning
 *     Tree: every room is connected, with no redundant corridors.  O(E log E)
 *  4. Carve an L-shaped corridor for every MST edge.
 *  5. Breadth-First Search from the spawn point verifies that every room is
 *     reachable.  If not, the layout is discarded and regenerated.
 *
 * Walkable tiles live in a Map (hash map) keyed by y * COLS + x, so every
 * "is this tile floor?" lookup is O(1) on average. */
(function (g) {
  const DG = (g.DG = g.DG || {});
  const COLS = 40;
  const ROWS = 30;
  const key = (x, y) => y * COLS + x;
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  /* Small seedable PRNG so layouts can be reproduced in tests. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Disjoint Set Union with path compression + union by rank.
   * Near-constant amortised time per operation (inverse Ackermann). */
  class DSU {
    constructor(n) {
      this.parent = Array.from({ length: n }, (_, i) => i);
      this.rank = new Array(n).fill(0);
      this.sets = n;
    }
    find(x) {
      while (this.parent[x] !== x) {
        this.parent[x] = this.parent[this.parent[x]];
        x = this.parent[x];
      }
      return x;
    }
    union(a, b) {
      let ra = this.find(a);
      let rb = this.find(b);
      if (ra === rb) return false;
      if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
      this.parent[rb] = ra;
      if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
      this.sets--;
      return true;
    }
  }

  function placeRooms(rng, target) {
    const rooms = [];
    for (let tries = 0; tries < 250 && rooms.length < target; tries++) {
      const w = 4 + Math.floor(rng() * 6);
      const h = 3 + Math.floor(rng() * 4);
      const x = 1 + Math.floor(rng() * (COLS - w - 2));
      const y = 1 + Math.floor(rng() * (ROWS - h - 2));
      // keep a 1-tile wall gap between rooms
      const overlaps = rooms.some(
        (r) => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y
      );
      if (overlaps) continue;
      rooms.push({ id: rooms.length, x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
    return rooms;
  }

  function carveRoom(tiles, r) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles.set(key(x, y), 1);
  }

  function carveCorridor(tiles, a, b, rng) {
    const h = (y, x1, x2) => {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) tiles.set(key(x, y), 1);
    };
    const v = (x, y1, y2) => {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) tiles.set(key(x, y), 1);
    };
    if (rng() < 0.5) {
      h(a.cy, a.cx, b.cx);
      v(b.cx, a.cy, b.cy);
    } else {
      v(a.cx, a.cy, b.cy);
      h(b.cy, a.cx, b.cx);
    }
  }

  /* Kruskal's MST over the complete room graph. */
  function kruskal(rooms) {
    const edges = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const w = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
        edges.push({ a: i, b: j, w });
      }
    }
    edges.sort((p, q) => p.w - q.w);
    const dsu = new DSU(rooms.length);
    const mst = [];
    for (const e of edges) {
      if (dsu.union(e.a, e.b)) {
        mst.push(e);
        if (mst.length === rooms.length - 1) break;
      }
    }
    return mst;
  }

  /* BFS over the tile hash map. Returns Map(tileKey -> steps from start). */
  function bfs(tiles, sx, sy) {
    const dist = new Map([[key(sx, sy), 0]]);
    const queue = [sx, sy];
    for (let head = 0; head < queue.length; head += 2) {
      const x = queue[head];
      const y = queue[head + 1];
      const d = dist.get(key(x, y));
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const k = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        if (!tiles.has(k) || dist.has(k)) continue;
        dist.set(k, d + 1);
        queue.push(nx, ny);
      }
    }
    return dist;
  }

  function buildOnce(seed, floor) {
    const rng = mulberry32(seed);
    const rooms = placeRooms(rng, 6 + Math.min(floor, 4));
    const tiles = new Map();
    if (rooms.length < 4) return { rooms, tiles, mst: [], verified: false };

    rooms.forEach((r) => carveRoom(tiles, r));
    const mst = kruskal(rooms);
    mst.forEach((e) => carveCorridor(tiles, rooms[e.a], rooms[e.b], rng));

    const spawn = { x: rooms[0].cx, y: rooms[0].cy };
    const dist = bfs(tiles, spawn.x, spawn.y);
    const verified = rooms.every((r) => dist.has(key(r.cx, r.cy)));

    // stairs go in the room that is farthest (in walking steps) from the spawn
    let far = rooms[1];
    for (const r of rooms) if ((dist.get(key(r.cx, r.cy)) || 0) > (dist.get(key(far.cx, far.cy)) || 0)) far = r;
    const stairs = { x: far.cx, y: far.cy };

    return { rooms, tiles, mst, spawn, stairs, dist, verified, stairsRoom: far.id };
  }

  function generateDungeon(opts = {}) {
    const floor = opts.floor || 1;
    const seed = opts.seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : opts.seed;
    let result;
    for (let attempt = 1; attempt <= 30; attempt++) {
      result = buildOnce((seed + attempt * 7919) >>> 0, floor);
      if (result.verified) {
        result.attempts = attempt;
        break;
      }
    }
    result.seed = seed;
    result.cols = COLS;
    result.rows = ROWS;
    return result;
  }

  Object.assign(DG, { COLS, ROWS, key, DIRS, DSU, mulberry32, generateDungeon, bfs, kruskal });
})(globalThis);

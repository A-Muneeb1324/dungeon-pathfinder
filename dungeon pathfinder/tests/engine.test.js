// Run with:  node --test tests/engine.test.js
const test = require("node:test");
const assert = require("node:assert");
require("../static/js/heap.js");
require("../static/js/dungeon.js");
require("../static/js/astar.js");
const { MinHeap, DSU, generateDungeon, bfs, astar, key, COLS } = globalThis.DG;

test("MinHeap pops values in sorted order", () => {
  const h = new MinHeap();
  const values = Array.from({ length: 2000 }, () => Math.floor(Math.random() * 1e6));
  values.forEach((v) => h.push(v));
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepStrictEqual(out, [...values].sort((a, b) => a - b));
});

test("DSU merges sets and detects cycles", () => {
  const d = new DSU(5);
  assert.ok(d.union(0, 1));
  assert.ok(d.union(1, 2));
  assert.ok(!d.union(0, 2), "0 and 2 are already connected");
  assert.strictEqual(d.find(0), d.find(2));
  assert.notStrictEqual(d.find(0), d.find(4));
  assert.strictEqual(d.sets, 3);
});

test("every generated room is reachable from spawn (BFS) and MST has V-1 edges", () => {
  for (let floor = 1; floor <= 8; floor++) {
    for (let seed = 1; seed <= 300; seed++) {
      const d = generateDungeon({ seed, floor });
      assert.ok(d.verified, `seed ${seed} floor ${floor} not verified`);
      assert.strictEqual(d.mst.length, d.rooms.length - 1);
      const dist = bfs(d.tiles, d.spawn.x, d.spawn.y); // independent re-check
      for (const r of d.rooms) assert.ok(dist.has(key(r.cx, r.cy)), `room ${r.id} unreachable`);
      assert.ok(dist.has(key(d.stairs.x, d.stairs.y)), "stairs unreachable");
    }
  }
});

test("A* returns shortest paths (equal to BFS distance) and is fast", () => {
  let worst = 0;
  let calls = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const d = generateDungeon({ seed, floor: 5 });
    const walkable = (x, y) => x >= 0 && y >= 0 && x < COLS && d.tiles.has(key(x, y));
    const cells = [...d.tiles.keys()];
    for (let i = 0; i < 10; i++) {
      const a = cells[(seed * 31 + i * 97) % cells.length];
      const b = cells[(seed * 53 + i * 211) % cells.length];
      const s = { x: a % COLS, y: Math.floor(a / COLS) };
      const g = { x: b % COLS, y: Math.floor(b / COLS) };
      const t0 = performance.now();
      const r = astar(s, g, walkable, 5000);
      worst = Math.max(worst, performance.now() - t0);
      calls++;
      const expected = bfs(d.tiles, s.x, s.y).get(b);
      assert.ok(r.found);
      assert.strictEqual(r.path.length, expected, "A* path must be optimal");
    }
  }
  console.log(`      A*: ${calls} searches, slowest ${worst.toFixed(2)} ms (budget 16 ms)`);
  assert.ok(worst < 16, `slowest A* took ${worst}ms`);
});

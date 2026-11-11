// Plays the real game.js headlessly against a stubbed DOM.
// Run with:  node --test tests/smoke.test.js
const test = require("node:test");
const assert = require("node:assert");

const stub = () =>
  new Proxy(function () {}, {
    get: (t, p) => (p === "style" || p === "dataset" || p === "classList" ? stub() : p === Symbol.toPrimitive ? () => 0 : stub()),
    apply: () => stub(),
    set: () => true,
  });

const els = {};
const fakeCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
function makeEl(id) {
  return {
    id, hidden: false, textContent: "", style: {}, dataset: {}, value: "Tester", disabled: false,
    parentElement: { classList: { toggle() {} } },
    getContext: () => fakeCtx, width: 0, height: 0,
    addEventListener() {}, append() {}, replaceChildren() {}, focus() {},
  };
}
global.document = {
  getElementById: (id) => (els[id] = els[id] || makeEl(id)),
  querySelectorAll: () => [],
  createElement: () => makeEl("x"),
};
global.window = { addEventListener() {}, matchMedia: () => ({ matches: true }) };
global.matchMedia = () => ({ matches: true });
global.requestAnimationFrame = () => 0;
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "t", scores: [] }) });

require("../static/js/heap.js");
require("../static/js/dungeon.js");
require("../static/js/astar.js");
require("../static/js/game.js");

test("random play for several runs never throws and ends cleanly", () => {
  const { state, press, restart } = globalThis.DG.game;
  const moves = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]];
  let deepest = 1;
  for (let run = 0; run < 30; run++) {
    restart();
    for (let i = 0; i < 4000 && !state().over; i++) {
      press(...moves[Math.floor(Math.random() * moves.length)]);
      deepest = Math.max(deepest, state().floor);
    }
  }
  assert.ok(state().dungeon.verified);
  console.log(`      30 random runs OK (deepest floor reached: ${deepest})`);
});

test("a chasing enemy steps toward the player along an A* path", () => {
  const { state, restart, press } = globalThis.DG.game;
  restart();
  const S = state();
  const e = S.enemies[0];
  e.state = "awake"; // wake it so it chases
  const before = Math.abs(e.x - S.player.x) + Math.abs(e.y - S.player.y);
  e.time = 0;
  press(0, 0); // wait a turn so the scheduler runs enemies
  const after = Math.abs(e.x - S.player.x) + Math.abs(e.y - S.player.y);
  assert.ok(after <= before);
});


test("monsters start asleep and stay put while you are far away", () => {
  const { state, press, restart } = globalThis.DG.game;
  restart();
  const S = state();
  const start = S.enemies.map((e) => [e.x, e.y]);
  assert.ok(S.enemies.every((e) => e.state === "sleeping"));
  for (let i = 0; i < 20; i++) press(0, 0);
  S.enemies.forEach((e, i) => {
    assert.strictEqual(e.state, "sleeping");
    assert.deepStrictEqual([e.x, e.y], start[i]);
  });
});

function placeBesidePlayer(S, e) {
  const { key, COLS } = globalThis.DG;
  const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) =>
    S.dungeon.tiles.has(key(S.player.x + dx, S.player.y + dy))
  );
  e.x = S.player.x + dx;
  e.y = S.player.y + dy;
  return [dx, dy];
}

test("hitting a sleeper that survives wakes it and makes noise that wakes others", () => {
  const { state, press, restart, } = globalThis.DG.game;
  const { key, COLS } = globalThis.DG;
  restart();
  const S = state();
  const [a, b] = S.enemies;
  const [dx, dy] = placeBesidePlayer(S, a);
  a.hp = 10; // survive the sneak attack
  // park b 7-8 tiles away: too far to see you, close enough to hear
  let spot = null;
  for (const k of S.dungeon.tiles.keys()) {
    const x = k % COLS, y = Math.floor(k / COLS);
    const d = Math.abs(x - S.player.x) + Math.abs(y - S.player.y);
    if (d >= 7 && d <= 8 && !S.enemies.some((e) => e.x === x && e.y === y)) { spot = [x, y]; break; }
  }
  if (!spot) return; // layout had no such tile; nothing to test
  [b.x, b.y] = spot;
  press(dx, dy);
  assert.strictEqual(a.hp, 6, "sneak attack deals 4");
  assert.strictEqual(a.state, "awake");
  assert.strictEqual(b.state, "awake", "noise should wake b");
});

test("a sneak kill is silent and does not wake other monsters", () => {
  const { state, press, restart } = globalThis.DG.game;
  const { COLS } = globalThis.DG;
  restart();
  const S = state();
  const [a, b] = S.enemies;
  const [dx, dy] = placeBesidePlayer(S, a);
  a.hp = 3;
  let spot = null;
  for (const k of S.dungeon.tiles.keys()) {
    const x = k % COLS, y = Math.floor(k / COLS);
    const d = Math.abs(x - S.player.x) + Math.abs(y - S.player.y);
    if (d >= 7 && d <= 8 && !S.enemies.some((e) => e.x === x && e.y === y)) { spot = [x, y]; break; }
  }
  if (!spot) return;
  [b.x, b.y] = spot;
  press(dx, dy);
  assert.ok(a.dead);
  assert.strictEqual(b.state, "sleeping");
});

test("attack wind-up: no damage on the first adjacent turn, damage on the second", () => {
  const { state, press, restart } = globalThis.DG.game;
  restart();
  const S = state();
  const e = S.enemies[0];
  placeBesidePlayer(S, e);
  e.state = "awake"; e.cost = 100; e.dmg = 1;
  const full = S.player.hp;
  for (let i = 0; i < 6 && !e.windup; i++) press(0, 0);
  assert.ok(e.windup, "enemy should start a wind-up");
  assert.strictEqual(S.player.hp, full, "no damage during wind-up");
  for (let i = 0; i < 6 && S.player.hp === full; i++) press(0, 0);
  assert.strictEqual(S.player.hp, full - 1, "enemy strikes after the wind-up");
  assert.strictEqual(e.windup, false);
});

test("stepping away during a wind-up cancels the attack", () => {
  const { state, press, restart } = globalThis.DG.game;
  const { key } = globalThis.DG;
  restart();
  const S = state();
  const e = S.enemies[0];
  const [dx, dy] = placeBesidePlayer(S, e);
  e.state = "awake"; e.cost = 100; e.dmg = 1;
  const full = S.player.hp;
  for (let i = 0; i < 6 && !e.windup; i++) press(0, 0);
  assert.ok(e.windup);
  // step directly away from the enemy (if that tile is floor)
  if (!S.dungeon.tiles.has(key(S.player.x - dx, S.player.y - dy))) return;
  press(-dx, -dy);
  press(0, 0);
  assert.strictEqual(S.player.hp, full, "no damage after stepping away");
});

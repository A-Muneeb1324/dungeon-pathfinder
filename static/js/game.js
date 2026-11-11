/* Game loop, turn scheduler, rendering and API calls.
 *
 * Turn order: every entity sits in a MinHeap keyed by the time of its next
 * action. The player acts when they are at the top of the heap; after the
 * player moves, enemies whose time is earlier act in order (slower enemies
 * simply get a larger "cost", so they act less often). */
(function () {
  const { MinHeap, generateDungeon, astar, COLS, ROWS, key, DIRS } = DG;

  const TILE = 20;
  const AGGRO = 14; // awake enemies chase when the player is within this many tiles
  const SLEEP_CHANCE = 1; // 1 = every monster starts asleep; 0.7 = 30% start awake
  const WAKE_SIGHT = 6; // a sleeper notices you if it has line of sight within this many tiles
  const NOISE_RADIUS = 8; // fighting wakes every sleeper within this many tiles (walls do not block noise)
  const SNEAK_DAMAGE = 4; // damage when you hit a sleeping monster (normal hit = 2)
  const STRIKE_AT = 2; // a monster hits on its Nth turn in reach (1st turn = caution only)
  const COLORS = {
    wall: "#14181c",
    floorA: "#28313a",
    floorB: "#2c363f",
    torch: "#f0b44c",
    parchment: "#dcd5c0",
    rust: "#c4493d",
    moss: "#7fae7a",
    violet: "#9a86c4",
    stairs: "#5fb3b3",
  };
  const ENEMY_TYPES = {
    slime: { color: COLORS.moss, hp: 2, dmg: 1, cost: 150 },
    goblin: { color: COLORS.rust, hp: 3, dmg: 1, cost: 100 },
    ogre: { color: COLORS.violet, hp: 6, dmg: 2, cost: 140 },
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let S = null; // the whole game state lives here

  /* ---------- helpers ---------- */
  const rand = (n) => Math.floor(Math.random() * n);
  const walkable = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && S.dungeon.tiles.has(key(x, y));
  const enemyAt = (x, y) => S.enemies.find((e) => !e.dead && e.x === x && e.y === y);
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  /* Bresenham line of sight: true if no wall tile lies between the two points. */
  function hasLineOfSight(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      if (x0 === x1 && y0 === y1) return true;
      if (!walkable(x0, y0)) return false;
    }
    return true;
  }

  /* Wake every sleeping monster within `radius` tiles of the player. */
  /* ----------------------------added code----------------------------------------------*/
  /* True if a and b are in reach of each other: side by side, or diagonal
     (like a chess king) as long as no wall corner sits between them. */
  function isAdjacent(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) return false;
    if (dx + dy === 1) return true;
    return walkable(a.x, b.y) && walkable(b.x, a.y);
  }
  /*-------------------------------------end of added code-------------------------------*/
  function makeNoise(radius, message) {
    let woke = 0;
    for (const e of S.enemies) {
      if (!e.dead && e.state === "sleeping" && manhattan(e, S.player) <= radius) {
        e.state = "awake";
        woke++;
      }
    }
    if (woke > 0) log(message);
  }

  function log(msg) {
    S.log.push(msg);
    if (S.log.length > 5) S.log.shift();
  }

  /* ---------- run + floor setup ---------- */
  function newRun() {
    S = {
      floor: 1,
      score: 0,
      over: false,
      token: null,
      submitted: false,
      player: { type: "player", x: 0, y: 0, hp: 10, maxHp: 10, time: 0, cost: 100, order: 0 },
      enemies: [],
      items: new Map(), // hash map: tile key -> {type}
      dungeon: null,
      sched: null,
      showPaths: false,
      showMst: false,
      turnStats: { samples: [], max: 0 },
      flash: 0,
      log: [],
    };
    $("over").hidden = true;
    fetch("/api/run/start/")
      .then((r) => r.json())
      .then((d) => (S.token = d.token))
      .catch(() => (S.token = null));
    buildFloor();
    log("You descend into the dark. Find the stairs.");
    syncHud();
  }

  function randomFreeCell(rooms, taken) {
    for (let i = 0; i < 80; i++) {
      const r = rooms[rand(rooms.length)];
      const x = r.x + rand(r.w);
      const y = r.y + rand(r.h);
      if (!taken.has(key(x, y))) return { x, y };
    }
    return null;
  }

  function buildFloor() {
    const d = generateDungeon({ floor: S.floor });
    S.dungeon = d;
    S.items = new Map();
    S.enemies = [];
    S.player.x = d.spawn.x;
    S.player.y = d.spawn.y;
    S.player.time = 0;

    const taken = new Set([key(d.spawn.x, d.spawn.y), key(d.stairs.x, d.stairs.y)]);
    S.items.set(key(d.stairs.x, d.stairs.y), { type: "stairs" });

    const spare = d.rooms.filter((r) => r.id !== 0);
    const place = (type, count) => {
      for (let i = 0; i < count; i++) {
        const c = randomFreeCell(spare, taken);
        if (!c) continue;
        taken.add(key(c.x, c.y));
        S.items.set(key(c.x, c.y), { type });
      }
    };
    place("gold", 5 + S.floor);
    place("potion", S.floor % 2 ? 2 : 1);

    const count = Math.min(2 + S.floor, 10);
    for (let i = 0; i < count; i++) {
      let c = null;
      for (let t = 0; t < 30 && !c; t++) {
        const cand = randomFreeCell(spare, taken);
        if (cand && manhattan(cand, S.player) > 8) c = cand;
      }
      if (!c) continue;
      taken.add(key(c.x, c.y));
      const pool = S.floor >= 3 ? ["slime", "goblin", "goblin", "ogre"] : ["slime", "goblin"];
      const type = pool[rand(pool.length)];
      const t = ENEMY_TYPES[type];
      S.enemies.push({
        type,
        x: c.x,
        y: c.y,
        hp: t.hp + (S.floor > 4 ? 1 : 0),
        dmg: t.dmg,
        cost: t.cost,
        color: t.color,
        time: 50 + rand(100),
        order: i + 1,
        dead: false,
        path: null,
        state: Math.random() < SLEEP_CHANCE ? "sleeping" : "awake",
        windup: false,
        alert: 0, // consecutive monster turns you have stayed in its reach
      });
    }

    S.sched = new MinHeap((a, b) => a.time - b.time || a.order - b.order);
    S.sched.push(S.player);
    S.enemies.forEach((e) => S.sched.push(e));
    buildFloorLayer();
    advance();
  }

  /* Pre-render the static floor once per level into an offscreen canvas. */
  function buildFloorLayer() {
    const layer = document.createElement("canvas");
    layer.width = canvas.width;
    layer.height = canvas.height;
    const c = layer.getContext("2d");
    c.fillStyle = COLORS.wall;
    c.fillRect(0, 0, layer.width, layer.height);
    for (const k of S.dungeon.tiles.keys()) {
      const x = k % COLS;
      const y = Math.floor(k / COLS);
      c.fillStyle = (x + y) % 2 ? COLORS.floorA : COLORS.floorB;
      c.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
    S.floorLayer = layer;
  }

  /* ---------- turn scheduler (priority queue) ---------- */
  function advance() {
    let turnMs = 0;
    while (!S.over) {
      const top = S.sched.peek();
      if (top === S.player) break;
      S.sched.pop();
      if (top.dead) continue;
      turnMs += enemyAct(top);
      top.time += top.cost;
      S.sched.push(top);
    }
    if (turnMs > 0) {
      const st = S.turnStats;
      st.samples.push(turnMs);
      if (st.samples.length > 100) st.samples.shift();
      st.max = Math.max(st.max, turnMs);
    }
  }

  // /* Returns the milliseconds spent in A* for this action. */
  // function enemyAct(e) {
  //   const p = S.player;
  //   const d = manhattan(e, p);
  //   e.path = null;

  //   // Sleeping monsters do nothing until they see you (noise is handled in playerAct).
  //   if (e.state === "sleeping") {
  //     if (d <= WAKE_SIGHT && hasLineOfSight(e.x, e.y, p.x, p.y)) {
  //       e.state = "awake";
  //       log(`The ${e.type} notices you!`);
  //     }
  //     return 0;
  //   }

  //   // // If you stepped away during the wind-up, the attack is cancelled.
  //   // if (e.windup && d !== 1) e.windup = false;

  //   // // Adjacent: first turn = raise weapon (no damage), next turn = strike if you are still adjacent.
  //   // if (d === 1) {
  //   /*-----------------------------added code------------------------------------------------*/
  //   const touching = isAdjacent(e, p); // side by side OR diagonal

  //   // If you moved out of reach during the wind-up, the attack is cancelled.
  //   if (e.windup && !touching) e.windup = false;

  //   // In reach: first turn = raise weapon (no damage), next turn = strike if you are still in reach.
  //   if (touching) {
  //     /*-----------------------------added code------------------------------------------------*/
  //     if (!e.windup) {
  //       e.windup = true;
  //       log(`The ${e.type} raises its weapon...`);
  //       return 0;
  //     }
  //     e.windup = false;
  //     p.hp -= e.dmg;
  //     S.flash = 1;
  //     log(`The ${e.type} hits you for ${e.dmg}.`);
  //     if (p.hp <= 0) gameOver();
  //     return 0;
  //   }

  //   if (d <= AGGRO) {
  //     const t0 = performance.now();
  //     const r = astar(e, p, walkable, 2500);
  //     const ms = performance.now() - t0;
  //     if (r.found && r.path.length > 0) {
  //       e.path = r.path;
  //       const step = r.path[0];
  //       if (!enemyAt(step.x, step.y) && !(step.x === p.x && step.y === p.y)) {
  //         e.x = step.x;
  //         e.y = step.y;
  //       }
  //     }
  //     return ms;
  //   }

  //   if (Math.random() < 0.5) {
  //     const [dx, dy] = DIRS[rand(4)];
  //     if (walkable(e.x + dx, e.y + dy) && !enemyAt(e.x + dx, e.y + dy)) {
  //       e.x += dx;
  //       e.y += dy;
  //     }
  //   }
  //   return 0;
  // }
  /*-----------------------------added code------------------------------------------------*/
  function enemyAct(e) {
    const p = S.player;
    const d = manhattan(e, p);
    e.path = null;

    // Sleeping monsters do nothing until they see you (noise is handled in playerAct).
    if (e.state === "sleeping") {
      if (d <= WAKE_SIGHT && hasLineOfSight(e.x, e.y, p.x, p.y)) {
        e.state = "awake";
        log(`The ${e.type} notices you!`);
      }
      return 0;
    }

    // Reach = the 8 squares around the monster (a chess king's territory).
    if (isAdjacent(e, p)) {
      e.alert += 1; // counts this monster's turns while you stay in its reach
      e.windup = true; // yellow box = armed
      if (e.alert < STRIKE_AT) {
        // caution: no damage yet (this is your free action)
        log(`The ${e.type} raises its weapon...`);
        return 0;
      }
      // alert >= STRIKE_AT: it hits, and keeps hitting every turn you stay in reach.
      // Moving to another square that is still in reach does NOT reset the count.
      p.hp -= e.dmg;
      S.flash = 1;
      log(`The ${e.type} hits you for ${e.dmg}.`);
      if (p.hp <= 0) gameOver();
      return 0;
    }

    // Out of reach: the warning is forgotten, the monster chases (or wanders).
    e.alert = 0;
    e.windup = false;

    if (d <= AGGRO) {
      const t0 = performance.now();
      const r = astar(e, p, walkable, 2500);
      const ms = performance.now() - t0;
      if (r.found && r.path.length > 0) {
        e.path = r.path;
        const step = r.path[0];
        if (!enemyAt(step.x, step.y) && !(step.x === p.x && step.y === p.y)) {
          e.x = step.x;
          e.y = step.y;
        }
      }
      return ms;
    }

    if (Math.random() < 0.5) {
      const [dx, dy] = DIRS[rand(4)];
      if (walkable(e.x + dx, e.y + dy) && !enemyAt(e.x + dx, e.y + dy)) {
        e.x += dx;
        e.y += dy;
      }
    }
    return 0;
  }
  /*----------added code--------------------------------------------------------*/
  /* ---------- player actions ---------- */
  function playerAct(dx, dy) {
    if (S.over) return;
    const p = S.player;
    if (S.sched.peek() !== p) advance();

    if (dx !== 0 || dy !== 0) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      // const foe = enemyAt(nx, ny);
      /*-----------------------------added code------------------------------------------------*/
      if (dx !== 0 && dy !== 0 && !isAdjacent(p, { x: nx, y: ny })) return; // wall corner in the way
      const foe = enemyAt(nx, ny);
      /*-----------------------------added code------------------------------------------------*/
      if (foe) {
        const sneak = foe.state === "sleeping";
        foe.hp -= sneak ? SNEAK_DAMAGE : 2;
        foe.state = "awake";
        if (foe.hp <= 0) {
          foe.dead = true;
          S.score += 25;
          if (sneak) {
            log(`You silently slay the sleeping ${foe.type}. +25`);
          } else {
            log(`You slay the ${foe.type}. +25`);
            makeNoise(NOISE_RADIUS, "The clash of steel wakes nearby monsters.");
          }
        } else {
          log(sneak ? `You stab the sleeping ${foe.type}!` : `You hit the ${foe.type}.`);
          makeNoise(NOISE_RADIUS, "The clash of steel wakes nearby monsters.");
        }
      } else if (walkable(nx, ny)) {
        p.x = nx;
        p.y = ny;
        if (pickup()) {
          syncHud();
          return;
        }
      } else {
        return; // bumping a wall costs no turn
      }
    }

    S.sched.pop(); // the player is on top of the heap
    p.time += p.cost;
    S.sched.push(p);
    advance();
    syncHud();
  }

  /* Returns true if the player took the stairs (new floor already built). */
  function pickup() {
    const p = S.player;
    const k = key(p.x, p.y);
    const item = S.items.get(k);
    if (!item) return false;
    if (item.type === "gold") {
      S.score += 10;
      S.items.delete(k);
      log("You pick up gold. +10");
    } else if (item.type === "potion") {
      p.hp = Math.min(p.maxHp, p.hp + 4);
      S.items.delete(k);
      log("You drink a potion. +4 HP");
    } else if (item.type === "stairs") {
      S.floor += 1;
      S.score += 100;
      p.hp = Math.min(p.maxHp, p.hp + 2);
      log(`Floor ${S.floor}. The enemies here are tougher.`);
      buildFloor();
      return true;
    }
    return false;
  }

  function gameOver() {
    S.over = true;
    $("over-score").textContent = S.score;
    $("over-floor").textContent = S.floor;
    $("over-msg").textContent = "";
    $("submit").disabled = !S.token;
    $("over").hidden = false;
    $("player-name").focus();
  }

  /* ---------- HUD ---------- */
  function syncHud() {
    const p = S.player;
    $("hp-bar").style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    $("hp-text").textContent = `${Math.max(0, p.hp)} / ${p.maxHp}`;
    $("floor").textContent = S.floor;
    $("score").textContent = S.score;
    $("log").textContent = S.log.join("\n");

    const st = S.turnStats;
    const avg = st.samples.length ? st.samples.reduce((a, b) => a + b, 0) / st.samples.length : 0;
    $("astar-avg").textContent = avg.toFixed(2);
    $("astar-max").textContent = st.max.toFixed(2);
    $("astar-max").parentElement.classList.toggle("bad", st.max > 16);

    const d = S.dungeon;
    $("bfs").textContent = d.verified
      ? `${d.rooms.length} of ${d.rooms.length} rooms reachable (BFS passed, attempt ${d.attempts})`
      : "Layout failed the BFS check";
  }

  /* ---------- rendering (requestAnimationFrame loop) ---------- */
  function render(t) {
    const d = S.dungeon;
    ctx.drawImage(S.floorLayer, 0, 0);

    if (S.showMst) {
      ctx.save();
      ctx.strokeStyle = "rgba(240,180,76,0.55)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      for (const e of d.mst) {
        const a = d.rooms[e.a];
        const b = d.rooms[e.b];
        ctx.beginPath();
        ctx.moveTo(a.cx * TILE + TILE / 2, a.cy * TILE + TILE / 2);
        ctx.lineTo(b.cx * TILE + TILE / 2, b.cy * TILE + TILE / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const [k, item] of S.items) {
      const x = (k % COLS) * TILE;
      const y = Math.floor(k / COLS) * TILE;
      if (item.type === "gold") {
        ctx.fillStyle = COLORS.torch;
        ctx.beginPath();
        ctx.arc(x + TILE / 2, y + TILE / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (item.type === "potion") {
        ctx.fillStyle = COLORS.rust;
        ctx.beginPath();
        ctx.arc(x + TILE / 2, y + TILE / 2 + 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.parchment;
        ctx.fillRect(x + TILE / 2 - 2, y + 3, 4, 5);
      } else {
        ctx.strokeStyle = COLORS.stairs;
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) ctx.strokeRect(x + 2 + i * 3, y + 2 + i * 3, TILE - 4 - i * 6, TILE - 4 - i * 6);
      }
    }

    if (S.showPaths) {
      for (const e of S.enemies) {
        if (e.dead || !e.path) continue;
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 0.5;
        for (const s of e.path) ctx.fillRect(s.x * TILE + 7, s.y * TILE + 7, 6, 6);
        ctx.globalAlpha = 1;
      }
    }

    for (const e of S.enemies) {
      if (e.dead) continue;
      const x = e.x * TILE;
      const y = e.y * TILE;
      ctx.globalAlpha = e.state === "sleeping" ? 0.45 : 1; // sleepers look dim
      ctx.fillStyle = e.color;
      if (e.type === "slime") {
        ctx.beginPath();
        ctx.ellipse(x + TILE / 2, y + TILE / 2 + 2, 8, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === "goblin") {
        ctx.beginPath();
        ctx.moveTo(x + TILE / 2, y + 2);
        ctx.lineTo(x + TILE - 3, y + TILE - 3);
        ctx.lineTo(x + 3, y + TILE - 3);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      }
      ctx.fillStyle = "#14181c";
      ctx.fillRect(x + 6, y + TILE / 2 - 2, 3, 3);
      ctx.fillRect(x + 11, y + TILE / 2 - 2, 3, 3);
      ctx.globalAlpha = 1;
      ctx.font = "bold 11px system-ui, sans-serif";
      if (e.state === "sleeping") {
        ctx.fillStyle = COLORS.parchment;
        ctx.fillText("z", x + TILE - 7, y + 9);
      } else if (e.windup) {
        ctx.strokeStyle = COLORS.torch;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        ctx.fillStyle = COLORS.torch;
        ctx.fillText("!", x + TILE - 6, y + 9);
      }
    }

    const p = S.player;
    ctx.fillStyle = COLORS.parchment;
    ctx.fillRect(p.x * TILE + 4, p.y * TILE + 4, TILE - 8, TILE - 8);
    ctx.fillStyle = COLORS.torch;
    ctx.fillRect(p.x * TILE + 8, p.y * TILE + 8, TILE - 16, TILE - 16);

    // torchlight: darkness closes in beyond the lantern radius
    const pulse = reduceMotion ? 0 : Math.sin(t / 300) * 6;
    const cx = p.x * TILE + TILE / 2;
    const cy = p.y * TILE + TILE / 2;
    const grad = ctx.createRadialGradient(cx, cy, 60, cx, cy, 230 + pulse);
    grad.addColorStop(0, "rgba(10,12,15,0)");
    grad.addColorStop(1, "rgba(10,12,15,0.78)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (S.flash > 0) {
      ctx.fillStyle = `rgba(196,73,61,${S.flash * 0.35})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      S.flash = Math.max(0, S.flash - 0.08);
    }
  }

  function frame(t) {
    render(t);
    requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  const KEYS = {
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    // " ": [0, 0], ".": [0, 0],
    /*-----------------------------added code------------------------------------------------*/
    " ": [0, 0], ".": [0, 0],
    q: [-1, -1], Q: [-1, -1], e: [1, -1], E: [1, -1],
    z: [-1, 1], Z: [-1, 1], c: [1, 1], C: [1, 1],
    /*-----------------------------added code------------------------------------------------*/

  };

  window.addEventListener("keydown", (ev) => {
    if (ev.target && ev.target.tagName === "INPUT") return;
    if (ev.key === "p" || ev.key === "P") {
      S.showPaths = !S.showPaths;
    } else if (ev.key === "m" || ev.key === "M") {
      S.showMst = !S.showMst;
    } else if (ev.key === "r" || ev.key === "R") {
      if (S.over) newRun();
    } else if (KEYS[ev.key]) {
      ev.preventDefault();
      playerAct(...KEYS[ev.key]);
    }
  });

  document.querySelectorAll("[data-dx]").forEach((btn) =>
    btn.addEventListener("click", () => playerAct(Number(btn.dataset.dx), Number(btn.dataset.dy)))
  );
  $("toggle-paths").addEventListener("click", () => (S.showPaths = !S.showPaths));
  $("toggle-mst").addEventListener("click", () => (S.showMst = !S.showMst));
  $("again").addEventListener("click", newRun);

  /* ---------- leaderboard API ---------- */
  function renderScores(list) {
    const ol = $("scores");
    ol.replaceChildren();
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No scores yet. Be the first.";
      ol.append(li);
      return;
    }
    list.forEach((s) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = s.player_name; // textContent: names are user input
      const pts = document.createElement("span");
      pts.textContent = `${s.score} (floor ${s.floor})`;
      li.append(name, pts);
      ol.append(li);
    });
  }

  function loadScores() {
    fetch("/api/scores/")
      .then((r) => r.json())
      .then((d) => renderScores(d.scores))
      .catch(() => {
        $("scores").replaceChildren();
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "Leaderboard unavailable.";
        $("scores").append(li);
      });
  }

  $("submit").addEventListener("click", () => {
    const msg = $("over-msg");
    if (S.submitted) return;
    $("submit").disabled = true;
    fetch("/api/scores/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_name: $("player-name").value,
        score: S.score,
        floor: S.floor,
        token: S.token,
      }),
    })
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (ok) {
          S.submitted = true;
          msg.textContent = "Score saved.";
          renderScores(body.scores);
        } else {
          msg.textContent = body.error || "Could not save the score.";
          $("submit").disabled = false;
        }
      })
      .catch(() => {
        msg.textContent = "Network error. Try again.";
        $("submit").disabled = false;
      });
  });

  // handy for tests and the browser console
  DG.game = { state: () => S, press: playerAct, restart: newRun };

  newRun();
  loadScores();
  requestAnimationFrame(frame);
})();

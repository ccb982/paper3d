// 全新的游戏/.workbuddy/tmp/2026-09-18_ai-target/ai-probe.ts
import { readFileSync } from "node:fs";

// 全新的游戏/src/systems/ai/aiconfig.ts
function mobAI(p = {}) {
  const wander = p.wanderSpeed ?? 2;
  const chase = p.chaseSpeed ?? 2.5;
  const aggro = p.aggroRadius ?? 8;
  const attack = p.attackRadius ?? 1.5;
  const lose = p.loseRadius ?? 12;
  const melee = p.meleeDuration ?? 0.6;
  const dmg = p.meleeDamage ?? 8;
  const range = p.attackRange ?? 1.8;
  const rng = p.ranged;
  const attackBehavior = rng ? {
    name: "rangedShot",
    params: {
      duration: melee,
      damage: rng.damage ?? dmg,
      speed: rng.speed ?? 26,
      lifetime: rng.lifetime ?? 2.4,
      aimHeight: rng.aimHeight ?? 0,
      muzzleHeight: rng.muzzleHeight ?? 0,
      spread: rng.spread ?? 0.05,
      skin: rng.skin ?? "arrow"
    }
  } : { name: "meleeSwing", params: { duration: melee, damage: dmg, range } };
  return {
    states: {
      patrol: {
        behaviors: [{ name: "wander", params: { speed: wander, turnRate: 0.5, turnInterval: 0.4, targetBias: 0.04, biasCamp: "player" } }],
        transitions: [
          { cond: "seePlayer", params: { radius: aggro, camp: "player" }, to: "chase" }
        ],
        minStay: 3
      },
      chase: {
        behaviors: [{ name: "moveToTarget", params: { speed: chase } }],
        transitions: [
          { cond: "retarget", to: "chase" },
          { cond: "inRange", params: { radius: attack }, to: "attack" },
          { cond: "loseTarget", params: { radius: lose }, to: "patrol" }
        ]
      },
      attack: {
        behaviors: [attackBehavior],
        transitions: [
          { cond: "retarget", to: "chase" },
          // ★ 近战：打一下回巡逻；远程：回追击 → 立刻再次进射程 → 持续开火
          { cond: "attackFinished", to: rng ? "chase" : "patrol" },
          { cond: "outOfRange", params: { radius: attack + 0.5 }, to: rng ? "chase" : "patrol" }
        ]
      }
    },
    initial: "patrol"
  };
}
var ROCK_BUG_AI = mobAI({
  wanderSpeed: 1.4,
  chaseSpeed: 1.8,
  aggroRadius: 5,
  attackRadius: 1.2,
  loseRadius: 9,
  meleeDuration: 0.5,
  meleeDamage: 4
});
var REUNION_AI = mobAI({
  wanderSpeed: 2,
  chaseSpeed: 2.5,
  aggroRadius: 8,
  attackRadius: 1.5,
  loseRadius: 12,
  meleeDuration: 0.6,
  meleeDamage: 9
});
var LAOJIE_AI = mobAI({
  wanderSpeed: 3,
  chaseSpeed: 3.8,
  aggroRadius: 12,
  attackRadius: 1.8,
  loseRadius: 18,
  meleeDuration: 0.65,
  meleeDamage: 14
});
var SEA_MONSTER_AI = mobAI({
  wanderSpeed: 1.8,
  chaseSpeed: 2.2,
  aggroRadius: 9,
  attackRadius: 1.8,
  loseRadius: 14,
  meleeDuration: 0.7,
  meleeDamage: 12
});
var SARKAZ_SWORDSMAN_AI = mobAI({
  wanderSpeed: 2.4,
  chaseSpeed: 3.2,
  aggroRadius: 11,
  attackRadius: 2.2,
  attackRange: 2.2,
  loseRadius: 18,
  meleeDuration: 0.7,
  meleeDamage: 18
});
var SHIELD_GUARD_AI = mobAI({
  wanderSpeed: 1.2,
  chaseSpeed: 1.6,
  aggroRadius: 10,
  attackRadius: 2,
  attackRange: 2.2,
  loseRadius: 16,
  meleeDuration: 0.8,
  meleeDamage: 10
});
var BOMBER_AI = mobAI({
  wanderSpeed: 3,
  chaseSpeed: 4.2,
  aggroRadius: 14,
  attackRadius: 2,
  attackRange: 2,
  loseRadius: 22,
  meleeDuration: 0.45,
  meleeDamage: 22
});
var CROSSBOW_AI = mobAI({
  wanderSpeed: 2.2,
  chaseSpeed: 2.8,
  aggroRadius: 14,
  attackRadius: 9,
  attackRange: 9,
  loseRadius: 24,
  meleeDuration: 0.5,
  meleeDamage: 8,
  ranged: { speed: 30, lifetime: 1.6, damage: 8, spread: 0.045 }
});
var AMP_CASTER_AI = mobAI({
  wanderSpeed: 2,
  chaseSpeed: 2.4,
  aggroRadius: 16,
  attackRadius: 10,
  attackRange: 10,
  loseRadius: 26,
  meleeDuration: 0.8,
  meleeDamage: 10,
  ranged: { speed: 22, lifetime: 1.4, damage: 10, spread: 0.035, skin: "fireball" }
});
var WAR_CASTER_AI = mobAI({
  wanderSpeed: 1.6,
  chaseSpeed: 2,
  aggroRadius: 22,
  attackRadius: 13,
  attackRange: 13,
  loseRadius: 34,
  meleeDuration: 1.2,
  meleeDamage: 20,
  ranged: { speed: 18, lifetime: 1.6, damage: 20, spread: 0.03, skin: "fireball" }
});
var ROCK_GIANT_AI = mobAI({
  wanderSpeed: 1.8,
  chaseSpeed: 2.6,
  aggroRadius: 16,
  attackRadius: 3.4,
  attackRange: 3.4,
  loseRadius: 30,
  meleeDuration: 1,
  meleeDamage: 26
});

// 全新的游戏/src/systems/ai/behaviors.ts
function pnum(p, key, def) {
  const v = p?.[key];
  return v === void 0 ? def : Number(v);
}
function pstr(p, key, def) {
  const v = p?.[key];
  return v === void 0 ? def : String(v);
}
var behaviorTable = {};
function registerBehavior(name, fn) {
  behaviorTable[name] = fn;
}
registerBehavior("wander", (entity, ctx, params) => {
  const baseSpeed = pnum(params, "speed", 2);
  const turnRate = pnum(params, "turnRate", 0.5);
  const turnInterval = pnum(params, "turnInterval", 0.4);
  const targetBias = pnum(params, "targetBias", 0.04);
  const biasCamp = pstr(params, "biasCamp", "player");
  if (entity.aiMoveDir.x === 0 && entity.aiMoveDir.z === 0) {
    const a = Math.random() * Math.PI * 2;
    entity.aiMoveDir = { x: Math.cos(a), z: Math.sin(a) };
  }
  entity.aiTurnTimer -= ctx.dt;
  if (entity.aiTurnTimer <= 0) {
    entity.aiTurnTimer = turnInterval * (0.6 + Math.random() * 0.8);
    const rand = (Math.random() - 0.5) * 2 * turnRate;
    let angle = rand;
    const t = biasCamp ? ctx.findTarget(biasCamp) : null;
    if (t && targetBias > 0) {
      const toTarget = Math.atan2(t.z - entity.entity.position.z, t.x - entity.entity.position.x);
      let diff = toTarget - Math.atan2(entity.aiMoveDir.z, entity.aiMoveDir.x);
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      angle = rand + diff * targetBias;
    }
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const dx = entity.aiMoveDir.x * cosA - entity.aiMoveDir.z * sinA;
    const dz = entity.aiMoveDir.x * sinA + entity.aiMoveDir.z * cosA;
    entity.aiMoveDir = { x: dx, z: dz };
  }
  const speed = baseSpeed * (0.5 + 0.5 * Math.abs(Math.sin(ctx.time * 2.5 + entity.entity.id * 1.7)));
  entity.moveBy(entity.aiMoveDir.x, entity.aiMoveDir.z, ctx.dt, speed);
});
registerBehavior("moveToTarget", (entity, ctx, params) => {
  const speed = pnum(params, "speed", 2.5);
  const t = ctx.target;
  if (!t) return;
  const dx = t.x - entity.entity.position.x;
  const dz = t.z - entity.entity.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return;
  entity.moveBy(dx / len, dz / len, ctx.dt, speed);
});
registerBehavior("meleeSwing", (entity, ctx, params) => {
  const duration = pnum(params, "duration", 0.6);
  const range = pnum(params, "range", 1.8);
  const damage = pnum(params, "damage", 8);
  if (entity.aiAttackTimer <= 0) {
    entity.aiAttackTimer = duration;
    entity.aiSwingDone = false;
    if (ctx.target) {
      ctx.attack({
        type: "melee",
        source: entity,
        x: entity.position.x,
        y: entity.position.y + 1,
        z: entity.position.z,
        range,
        damage,
        camp: "enemy"
      });
    }
  }
  entity.aiAttackTimer -= ctx.dt;
  if (entity.aiAttackTimer <= 0) entity.aiSwingDone = true;
});
registerBehavior("rangedShot", (entity, ctx, params) => {
  const duration = pnum(params, "duration", 0.8);
  const damage = pnum(params, "damage", 8);
  const speed = pnum(params, "speed", 26);
  const lifetime = pnum(params, "lifetime", 2.4);
  const aimHeight = pnum(params, "aimHeight", 0);
  const muzzleHeight = pnum(params, "muzzleHeight", 0);
  const spread = pnum(params, "spread", 0.05);
  const bulletSkin = pstr(params, "skin", "arrow");
  if (entity.aiAttackTimer <= 0) {
    entity.aiAttackTimer = duration;
    entity.aiSwingDone = false;
    const t = ctx.target;
    if (t) {
      const ox = entity.position.x;
      const oy = entity.hitAnchorY() + muzzleHeight;
      const oz = entity.position.z;
      const ty = (ctx.focusY ?? entity.hitAnchorY()) + aimHeight;
      let dx = t.x - ox, dy = ty - oy, dz = t.z - oz;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      if (spread > 0) {
        const a = (Math.random() - 0.5) * 2 * spread;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = dx * ca - dz * sa;
        const nz = dx * sa + dz * ca;
        dx = nx;
        dz = nz;
        dy += (Math.random() - 0.5) * spread;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2;
        dy /= l2;
        dz /= l2;
      }
      const muzzle = 0.7;
      ctx.attack({
        type: "projectile",
        source: entity,
        x: ox + dx * muzzle,
        y: oy + dy * muzzle,
        z: oz + dz * muzzle,
        dirX: dx,
        dirY: dy,
        dirZ: dz,
        speed,
        camp: "enemy",
        lifetime,
        damage,
        bulletSkin
      });
    }
  }
  entity.aiAttackTimer -= ctx.dt;
  if (entity.aiAttackTimer <= 0) entity.aiSwingDone = true;
});

// 全新的游戏/src/systems/ai/conditions.ts
var conditionTable = {};
function registerCondition(name, fn) {
  conditionTable[name] = fn;
}
registerCondition("seePlayer", (entity, ctx, params) => {
  const radius = pnum(params, "radius", 8);
  const ep = entity.entity.position;
  let t = null;
  const cands = ctx.targetCandidates?.(entity);
  if (cands && cands.length > 0) {
    for (const c of cands) {
      const dx = c.x - ep.x;
      const dz = c.z - ep.z;
      const r = c.radius ?? radius;
      if (dx * dx + dz * dz <= r * r) {
        t = c;
        break;
      }
    }
  } else {
    const r2 = radius * radius;
    const camps = pstr(params, "camp", "player").split(",");
    for (const c of camps) {
      t = ctx.findTarget(c);
      if (t) break;
    }
    if (t) {
      const dx = t.x - ep.x;
      const dz = t.z - ep.z;
      if (dx * dx + dz * dz > r2) t = null;
    }
  }
  if (!t) {
    ctx.target = null;
    return false;
  }
  ctx.target = t;
  return true;
});
registerCondition("retarget", (entity, ctx) => {
  const cands = ctx.targetCandidates?.(entity);
  if (!cands || cands.length === 0) return false;
  const ep = entity.entity.position;
  for (const c of cands) {
    if (c.radius === void 0) continue;
    const dx = c.x - ep.x;
    const dz = c.z - ep.z;
    if (dx * dx + dz * dz > c.radius * c.radius) continue;
    const cur = ctx.target;
    if (cur && cur.x === c.x && cur.z === c.z) return false;
    ctx.target = { x: c.x, z: c.z };
    return true;
  }
  return false;
});
registerCondition("inRange", (_entity, ctx, params) => {
  const radius = pnum(params, "radius", 1.5);
  const t = ctx.target;
  if (!t) return false;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) <= radius;
});
registerCondition("outOfRange", (_entity, ctx, params) => {
  const radius = pnum(params, "radius", 2);
  const t = ctx.target;
  if (!t) return true;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) > radius;
});
registerCondition("attackFinished", (entity) => entity.aiSwingDone === true);
registerCondition("loseTarget", (_entity, ctx, params) => {
  const radius = pnum(params, "radius", 12);
  const t = ctx.target;
  if (!t) return true;
  return Math.hypot(t.x - _entity.entity.position.x, t.z - _entity.entity.position.z) > radius;
});

// 全新的游戏/src/systems/ai/AIStateMachine.ts
var AIStateMachine = class {
  constructor(config) {
    this.config = config;
    this.currentState = config.initial;
  }
  currentState;
  /** 当前状态已停留时间（minStay 判定） */
  stayTimer = 0;
  /** 每帧驱动：行为 → 条件 → 转移 */
  update(entity, ctx) {
    const state = this.config.states[this.currentState];
    if (!state) return;
    this.stayTimer += ctx.dt;
    for (const b of state.behaviors) {
      const fn = behaviorTable[b.name];
      fn?.(entity, ctx, b.params ?? {});
    }
    const minStay = state.minStay ?? 0;
    if (this.stayTimer < minStay) return;
    for (const t of state.transitions) {
      const fn = conditionTable[t.cond];
      if (fn?.(entity, ctx, t.params ?? {})) {
        this.currentState = t.to;
        this.stayTimer = 0;
        break;
      }
    }
  }
  reset() {
    this.currentState = this.config.initial;
    this.stayTimer = 0;
  }
  get stateName() {
    return this.currentState;
  }
};

// 全新的游戏/.workbuddy/tmp/2026-09-18_ai-target/ai-probe.ts
function makeEntity(x, z) {
  const pos = { x, y: 0, z };
  return {
    entity: { position: pos, id: 7 },
    aiAttackTimer: 0,
    aiSwingDone: false,
    aiTurnTimer: 0,
    aiMoveDir: { x: 0, z: 0 },
    aiWaypoint: null,
    yawBase: 0,
    position: pos,
    moveBy(dx, dz, dt, speed) {
      const len = Math.hypot(dx, dz) || 1;
      pos.x += dx / len * speed * dt;
      pos.z += dz / len * speed * dt;
    },
    hitAnchorY: () => pos.y + 1
  };
}
var angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) * 180 / Math.PI;
};
function run(ai, playerPath, runSeconds, liveCandidates) {
  const ent = makeEntity(0, 0);
  const sm = new AIStateMachine(ai);
  const shots = [];
  const trace = [];
  const slot = { x: 0, z: 0 };
  let nextTrace = 0;
  const ctx = {
    dt: 1 / 60,
    time: 0,
    target: null,
    findTarget: () => ({ ...playerPath(ctx.time) }),
    targetCandidates: () => {
      const p = playerPath(ctx.time);
      if (liveCandidates) {
        slot.x = p.x;
        slot.z = p.z;
        return [slot];
      }
      return [{ x: p.x, z: p.z }];
    },
    attack: (opts) => {
      const p = playerPath(ctx.time);
      if (opts.type === "projectile") {
        const ang = Math.atan2(opts.dirZ, opts.dirX);
        const trueDeg = Math.atan2(p.z - opts.z, p.x - opts.x);
        shots.push({
          t: ctx.time,
          state: sm.stateName,
          type: opts.type,
          ox: opts.x,
          oz: opts.z,
          angDeg: ang * 180 / Math.PI,
          trueDeg: trueDeg * 180 / Math.PI,
          errDeg: angDiff(ang, trueDeg),
          dist: Math.hypot(p.x - opts.x, p.z - opts.z)
        });
      } else {
        shots.push({
          t: ctx.time,
          state: sm.stateName,
          type: opts.type,
          ox: 0,
          oz: 0,
          angDeg: 0,
          trueDeg: 0,
          errDeg: 0,
          dist: 0
        });
      }
    },
    focusX: 0,
    focusZ: 0,
    focusY: 1
  };
  for (let i = 0; i < runSeconds * 60; i++) {
    ctx.focusX = playerPath(ctx.time).x;
    ctx.focusZ = playerPath(ctx.time).z;
    sm.update(ent, ctx);
    if (ctx.time >= nextTrace) {
      nextTrace += 2;
      const p = playerPath(ctx.time);
      trace.push({
        t: ctx.time,
        state: sm.stateName,
        d: Math.hypot(p.x - ent.position.x, p.z - ent.position.z)
      });
    }
    ctx.time += 1 / 60;
  }
  return { shots: shots.filter((s) => s.type === "projectile"), trace, ent, sm };
}
var P0 = { x: 0, z: 8 };
var P1 = { x: 0, z: -32 };
var path = (t) => t < 6 ? P0 : P1;
function report(label, ai, live) {
  const r = run(ai, path, 14, live);
  console.log(`
=== ${label} | \u5019\u9009=${live ? "\u6D3B\u5BF9\u8C61(\u4FEE\u590D\u540E)" : "\u5750\u6807\u62F7\u8D1D(\u4FEE\u590D\u524D)"} ===`);
  console.log("  \u8F68\u8FF9 " + r.trace.map((x) => `${x.t.toFixed(0)}s:${x.state}@${x.d.toFixed(1)}m`).join("  "));
  console.log(`  \u5F00\u706B ${r.shots.length} \u6B21`);
  const after = r.shots.filter((s) => s.t > 6.2);
  if (after.length === 0) {
    console.log("  \u73A9\u5BB6\u79BB\u5F00\u540E\uFF1A0 \u6B21\u5F00\u706B\uFF08\u6B63\u786E\uFF1A\u8131\u6218\uFF09");
  } else {
    const avgErr = after.reduce((a, s) => a + s.errDeg, 0) / after.length;
    const maxErr = Math.max(...after.map((s) => s.errDeg));
    const far = Math.max(...after.map((s) => s.dist));
    console.log(
      `  \u73A9\u5BB6\u79BB\u5F00\u540E\uFF1A${after.length} \u6B21\u5F00\u706B\uFF0C\u5E73\u5747\u504F\u89D2 ${avgErr.toFixed(1)}\xB0\uFF0C\u6700\u5927 ${maxErr.toFixed(1)}\xB0\uFF0C\u6700\u8FDC\u5728 ${far.toFixed(1)}m \u5904\u5C04\u51FB`
    );
  }
}
report("\u5F29\u624B CROSSBOW_AI", CROSSBOW_AI, false);
report("\u5F29\u624B CROSSBOW_AI", CROSSBOW_AI, true);
report("\u6218\u4E89\u672F\u58EB WAR_CASTER_AI", WAR_CASTER_AI, true);
var TAUNT_R = 40;
function tauntCheck(live) {
  const ent = makeEntity(0, 0);
  const sm = new AIStateMachine(CROSSBOW_AI);
  const seen = [];
  const sentinel = { x: 0, z: 30, radius: TAUNT_R };
  const player = { x: 0, z: 5 };
  const pSlot = { x: 0, z: 0 };
  const sSlot = { x: 0, z: 0, radius: TAUNT_R };
  const ctx = {
    dt: 1 / 60,
    time: 0,
    target: null,
    findTarget: () => ({ ...player }),
    // 候选顺序 = 祖宗 > 玩家（与 WorldMode.enemyTargetCandidates 同形）
    targetCandidates: () => {
      if (live) {
        sSlot.x = sentinel.x;
        sSlot.z = sentinel.z;
        pSlot.x = player.x;
        pSlot.z = player.z;
        return [sSlot, pSlot];
      }
      return [{ x: sentinel.x, z: sentinel.z, radius: TAUNT_R }, { x: player.x, z: player.z }];
    },
    attack: () => void 0,
    focusX: 0,
    focusZ: 0,
    focusY: 1
  };
  for (let i = 0; i < 60 * 6; i++) {
    sm.update(ent, ctx);
    seen.push({ state: sm.stateName, targetX: ctx.target?.x ?? NaN, targetZ: ctx.target?.z ?? NaN });
    ctx.time += 1 / 60;
  }
  return seen;
}
console.log("\n=== \u7956\u5B97\u5632\u8BBD\u4F18\u5148\u7EA7\u56DE\u5F52\uFF08\u5F29\u624B aggro=14m / \u5632\u8BBD\u534A\u5F84=40m\uFF09===");
{
  let fail = 0;
  for (const live of [false, true]) {
    const seen = tauntCheck(live);
    const chased = seen.filter((s) => s.state !== "patrol");
    const onSentinel = chased.length > 0 && chased.every((s) => Math.abs(s.targetZ - 30) < 1e-6);
    const godParent = chased.length === 0;
    console.log(
      `  \u5019\u9009=${live ? "\u6D3B\u5BF9\u8C61" : "\u5750\u6807\u62F7\u8D1D"}\uFF1A\u8FDB\u5165\u8FFD\u51FB ${chased.length} \u5E27\uFF0C\u72B6\u6001 ${[...new Set(seen.map((s) => s.state))].join("/")}\uFF0C\u76EE\u6807 z=${chased.length ? chased[chased.length - 1].targetZ : "(\u672A\u9501)"} \u2192 ${onSentinel ? "\u2713 \u8D8A\u8FC7\u73A9\u5BB6\u8FFD\u7956\u5B97" : godParent ? "\u2605 \u672A\u89E6\u53D1\u7D22\u654C" : "\u2605 \u8FFD\u7684\u662F\u73A9\u5BB6\uFF08\u4F18\u5148\u7EA7\u88AB\u7834\u574F\uFF09"}`
    );
    if (!onSentinel) fail++;
  }
  console.log(fail === 0 ? "  \u2713 \u5632\u8BBD\u4F18\u5148\u7EA7\u4E24\u79CD\u5019\u9009\u4E0B\u90FD\u6210\u7ACB\uFF08\u672C\u6B21\u4FEE\u590D\u672A\u89E6\u78B0\u8BE5\u8BBE\u8BA1\uFF09" : "  \u2605 \u5632\u8BBD\u4F18\u5148\u7EA7\u5F02\u5E38");
  if (fail) process.exitCode = 1;
}
function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = () => {
    s = s * 1664525 + 1013904223 >>> 0;
    return s / 4294967296;
  };
}
function tauntEngage(ai, D, runSeconds = 20) {
  const ent = makeEntity(0, 0);
  const sm = new AIStateMachine(ai);
  const slot = { x: 0, z: D, radius: TAUNT_R };
  let minDist = Infinity;
  let chaseFrames = 0;
  let reachedAtk = false;
  const seen = /* @__PURE__ */ new Set();
  const ctx = {
    dt: 1 / 60,
    time: 0,
    target: null,
    findTarget: () => null,
    // ★ 关掉游走偏向，隔离嘲讽信号
    targetCandidates: () => [slot],
    attack: () => void 0,
    focusX: 0,
    focusZ: D,
    focusY: 1
  };
  for (let i = 0; i < runSeconds * 60; i++) {
    sm.update(ent, ctx);
    seen.add(sm.stateName);
    if (sm.stateName === "chase") chaseFrames++;
    if (sm.stateName === "attack") reachedAtk = true;
    minDist = Math.min(minDist, Math.hypot(ent.position.x - slot.x, ent.position.z - slot.z));
    ctx.time += 1 / 60;
  }
  return { minDist, chaseFrames, reachedAtk, states: [...seen].join("/") };
}
console.log("\n=== \u7956\u5B97\u5632\u8BBD\u300C\u80FD\u5426\u771F\u7684\u54AC\u4F4F\u300D\u626B\u63CF \xB7 \u6BCF\u6863 12 \u4E2A\u79CD\u5B50\u53D6\u5747\u503C\uFF08\u56FA\u5B9A\u79CD\u5B50\uFF0C\u53EF\u590D\u73B0\uFF09===");
console.log("    \u7956\u5B97\u7AD9\u6869\u5728 (0,D)\uFF1B\u5632\u8BBD\u534A\u5F84 40m\uFF1B\u654C\u4EBA\u4ECE (0,0) \u8D77\u3002\u5224\u636E = 20s \u5185\u6709\u6CA1\u6709\u8D34\u4E0A\u53BB\u6253");
{
  const cases = [
    { name: "\u5F29\u624B        ", ai: CROSSBOW_AI, lose: 24 },
    { name: "\u6269\u97F3\u672F\u58EB    ", ai: AMP_CASTER_AI, lose: 26 },
    { name: "\u6218\u4E89\u672F\u58EB    ", ai: WAR_CASTER_AI, lose: 34 },
    { name: "\u6574\u5408\u8FD0\u52A8\u4EBA\u5458", ai: REUNION_AI, lose: 12 }
  ];
  const Ds = [8, 14, 20, 26, 32, 38];
  console.log(`  ${"\u5175\u79CD".padEnd(12)} lose   ${Ds.map((d) => `${d}m`.padStart(11)).join("")}`);
  let firstBad = null;
  for (const c of cases) {
    const cells = [];
    let reported = false;
    for (const D of Ds) {
      let biteCount = 0, sumMin = 0, sumChase = 0;
      const N = 12;
      for (let k = 0; k < N; k++) {
        seedRandom(1e3 + k * 7919);
        const r = tauntEngage(c.ai, D);
        if (r.reachedAtk) biteCount++;
        sumMin += r.minDist;
        sumChase += r.chaseFrames;
      }
      const minAvg = sumMin / N;
      const bite = biteCount / N;
      if (!reported && bite < 0.99) {
        firstBad = { name: c.name.trim(), lose: c.lose, bite };
        reported = true;
      }
      cells.push(
        `${bite >= 0.99 ? "\u54AC\u4F4F" : bite <= 0.01 ? "\u2605\u677E\u53E3" : `${Math.round(bite * 100)}%`}/${minAvg.toFixed(0)}m`.padStart(11)
      );
    }
    console.log(`  ${c.name} ${String(c.lose).padStart(3)}   ${cells.join("")}`);
  }
  console.log("  \u5355\u5143\u683C = \u300C\u8D34\u4E0A\u5E76\u8FDB attack \u7684\u79CD\u5B50\u6BD4\u4F8B / 20s \u5185\u4E0E\u7956\u5B97\u7684\u6700\u8FD1\u8DDD\u79BB\u5747\u503C\u300D");
  console.log("          \u54AC\u4F4F = 12/12 \u90FD\u6253\u5230\u4E86\uFF1B\u2605\u677E\u53E3 = 12/12 \u90FD\u6CA1\u6253\u5230\uFF08\u8BF4\u660E\u88AB loseRadius \u5361\u5728\u95E8\u5916\uFF09");
  if (firstBad) {
    const fb = firstBad;
    console.log(
      `  \u2605 \u9996\u4E2A"\u5F00\u59CB\u54AC\u4E0D\u4F4F"\u7684\u6863\uFF1A${fb.name} loseRadius=${fb.lose}\uFF08\u53EA ${Math.round(fb.bite * 100)}% \u6253\u5230\uFF09 \u2192 \u4E0E loseRadius \u540C\u91CF\u7EA7 \u21D2 \u5632\u8BBD\u534A\u5F84 40m \u662F\u5165\u53E3\uFF0C\u5B9E\u9645\u591F\u4E0D\u591F\u5F97\u7740\u7531\u654C\u4EBA\u81EA\u5DF1\u7684 loseRadius \u51B3\u5B9A`
    );
  }
}
var src = readFileSync(
  new URL("../../../src/modes/WorldMode.ts", import.meta.url),
  "utf8"
);
var start = src.indexOf("private enemyTargetCandidates");
var body = src.slice(start, src.indexOf("\n  }", start));
var pushLiteral = /out\.push\(\s*\{/.test(body);
var pushesSlot = /out\.push\(s\)/.test(body);
console.log("\n=== \u6E90\u7801\u4E0D\u53D8\u91CF\u65AD\u8A00\uFF08WorldMode.enemyTargetCandidates\uFF09===");
console.log(`  \u65B9\u6CD5\u4F53\u957F\u5EA6 ${body.length} \u5B57\u7B26`);
console.log(`  \u63A8\u5165\u5750\u6807\u5B57\u9762\u91CF out.push({ ... }) \uFF1F ${pushLiteral ? "\u2605 \u662F\uFF08\u56DE\u5F52\uFF01\u4F1A\u9000\u5316\u6210\u5FEB\u7167\uFF09" : "\u5426 \u2713"}`);
console.log(`  \u63A8\u5165\u6D3B\u5BF9\u8C61\u69FD out.push(s) \uFF1F        ${pushesSlot ? "\u662F \u2713" : "\u2605 \u5426\uFF08\u672A\u627E\u5230\uFF09"}`);
if (pushLiteral || !pushesSlot) {
  console.error("  \u2717 \u4E0D\u53D8\u91CF\u88AB\u7834\u574F\uFF1A\u5019\u9009\u4E0D\u518D\u662F\u6D3B\u5BF9\u8C61 \u2192 ctx.target \u4F1A\u51BB\u7ED3\u6210\u5750\u6807\u5FEB\u7167");
  process.exitCode = 1;
} else {
  console.log("  \u2713 \u6D3B\u5BF9\u8C61\u4E0D\u53D8\u91CF\u6210\u7ACB");
}

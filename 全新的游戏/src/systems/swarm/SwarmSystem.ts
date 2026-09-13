// ============================================================
// SwarmSystem —— 蜂群调度器（《蜂群架构.md》§5.1/§5.5；P1 数据层）
// ============================================================
// 职责：
//   · 代理池 + 人群网格 + 批量渲染的唯一持有者与驱动者
//   · 分层（L1/L2）决策与移动 tick（降频 + 个体相位抖动）
//   · 升格（近处 → EnemyBase）/ 降格（远处实体 → 代理）/ 远距回收
// P1 说明：暂无流场/攻击槽（P2）；代理用"直线逼近 + 分离 + 坑绕行"，
//   行为与旧远距 AI 的观感一致（远处本来就以追击为主）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { entityPerf } from '../../entity/EntityPerf';
import {
  AgentPool,
  AGENT_TARGET_PLAYER,
  AGENT_TARGET_SHIP,
  AGENT_TIER_FAR,
  AGENT_TIER_MID,
  type AgentSpawnData,
  type AgentSnapshot,
} from './AgentPool';
import { CrowdGrid } from './CrowdGrid';
import { SwarmBatch } from './SwarmBatch';
import { FlowField } from './FlowField';
import { INTENT_PLAYER, INTENT_SHIP, INTENT_FLANK, INTENT_NONE } from './Director';
import type { FrameAssetSource } from '../../services/fx/AssetSource';

/** 分层/回收参数（《蜂群架构.md》§9；集中可调） */
export const SWARM = {
  /** L3 实体层：升格半径 / 实体上限 */
  L3_RADIUS: 35,
  L3_CAP: 30,
  /** L2 代理层半径（L3~L2 = 代理半频） */
  L2_RADIUS: 80,
  /** L1 远群半径（超出即回收） */
  L1_RADIUS: 140,
  /** 降格半径（实体 > 此距离 → 回代理） */
  DEMOTE_RADIUS: 40,
  /** 升格预算（每帧最多几只；防一圈同时升级的尖刺） */
  PROMOTE_PER_FRAME: 2,
  /** 决策频率（Hz）：索引 = tier（1/2） */
  THINK_HZ: [0, 2, 5],
  /** 移动积分频率（Hz）：索引 = tier（1/2） */
  MOVE_HZ: [0, 10, 20],
  /** 近战额外射程余量（米；进入即停下挥击） */
  MELEE_PAD: 0.4,
  /** 攻击冷却区间（秒） */
  ATTACK_CD_MIN: 0.8,
  ATTACK_CD_SPAN: 0.4,
  /** 危险地形（坑）前瞻距离（米；仅非流场方向使用） */
  HAZARD_PROBE: 1.8,

  // ---- P2：流场 / 攻击槽 / 警戒场 ----
  /** 流场重建频率（Hz） */
  FLOW_HZ: 3,
  /** 流场前瞻距离（米；用方向取前瞻点，保证收敛） */
  FLOW_LOOKAHEAD: 8,
  /** 攻击槽：环上扇区数 / 环半径 */
  SLOT_ANGLES: 10,
  SLOT_RADIUS: 1.7,
  /** 距目标多近开始占槽（米） */
  SLOT_COMMIT: 25,
  /** 同一目标同时挥击上限（攻击令牌数） */
  ATTACK_TOKENS: 3,
  /** 令牌/挥击保持窗口（秒） */
  ATTACK_HOLD: 0.3,
  /** P4 士气：低血撤退阈值 / 撤退时长区间 / 撤退冷却 / 狂暴速度倍率与时长 */
  RETREAT_HP_RATIO: 0.3,
  RETREAT_TIME_MIN: 2,
  RETREAT_TIME_SPAN: 2,
  RETREAT_COOLDOWN: 8,
  RAGE_SPEED: 1.25,
  RAGE_SECONDS: 5,
  RAGE_RADIUS: 12,
  /** 警戒场：持续时间 / 反应延迟区间 / 察觉时刷出的半径 / 挥击时刷出的半径 */
  ALERT_SECONDS: 6,
  ALERT_DELAY_MIN: 0.2,
  ALERT_DELAY_SPAN: 1.3,
  ALERT_PAINT_RADIUS: 12,
  ALERT_PAINT_RADIUS_ATTACK: 10,
} as const;

export interface SwarmHooks {
  /** 玩家位置（分层基准 / 索敌） */
  playerX: number;
  playerZ: number;
  /** 舰船位置（第二目标） */
  shipX: number;
  shipZ: number;
  /** 相机画面深处方向（贴图前后帧判定） */
  camForwardX: number;
  camForwardZ: number;
  /** 当前 L3 实体数（升格上限判定） */
  entityCount: number;
  /** 升格：由模式层创建 EnemyBase 并注册 */
  promote: (snap: AgentSnapshot) => void;
  /** 代理近战结算（targetKind：0=玩家 / 1=舰船） */
  melee: (targetKind: number, dmg: number) => void;
  /** 代理被击杀（掉落/遗物击杀统计由模式层结算） */
  onAgentKilled?: (mobIndex: number, x: number, y: number, z: number) => void;
}

const _sep = { x: 0, z: 0 };
const _flow = { x: 0, z: 0 };

export class SwarmSystem {
  readonly pool = new AgentPool();
  private grid = new CrowdGrid();
  private batch: SwarmBatch | null = null;
  /** ★ P2：群体导航流场 + 警戒场（与网格共存） */
  private flow = new FlowField();
  private flowTimer = 0;
  /** ★ P2：攻击槽（每个目标一圈扇区；owner = 代理下标，-1 空） */
  private slotOwner: Int16Array[] = [
    new Int16Array(SWARM.SLOT_ANGLES).fill(-1),
    new Int16Array(SWARM.SLOT_ANGLES).fill(-1),
  ];
  /** ★ P2：攻击令牌计数（每目标同时挥击数） */
  private tokenUsed = [0, 0];

  /** 构建批量渲染（模式层在 mobDefs 就绪后调用；素材顺序 = mobIndex） */
  buildBatch(scene: import('three').Scene, assets: FrameAssetSource[]): void {
    this.batch = new SwarmBatch(scene, assets);
  }

  get count(): number {
    return this.pool.count;
  }

  spawn(data: AgentSpawnData): number {
    return this.pool.push(data);
  }

  /** 降格：实体 → 代理（模式层回收实体时调用） */
  demote(snap: AgentSnapshot): void {
    this.pool.push({
      mobIndex: snap.mobIndex,
      x: snap.x, y: snap.y, z: snap.z,
      hp: snap.hp, maxHp: snap.maxHp,
      defense: snap.defense, attackPower: snap.attackPower,
      speed: snap.speed,
      meleeDamage: snap.meleeDamage, meleeRange: snap.meleeRange,
      scale: snap.scale,
      tier: snap.tier,
      aggro: snap.aggro ?? 8,
      wanderSpeed: snap.wanderSpeed ?? 2,
      intent: 255,
    });
  }

  // ============================================================
  // 每帧驱动（模式层 explore 阶段调用）
  // ============================================================
  update(dt: number, hooks: SwarmHooks): void {
    const t0 = performance.now();
    this.grid.rebuild(this.pool);
    const t1 = performance.now();
    // ★ P2：流场重建（3Hz 或中心移动 > 1 格）——源 = 玩家 + 舰船
    const raster = RasterMap.current;
    this.flowTimer -= dt;
    if (raster && (this.flowTimer <= 0 || this.flow.needsRebuild(hooks.playerX, hooks.playerZ))) {
      this.flowTimer = 1 / SWARM.FLOW_HZ;
      this.flow.rebuild(raster, hooks.playerX, hooks.playerZ, [
        { x: hooks.playerX, z: hooks.playerZ },
        { x: hooks.shipX, z: hooks.shipZ },
      ]);
    }
    const now = performance.now() / 1000;

    let promotes = 0;
    const nearR2 = SWARM.L3_RADIUS * SWARM.L3_RADIUS;
    const l2R2 = SWARM.L2_RADIUS * SWARM.L2_RADIUS;
    const l1R2 = SWARM.L1_RADIUS * SWARM.L1_RADIUS;

    for (let i = this.pool.count - 1; i >= 0; i--) {
      const p = this.pool;
      if (p.hp[i] <= 0) {
        const mobIndex = p.mobIndex[i];
        const kx = p.x[i], ky = p.y[i], kz = p.z[i];
        this.removeAgent(i);
        hooks.onAgentKilled?.(mobIndex, kx, ky, kz);
        continue;
      }
      // ---- 回收（距玩家/舰船都超 L1_RADIUS） ----
      const dpx = p.x[i] - hooks.playerX, dpz = p.z[i] - hooks.playerZ;
      const dsx = p.x[i] - hooks.shipX, dsz = p.z[i] - hooks.shipZ;
      const dFocus2 = dpx * dpx + dpz * dpz;
      const dShip2 = dsx * dsx + dsz * dsz;
      if (Math.min(dFocus2, dShip2) > l1R2) {
        this.removeAgent(i);
        continue;
      }
      // ---- 升格（近玩家 + 实体空位 + 帧预算） ----
      if (dFocus2 < nearR2 && hooks.entityCount + promotes < SWARM.L3_CAP && promotes < SWARM.PROMOTE_PER_FRAME) {
        const snap = p.snapshot(i);
        this.removeAgent(i);
        hooks.promote(snap);
        promotes++;
        continue;
      }
      // ---- 层级 ----
      // ★ P3：受击白闪衰减
      if (p.flash[i] > 0.01) p.flash[i] *= Math.exp(-dt * 6);
      else p.flash[i] = 0;
      const tier = dFocus2 <= l2R2 ? AGENT_TIER_MID : AGENT_TIER_FAR;
      p.tier[i] = tier;
      // ---- 脑 tick（降频 + 个体相位抖动） ----
      p.thinkAcc[i] += dt;
      const thinkGap = 1 / SWARM.THINK_HZ[tier];
      if (p.thinkAcc[i] >= thinkGap * (0.75 + p.phase[i] * 0.5)) {
        p.thinkAcc[i] = 0;
        this.think(i, hooks, now);
      }
      // ---- 移动 tick ----
      p.moveAcc[i] += dt;
      const moveGap = 1 / SWARM.MOVE_HZ[tier];
      if (p.moveAcc[i] >= moveGap) {
        const step = p.moveAcc[i];
        p.moveAcc[i] = 0;
        this.move(i, step);
      }
    }
    const t2 = performance.now();
    entityPerf.swarmBrain += t2 - t1;
    entityPerf.swarmAgents = this.pool.count;
    void t0;
  }

  /** 渲染同步（每帧调用；代理位置/贴图批次 → InstancedMesh） */
  syncRender(): void {
    if (!this.batch) return;
    const t0 = performance.now();
    const raster = RasterMap.current;
    this.batch.sync(this.pool, (x, z) => raster?.surfaceHeightAt(x, z) ?? 0);
    entityPerf.swarmRender += performance.now() - t0;
  }

  // ============================================================
  // 代理行为（P2：流场导航 + 攻击槽 + 攻击令牌 + 警戒场）
  // ============================================================
  private think(i: number, hooks: SwarmHooks, now: number): void {
    const p = this.pool;
    const px = p.x[i], pz = p.z[i];
    const dpx = hooks.playerX - px, dpz = hooks.playerZ - pz;
    const dsx = hooks.shipX - px, dsz = hooks.shipZ - pz;
    const dP2 = dpx * dpx + dpz * dpz;
    const dS2 = dsx * dsx + dsz * dsz;
    // ★ P4：意图优先（导演分工）；无意图 = 就近（旧观感）
    const intent = p.intent[i];
    let tk: number;
    if (intent === INTENT_SHIP) tk = dS2 <= 150 * 150 ? AGENT_TARGET_SHIP : AGENT_TARGET_PLAYER;
    else if (intent === INTENT_PLAYER || intent === INTENT_FLANK) tk = dP2 <= 150 * 150 ? AGENT_TARGET_PLAYER : AGENT_TARGET_SHIP;
    else tk = dP2 <= dS2 ? AGENT_TARGET_PLAYER : AGENT_TARGET_SHIP;
    p.targetKind[i] = tk;
    const gx = tk === AGENT_TARGET_PLAYER ? hooks.playerX : hooks.shipX;
    const gz = tk === AGENT_TARGET_PLAYER ? hooks.playerZ : hooks.shipZ;
    const tx = gx - px, tz = gz - pz;
    const d = Math.hypot(tx, tz);
    const tick = 1 / SWARM.THINK_HZ[p.tier[i]];

    // ---- 警戒场：共享感知 + 个体反应延迟（被同伴/玩家开火刷到 → 延迟后察觉） ----
    const alerted = this.flow.isAlerted(px, pz, now);
    if (alerted) {
      if (p.alertAt[i] <= 0) {
        p.alertAt[i] = now + SWARM.ALERT_DELAY_MIN + Math.random() * SWARM.ALERT_DELAY_SPAN;
      }
    } else {
      p.alertAt[i] = 0;
    }
    const aware = alerted && now >= p.alertAt[i];
    const objective = intent !== INTENT_NONE;
    const chasing = objective || d <= p.aggro[i] || aware;

    // ---- 攻击冷却 / 令牌释放 ----
    p.attackCd[i] -= tick;
    if (p.attackHold[i] > 0) {
      p.attackHold[i] -= tick;
      if (p.attackHold[i] <= 0 && p.hasToken[i]) {
        p.hasToken[i] = 0;
        const tt = p.tokenTarget[i];
        this.tokenUsed[tt] = Math.max(0, this.tokenUsed[tt] - 1);
      }
    }

    // ---- P4：士气（低血撤退；同伴阵亡由 WorldMode 触发狂暴） ----
    if (objective && d < 20 && now >= p.nextRetreatAt[i] && p.hp[i] < p.maxHp[i] * SWARM.RETREAT_HP_RATIO) {
      p.retreatUntil[i] = now + SWARM.RETREAT_TIME_MIN + Math.random() * SWARM.RETREAT_TIME_SPAN;
      p.nextRetreatAt[i] = now + SWARM.RETREAT_COOLDOWN;
    }
    const retreating = p.retreatUntil[i] > now;

    if (!chasing || d < 1e-4) {
      // 圈外：家附近游走（轻微偏向目标）+ 释放槽/令牌
      this.releaseSlot(i);
      p.curSpeed[i] = p.wanderSpeed[i];
      p.fromFlow[i] = 0;
      p.wanderTimer[i] -= tick;
      if (p.wanderTimer[i] <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 6;
        p.wanderX[i] = p.homeX[i] + Math.cos(a) * r;
        p.wanderZ[i] = p.homeZ[i] + Math.sin(a) * r;
        p.wanderTimer[i] = 2 + Math.random() * 3;
      }
      const wdx = p.wanderX[i] - px, wdz = p.wanderZ[i] - pz;
      const wd = Math.hypot(wdx, wdz);
      const bx = wd > 1e-3 ? wdx / wd : 0, bz = wd > 1e-3 ? wdz / wd : 0;
      const bias = 0.12;
      const mx = bx + (d > 1e-4 ? (tx / d) * bias : 0);
      const mz = bz + (d > 1e-4 ? (tz / d) * bias : 0);
      const ml = Math.hypot(mx, mz);
      p.dirX[i] = ml > 1e-4 ? mx / ml : 0;
      p.dirZ[i] = ml > 1e-4 ? mz / ml : 0;
    } else if (retreating) {
      // 低血撤离：背向目标撤（不攻击；释放槽/令牌让给同伴）
      this.releaseSlot(i);
      if (p.hasToken[i]) {
        p.hasToken[i] = 0;
        this.tokenUsed[p.tokenTarget[i]] = Math.max(0, this.tokenUsed[p.tokenTarget[i]] - 1);
      }
      p.curSpeed[i] = p.wanderSpeed[i];
      p.fromFlow[i] = 0;
      const bx = d > 1e-4 ? -tx / d : 0;
      const bz = d > 1e-4 ? -tz / d : 0;
      // 侧向偏移避免笔直倒退成一列
      const side = p.phase[i] < 0.5 ? 1 : -1;
      const mx = bx - bz * 0.35 * side;
      const mz = bz + bx * 0.35 * side;
      const ml = Math.hypot(mx, mz);
      p.dirX[i] = ml > 1e-4 ? mx / ml : bx;
      p.dirZ[i] = ml > 1e-4 ? mz / ml : bz;
    } else {
      // 察觉/进入仇恨 → 刷警戒（同伴延迟响应）
      if (aware) this.flow.paintAlert(px, pz, SWARM.ALERT_PAINT_RADIUS, now, SWARM.ALERT_SECONDS);
      p.curSpeed[i] = p.speed[i] * (p.rageUntil[i] > now ? SWARM.RAGE_SPEED : 1);
      // 目标点：近距占攻击槽（环形包围），远距走流场
      let destX = gx, destZ = gz;
      if (d <= SWARM.SLOT_COMMIT) {
        if (p.slotIdx[i] < 0) p.slotIdx[i] = this.claimSlot(i, tk, gx, gz, px, pz);
        const s = p.slotIdx[i];
        if (s >= 0) {
          const a = (s / SWARM.SLOT_ANGLES) * Math.PI * 2;
          destX = gx + Math.cos(a) * SWARM.SLOT_RADIUS;
          destZ = gz + Math.sin(a) * SWARM.SLOT_RADIUS;
        }
        p.fromFlow[i] = 0;
      } else {
        if (p.slotIdx[i] >= 0) this.releaseSlot(i);
        p.fromFlow[i] = this.flow.dirAt(px, pz, _flow) ? 1 : 0;
        if (p.fromFlow[i]) {
          destX = px + _flow.x * SWARM.FLOW_LOOKAHEAD;
          destZ = pz + _flow.z * SWARM.FLOW_LOOKAHEAD;
        }
      }
      const mx = destX - px, mz = destZ - pz;
      const md = Math.hypot(mx, mz);
      if (md > 0.05) {
        p.dirX[i] = mx / md;
        p.dirZ[i] = mz / md;
      } else {
        p.dirX[i] = 0;
        p.dirZ[i] = 0;
      }
      // 进射程：停步 + 令牌攻击（同目标同时挥击上限）
      if (d <= p.meleeRange[i] + SWARM.MELEE_PAD) {
        p.dirX[i] = 0;
        p.dirZ[i] = 0;
        if (p.attackHold[i] <= 0 && p.attackCd[i] <= 0 && this.tokenUsed[tk] < SWARM.ATTACK_TOKENS) {
          p.attackCd[i] = SWARM.ATTACK_CD_MIN + Math.random() * SWARM.ATTACK_CD_SPAN;
          p.hasToken[i] = 1;
          p.tokenTarget[i] = tk;
          this.tokenUsed[tk]++;
          p.attackHold[i] = SWARM.ATTACK_HOLD;
          hooks.melee(tk, p.meleeDamage[i] + p.attackPower[i]);
          this.flow.paintAlert(px, pz, SWARM.ALERT_PAINT_RADIUS_ATTACK, now, SWARM.ALERT_SECONDS);
        }
      }
    }

    // 贴图前后帧：远离相机 = 背对（'后'）
    const dot = p.dirX[i] * hooks.camForwardX + p.dirZ[i] * hooks.camForwardZ;
    p.facingBack[i] = dot > 0.25 ? 1 : 0;
  }

  /** 移动积分（流场方向跳过坑探测；非流场方向保留单点避坑 + 人群分离） */
  private move(i: number, dt: number): void {
    const p = this.pool;
    let dx = p.dirX[i], dz = p.dirZ[i];
    if (dx !== 0 || dz !== 0) {
      if (!p.fromFlow[i]) {
        // ---- 危险地形（坑）绕行：前瞻探测 → 转向 ±90°，缓存 0.4s ----
        p.hazardTimer[i] -= dt;
        const raster = RasterMap.current;
        const probe = SWARM.HAZARD_PROBE;
        const danger = (ux: number, uz: number): boolean => {
          if (!raster) return false;
          const hx = p.x[i] + ux * probe, hz = p.z[i] + uz * probe;
          return raster.tileDefAt(hx, hz).genRole === 'pit' && (raster.surfaceHeightAt(hx, hz) < -1.2);
        };
        if (danger(dx, dz)) {
          if (p.hazardTimer[i] <= 0) {
            const a = Math.atan2(dz, dx) + (p.phase[i] < 0.5 ? Math.PI / 2 : -Math.PI / 2);
            p.safeDirX[i] = Math.cos(a);
            p.safeDirZ[i] = Math.sin(a);
            p.hazardTimer[i] = 0.4;
          }
          dx = p.safeDirX[i];
          dz = p.safeDirZ[i];
        }
      }
      const sp = p.curSpeed[i] * dt;
      p.x[i] += dx * sp;
      p.z[i] += dz * sp;
      if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) p.yaw[i] = Math.atan2(dx, dz);
    }
    // ---- 人群分离（网格 3×3 邻域） ----
    const t0 = performance.now();
    this.grid.separation(p, i, _sep);
    entityPerf.swarmSep += performance.now() - t0;
    if (_sep.x !== 0 || _sep.z !== 0) {
      p.x[i] += _sep.x;
      p.z[i] += _sep.z;
    }
  }

  // ============================================================
  // 攻击槽 / 移除清理
  // ============================================================

  /** 占槽：取离自己最近的空扇区（无空位 → -1，直走目标） */
  private claimSlot(i: number, tk: number, gx: number, gz: number, px: number, pz: number): number {
    const owners = this.slotOwner[tk];
    if (!owners) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let s = 0; s < owners.length; s++) {
      if (owners[s] !== -1) continue;
      const a = (s / SWARM.SLOT_ANGLES) * Math.PI * 2;
      const sx = gx + Math.cos(a) * SWARM.SLOT_RADIUS;
      const sz = gz + Math.sin(a) * SWARM.SLOT_RADIUS;
      const d = Math.hypot(sx - px, sz - pz);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best >= 0) owners[best] = i;
    return best;
  }

  private releaseSlot(i: number): void {
    const p = this.pool;
    const s = p.slotIdx[i];
    if (s < 0) return;
    // 目标可能已切换 → 两个目标数组都扫（10×2，可忽略）
    for (const owners of this.slotOwner) {
      if (owners[s] === i) owners[s] = -1;
    }
    p.slotIdx[i] = -1;
  }

  /** 释放代理的槽位与令牌（移除/降格前调用） */
  private releaseAgent(i: number): void {
    const p = this.pool;
    this.releaseSlot(i);
    if (p.hasToken[i]) {
      p.hasToken[i] = 0;
      const tk = p.tokenTarget[i];
      this.tokenUsed[tk] = Math.max(0, this.tokenUsed[tk] - 1);
    }
    p.attackHold[i] = 0;
  }

  /** swap-remove 包装：释放槽/令牌 + 修正槽主索引（尾元素 → 空出的下标） */
  private removeAgent(i: number): void {
    const last = this.pool.count - 1;
    this.releaseAgent(i);
    if (i !== last) {
      for (const owners of this.slotOwner) {
        for (let s = 0; s < owners.length; s++) {
          if (owners[s] === last) owners[s] = i;
        }
      }
    }
    this.pool.removeAt(i);
  }

  // ============================================================
  // 对外：子弹命中 / 承伤 / 警戒（P2）
  // ============================================================

  /** 子弹线段命中代理（返回代理下标；-1 = 未命中） */
  hitTestSegment(x0: number, z0: number, x1: number, z1: number, r: number): number {
    if (this.pool.count === 0) return -1;
    return this.grid.segmentHit(this.pool, x0, z0, x1, z1, r);
  }

  /** 代理承伤（防御减法 + 取整，与实体伤害管线同口径；死亡在下一帧 update 顶部结算） */
  damageAgent(i: number, base: number): number {
    const raw = base - this.pool.defense[i];
    const final = raw > 0 ? Math.max(1, Math.round(raw)) : 0;
    if (final > 0) {
      this.pool.hp[i] -= final;
      this.pool.flash[i] = 1; // ★ P3：受击白闪
    }
    return final;
  }

  /** 代理坐标（伤害数字/击杀表现） */
  agentX(i: number): number { return this.pool.x[i]; }
  agentY(i: number): number { return this.pool.y[i]; }
  agentZ(i: number): number { return this.pool.z[i]; }

  /** ★ P4 狂暴（同伴阵亡：附近代理短时加速，冲上去拼命） */
  enrageAt(x: number, z: number, radius: number, seconds: number): void {
    const now = performance.now() / 1000;
    const r2 = radius * radius;
    const p = this.pool;
    for (let i = 0; i < p.count; i++) {
      const dx = p.x[i] - x, dz = p.z[i] - z;
      if (dx * dx + dz * dz <= r2) {
        p.rageUntil[i] = Math.max(p.rageUntil[i], now + seconds);
      }
    }
  }

  /** 刷警戒（玩家开火 / 爆炸等；共享感知入口） */
  alertAt(x: number, z: number, radius: number, seconds: number): void {
    this.flow.paintAlert(x, z, radius, performance.now() / 1000, seconds);
  }

  /** 调试/统计：层级计数 */
  tierCounts(): { far: number; mid: number } {
    let far = 0, mid = 0;
    for (let i = 0; i < this.pool.count; i++) {
      if (this.pool.tier[i] === AGENT_TIER_FAR) far++;
      else mid++;
    }
    return { far, mid };
  }

  clear(): void {
    this.pool.clear();
  }

  dispose(): void {
    this.pool.clear();
    this.batch?.dispose();
    this.batch = null;
  }
}

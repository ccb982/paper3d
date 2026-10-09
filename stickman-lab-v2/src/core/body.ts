/**
 * body.ts —— 骨架装配：每个自由度 = 一个真实引擎铰链（revolute）
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 为什么把球窝关节拆成 3×revolute 串联（实测依据，不是偏好）
 * ══════════════════════════════════════════════════════════════════════════
 * · Rapier 0.14 的**原生球铰 / generic(3 转动)** 在非零锚点下第一帧就注入角速度：
 *   零重力/零力矩/零初速，1 秒后 Σ|Δθ| = 44.3°，峰值 53.9 rad/s（本仓库实测）。
 *   这正是 v1 "静息漂移 454°" 的根因。单轴 revolute 在同样条件下 0.0000。
 * · 拆成串联铰链后每个自由度都是引擎原生 revolute：
 *   有**引擎级角度限位**（求解器直接管，不需要 v1 的自研限位冲量）、
 *   有确定的读数、可独立施加力矩 —— 即 URDF/机器人学标准的**关节空间**骨架
 *   （Featherstone & Orin 2000）。
 * · 起姿态用相对旋转的内旋 XYZ Euler 分解（quat.ts qEulerXYZ）：
 *   三个 sub-铰链**出生即零点**，不注入能量（本仓库实测 0.000°）。
 *
 * 人形关节链：X(外展/侧摆) → Y(扭转) → Z(屈伸)，与骨架 JOINT_AXIS 语义一致。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 柔性足（用户令：不许动）
 * ══════════════════════════════════════════════════════════════════════════
 * `arch_*` / `mfoot_*` 原样保留 v1 装配：revolute（绕足长轴）+ 引擎限位 +
 * `MotorModel.ForceBased` 的 `configureMotorPosition(0, 400, 12)` 隐式弹簧。
 * 它们登记为 `engineMotor`，Drive 层不写力矩（两条路径抢同一根轴会把柔性足焊死）。
 */

import RAPIER from '@dimforge/rapier3d';
import type { Skeleton, BodyDef, JointDef } from './skeleton';
import { restQuatOf } from './skeleton';
import { qAxisAngle, qConj, qEulerXYZ, qFromRotVec, qInvRotateVec, qMul, qOf, qRel, qRotateVec, qSignedAngle, qToRotVec, swingTwistY, type Quat, type Vec3 } from './quat';
import { Executor, type DofDef } from './executor';

// 碰撞分组：角色刚体只碰地面、不碰自己（v1 同款；侧翻/抖动的一大来源就是自碰撞）
const MEM_GROUND = 0x0001;
const MEM_SELF = 0x0002;
const GROUPS_SELF = ((MEM_SELF << 16) | MEM_GROUND) >>> 0;
const GROUPS_GROUND = ((MEM_GROUND << 16) | MEM_SELF) >>> 0;

export interface BodyOptions {
  /** 地面摩擦（v1 默认 10.0 = 大摩擦模式） */
  groundFriction: number;
  /** 角色碰撞体摩擦 */
  bodyFriction: number;
  /** 线性阻尼（0 = 不额外阻尼） */
  linearDamping: number;
  /** 全局角阻尼（脚除外） */
  angularDamping: number;
  /** 脚掌刚体专用角阻尼（v1 默认 30，防脚部接触抽动） */
  footAngularDamping: number;
  /** 求解器迭代（v1 用 16：串联铰链在 16 下锚点才够硬） */
  solverIterations: number;
  /** 附加摩擦迭代 */
  frictionIterations: number;
  /** 中间体质量（kg）：3×revolute 串联的运动学节点 */
  gimbalMidMass: number;
  /** 中间体惯量（kg·m²）：不能为 0（病态），也不能大（喧宾夺主） */
  gimbalMidInertia: number;
  /**
   * 中间体的**额外求解器迭代**（Rapier per-body `additionalSolverIterations`）。
   *
   * 为什么需要：中间体 1e-3 kg vs 主体 70 kg ⇒ 质量比 7e4:1，重力/接触载荷
   * 下求解器一步解不出来 ⇒ 残差累积 → 关节速度指数发散（实测 ω 从 44 → 27610）。
   * 提高全局迭代没用（解算预算花在所有约束上），给**轻体所在约束**加迭代才对症。
   */
  gimbalMidExtraIters: number;
  /** 柔性足被动弓刚度 / 阻尼（N·m/rad、N·m·s/rad；v1 实测值 400 / 12） */
  archStiffness: number;
  archDamping: number;
  /**
   * 3 自由度关节的构造方式：
   *   · `native`：Rapier 原生球铰（3 转动自由，同轴心约束；实测：关自碰撞后
   *     零重力零力矩 720 拍 Σ|Δθ| = 0.0000）。**无引擎限位** ⇒ 限位走 Drive 通道。
   *   · `gimbal`：3×revolute 串联（有引擎限位），但中间体 1e-3 kg 在 70 kg
   *     载荷下质量比 7e4:1 ⇒ 求解器在重力/接触下发散（实测 ω 到 27610 rad/s）。
   *     ★ 默认 `native`：稳定性优先；限位由 `Drive` 的 limit 通道承担。
   */
  sphericalMode: 'native' | 'gimbal';
}

export const DEFAULT_BODY_OPTIONS: BodyOptions = {
  groundFriction: 10.0,
  bodyFriction: 0.9,
  linearDamping: 0.0,
  angularDamping: 0.04,
  footAngularDamping: 30,
  solverIterations: 16,
  frictionIterations: 8,
  gimbalMidMass: 1e-3,
  gimbalMidInertia: 1e-6,
  gimbalMidExtraIters: 32,
  archStiffness: 220,
  archDamping: 40,
  sphericalMode: 'native',
};

/** 一个真实自由度（= 一个引擎铰链） */
export interface Dof extends DofDef {
  dofIndex: number;
  /** 出生角（控制角 = 实测角 − rest；engine 限位 = rest + [min,max]） */
  rest: number;
  /** 控制限位（相对 rest，rad） */
  min: number;
  max: number;
  /** b1 上的锚点（本地），用于有效惯量的力臂 */
  anchorB1Local: Vec3;
  /** 该自由度是否由**引擎铰链限位**（revolute 的 setLimits）；球铰为 false ⇒ 走 Drive 限位通道 */
  engineLimited: boolean;
  /** 限位通道每步冲量上限（N·m·s；由 Drive 每步按 τmax 与 dt 推导） */
  impulseMax: number;
  /** 该自由度是否由引擎电机（柔性足）驱动 ⇒ Drive 跳过 */
  engineMotor: boolean;
  /** 引擎铰链句柄 */
  engineJoint?: RAPIER.RevoluteImpulseJoint;
  // ── 每步刷新的运行态 ──
  angle: number;
  vel: number;
  /** 有效惯量（折合到该轴；冲量→Δω 的换算） */
  inertia: number;
  /** 轴/锚点的世界坐标（每步 updateDofState 刷新；重力补偿与雅可比复用） */
  axisWorld: Float64Array;
  anchorWorld: Float64Array;
  /**
   * 阻尼用**严格下界惯量** = 子刚体单体的锚点轴惯量（含平行轴）。
   *
   * 为什么不能用上面的 `inertia`（刚性子树 + 父侧并联）做隐式阻尼：
   *   它是**上界**（远端关节实际是自由的，链会折叠 ⇒ 真实铰接惯量更小）。
   *   隐式阻尼 `J = I·ω·(1−e^…)` 若 I 高估 ⇒ 实际 Δω 过冲 ⇒ 阻尼变负阻尼
   *   ⇒ 泵能量（实测：仅阻尼模式 ω 从 0 → 300 持续不衰减；仅弹簧模式稳定）。
   *   下界的推导：相对运动单位角速度下，子刚体至少以绕锚点轴的角速度转动
   *   ⇒ E ≥ ½·I_child(anchor)·ω² ⇒ I_true ≥ I_child(anchor)。
   */
  inertiaLow: number;
}

interface BodyRuntime {
  /** 原始刚体（= sk.bodies 一一对应，渲染/语义用） */
  bodies: RAPIER.RigidBody[];
  /** 全部刚体（原始 + 串联中间体），Executor 的施加对象 */
  allBodies: RAPIER.RigidBody[];
  /** 逻辑关节 i → [父, 子] 原始刚体下标 */
  jointBodies: Int32Array;
  /** 逻辑关节 i → 该关节的 3 个自由度下标；revolute 非自由轴 = −1 */
  dofIndex: Int32Array;
  /** 逻辑关节 i 的子端**原始刚体**子树（含自己），用于有效惯量 */
  subtree: number[][];
}

export class Body implements BodyRuntime {
  readonly sk: Skeleton;
  readonly opt: BodyOptions;
  readonly world: RAPIER.World;
  readonly bodies: RAPIER.RigidBody[] = [];
  readonly allBodies: RAPIER.RigidBody[] = [];
  /** 每个原始刚体的 collider 列表（接触力回读用） */
  readonly collidersByBody: RAPIER.Collider[][] = [];
  readonly indexByKey = new Map<string, number>();
  readonly jointBodies: Int32Array;
  readonly dofIndex: Int32Array;
  readonly dofs: Dof[] = [];
  readonly executor: Executor;
  readonly subtree: number[][];
  /** ★ 性能：惯性估计缓存（每 4 步重算一次；cap/damping 用，1 步级滞后无关紧要） */
  private inertiaTick = 0;
  /** ★ 性能：子树成员戳（替代每步 new Set 分配） */
  private subStamp = new Int32Array(0);
  private subGen = 0;
  /** 该逻辑关节是否由引擎电机驱动（柔性足） */
  readonly motorDriven: boolean[] = [];
  /** 串联中间体的出生位姿（reset 用；与创建顺序一一对应） */
  private readonly midSpawns: { pos: { x: number; y: number; z: number }; q: Quat }[] = [];
  /** swing-twist 输出暂存 */
  private readonly stTmp = new Float64Array(3);
  /** footCoP 的接触点世界坐标暂存 */
  private readonly copWorldBuf = new Float64Array(3);

  constructor(world: RAPIER.World, sk: Skeleton, opt: BodyOptions = DEFAULT_BODY_OPTIONS) {
    this.world = world;
    this.sk = sk;
    this.opt = opt;
    this.jointBodies = new Int32Array(sk.joints.length * 2);
    this.dofIndex = new Int32Array(sk.joints.length * 3).fill(-1);
    this.createGround();
    this.createBodies();
    this.createJoints();
    this.subtree = this.buildSubtrees();
    this.executor = new Executor(this.allBodies, this.dofs);
  }

  // ────────────────────────────────────────────────────────────────
  private createGround(): void {
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(60, 0.5, 12)
        .setTranslation(0, -0.5, 0)
        .setFriction(this.opt.groundFriction)
        .setCollisionGroups(GROUPS_GROUND),
      rb,
    );
  }

  private createBodies(): void {
    this.sk.bodies.forEach((b: BodyDef, i: number) => {
      this.indexByKey.set(b.key, i);
      const q = this.restQuatOfBody(b);
      const isFoot = /^foot_/.test(b.key);
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(b.cx, b.cy, b.cz)
          .setRotation(q)
          .setCanSleep(false)
          .setLinearDamping(this.opt.linearDamping)
          .setAngularDamping(isFoot ? this.opt.footAngularDamping : this.opt.angularDamping),
      );
      const cols: RAPIER.Collider[] = [];
      for (const c of b.colliders) {
        const desc = c.shape === 'capsule'
          ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
          : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
        desc
          .setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
          // ★ 必须用 setMassProperties（骨架已按素材算好质心/惯量），
          //   用 setMass 会让 Rapier 按几何重算惯量 ⇒ 小刚体 1/I 爆炸。
          .setMassProperties(
            c.mass,
            { x: 0, y: c.comY, z: 0 },
            { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ },
            { x: 0, y: 0, z: 0, w: 1 },
          )
          .setFriction(this.opt.bodyFriction)
          .setRestitution(0)
          .setCollisionGroups(GROUPS_SELF);
        cols.push(this.world.createCollider(desc, rb));
      }
      this.collidersByBody.push(cols);
      this.bodies.push(rb);
      this.allBodies.push(rb);
    });
  }

  /** 骨架静姿态四元数 → Rapier 格式（restQuatOf 返回 [x,y,z,w] 数组） */
  private restQuatOfBody(b: BodyDef): { x: number; y: number; z: number; w: number } {
    const q = restQuatOf(b.restTiltRad, b.restYawRad);
    return { x: q[0], y: q[1], z: q[2], w: q[3] };
  }

  private createJoints(): void {
    const sk = this.sk;
    sk.joints.forEach((j: JointDef, i: number) => {
      const pi = this.indexByKey.get(j.parentKey);
      const ci = this.indexByKey.get(j.childKey);
      if (pi === undefined || ci === undefined) throw new Error(`[body] 关节 ${j.name} 的刚体不存在`);
      this.jointBodies[i * 2] = pi;
      this.jointBodies[i * 2 + 1] = ci;

      const parent = this.bodies[pi]!;
      const child = this.bodies[ci]!;
      const isEngineMotor = j.name.startsWith('arch_') || j.name.startsWith('mfoot_');
      this.motorDriven[i] = isEngineMotor;

      const parentLocal: Vec3 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
      const childLocal: Vec3 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
      const qP = qOf(parent.rotation());
      const qC = qOf(child.rotation());

      // 锚点世界点（父子必须一致；不一致说明骨架数据坏了）
      const aw = new Float64Array(3);
      qRotateVec(qP, parentLocal.x, parentLocal.y, parentLocal.z, aw);

      if (j.revoluteAxis) {
        // ── revolute（踝/膝 opt/弓/中足）──
        //
        // ★★ 关键修正（实测）：revolute 会**锁死另外两轴**，所以父子静姿态
        //   必须"只差一个绕自由轴的旋转"。小腿偏航归零后（skeleton.ts:1781）
        //   脚掌仍带 ±25° 外八 ⇒ 踝的锁定轴出生就歪 25° ⇒ 求解器第 1 拍强行
        //   扭转脚掌，柔性足链（0.1kg 级小刚体）把修正放大成 28 rad/s 尖峰
        //   （隔离实验：只髋+膝 0.000；只踝+柔性足 28.3）。
        //   ⇒ 凡是"离轴"的 revolute，前面加一个**预环**吸收离轴分量：
        //        P —revolute(r, φ0)— mid(≡子静姿态) —revolute(自由轴)— C
        //      预环对应骨架里与 r 最接近的逻辑轴（踝 ⇒ 轴1 扭转，限位 ±10°）。
        const idx = freeAxisOf(j);
        const ax = j.revoluteAxis;
        const qRelPC = qRel(qP, qC);
        const rv = new Float64Array(3);
        qToRotVec(qRelPC, rv);
        const u = { x: ax[0], y: ax[1], z: ax[2] };
        const uLen = Math.hypot(u.x, u.y, u.z) || 1;
        const along = (rv[0]! * u.x + rv[1]! * u.y + rv[2]! * u.z) / uLen;
        const off = Math.hypot(rv[0]! - (along * u.x) / uLen, rv[1]! - (along * u.y) / uLen, rv[2]! - (along * u.z) / uLen);

        if (off < 1e-4) {
          // 单环：离轴残差可忽略
          const phi = qSignedAngle(qRelPC, u.x, u.y, u.z);
          const joint = this.world.createImpulseJoint(
            RAPIER.JointData.revolute(parentLocal, childLocal, { x: ax[0], y: ax[1], z: ax[2] }),
            parent, child, true,
          ) as RAPIER.RevoluteImpulseJoint;
          joint.setLimits(phi + j.minRad[idx]!, phi + j.maxRad[idx]!);
          if (isEngineMotor) {
            joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
            joint.configureMotorPosition(0, this.opt.archStiffness, this.opt.archDamping);
          }
          const dof: Dof = {
            dofIndex: this.dofs.length,
            joint: i, name: j.name, axis: idx,
            b1: pi, b2: ci,
            applyB1: pi, applyB2: ci,
            axisLocal: { x: ax[0], y: ax[1], z: ax[2] },
            tauMax: j.maxTorque[idx] ?? 0,
            rest: phi,
            min: j.minRad[idx]!, max: j.maxRad[idx]!,
            anchorB1Local: { x: aw[0]!, y: aw[1]!, z: aw[2]! },
            engineLimited: true,
            impulseMax: 0,
            engineMotor: isEngineMotor,
            engineJoint: joint,
            angle: 0, vel: 0, inertia: 0, inertiaLow: 0, axisWorld: new Float64Array(3), anchorWorld: new Float64Array(3),
          };
          this.dofs.push(dof);
          this.dofIndex[i * 3 + idx] = dof.dofIndex;
        } else {
          // ── 多环链：预环吸收 rest + 其余逻辑轴环 + 主环 ──
          //
          // 踝 = Y(预环，外八静态偏置) → X(内外翻 ±14°) → Z(屈伸 −12°…+18°)
          // 三个自由度全部可控 —— 侧向 CoP 权限就来自内外翻（没有它，
          // 平衡控制器在侧向只能干瞪眼：实测指令 −218N 实际给不出来而倒地）。
          // 柔性足（arch/mfoot）不在此分支（它们 q_rel≈identity，走单环）。
          const mag = Math.hypot(rv[0]!, rv[1]!, rv[2]!);
          const r = { x: rv[0]! / mag, y: rv[1]! / mag, z: rv[2]! / mag };
          let preK = 0, best = 0;
          for (let k = 0; k < 3; k++) {
            const ek = k === 0 ? { x: 1, y: 0, z: 0 } : k === 1 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
            const d = Math.abs(r.x * ek.x + r.y * ek.y + r.z * ek.z);
            if (d > best) { best = d; preK = k; }
          }
          const ekOf = (k: number): Vec3 => k === 0 ? { x: 1, y: 0, z: 0 } : k === 1 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
          const chain: { axis: Vec3; logical: number; rest: number }[] = [
            { axis: r, logical: preK, rest: mag },
          ];
          for (const k of [0, 1, 2]) {
            if (k !== preK && k !== idx) chain.push({ axis: ekOf(k), logical: k, rest: 0 });
          }
          chain.push({ axis: { x: ax[0], y: ax[1], z: ax[2] }, logical: idx, rest: 0 });

          const tP = parent.translation();
          const posW = { x: tP.x + aw[0]!, y: tP.y + aw[1]!, z: tP.z + aw[2]! };
          const zero: Vec3 = { x: 0, y: 0, z: 0 };
          let prevBody = parent;
          let prevB = pi;
          let prevAnchor = parentLocal;
          for (let n = 0; n < chain.length; n++) {
            const ring = chain[n]!;
            const last = n === chain.length - 1;
            let nextBody: RAPIER.RigidBody;
            let nextB: number;
            let nextAnchor: Vec3;
            if (last) {
              nextBody = child; nextB = ci; nextAnchor = childLocal;
            } else {
              nextBody = this.createMid(qC, posW);
              nextB = this.allBodies.length - 1;
              nextAnchor = zero;
            }
            const joint = this.world.createImpulseJoint(
              RAPIER.JointData.revolute(prevAnchor, nextAnchor, ring.axis), prevBody, nextBody, true,
            ) as RAPIER.RevoluteImpulseJoint;
            joint.setLimits(ring.rest + j.minRad[ring.logical]!, ring.rest + j.maxRad[ring.logical]!);
            const dof: Dof = {
              dofIndex: this.dofs.length,
              joint: i, name: j.name, axis: ring.logical,
              b1: prevB, b2: nextB,
              applyB1: pi, applyB2: ci,
              axisLocal: ring.axis,
              tauMax: j.maxTorque[ring.logical] ?? 0,
              rest: ring.rest,
              min: j.minRad[ring.logical]!, max: j.maxRad[ring.logical]!,
              anchorB1Local: prevAnchor,
              engineLimited: true,
              impulseMax: 0,
              engineMotor: false,
              engineJoint: joint,
              angle: 0, vel: 0, inertia: 0, inertiaLow: 0, axisWorld: new Float64Array(3), anchorWorld: new Float64Array(3),
            };
            this.dofs.push(dof);
            this.dofIndex[i * 3 + ring.logical] = dof.dofIndex;
            prevBody = nextBody; prevB = nextB; prevAnchor = zero;
          }
        }
      } else if (this.opt.sphericalMode === 'gimbal') {
        // ── 球窝 → 3×revolute 串联（X→Y→Z 内旋），出生即零点 ──
        const qRelPC = qRel(qP, qC);
        const [p1, p2, p3] = qEulerXYZ(qRelPC);
        const R1: Quat = qMul(qP, qAxisAngle(1, 0, 0, p1));
        const R2: Quat = qMul(R1, qAxisAngle(0, 1, 0, p2));
        const anchorW = { x: parent.translation().x + aw[0]!, y: parent.translation().y + aw[1]!, z: parent.translation().z + aw[2]! };
        const m1 = this.createMid(R1, anchorW);
        const m2 = this.createMid(R2, anchorW);
        const m1i = this.allBodies.length - 2;
        const m2i = this.allBodies.length - 1;

        const zero: Vec3 = { x: 0, y: 0, z: 0 };
        const jX = this.world.createImpulseJoint(
          RAPIER.JointData.revolute(parentLocal, zero, { x: 1, y: 0, z: 0 }),
          parent, m1, true,
        ) as RAPIER.RevoluteImpulseJoint;
        const jY = this.world.createImpulseJoint(
          RAPIER.JointData.revolute(zero, zero, { x: 0, y: 1, z: 0 }),
          m1, m2, true,
        ) as RAPIER.RevoluteImpulseJoint;
        const jZ = this.world.createImpulseJoint(
          RAPIER.JointData.revolute(zero, childLocal, { x: 0, y: 0, z: 1 }),
          m2, child, true,
        ) as RAPIER.RevoluteImpulseJoint;
        const joints = [jX, jY, jZ];
        const mids = [m1i, m2i];
        const rests = [p1, p2, p3];
        const anchorLocal: Vec3[] = [{ x: aw[0]!, y: aw[1]!, z: aw[2]! }, zero, zero];
        for (let k = 0; k < 3; k++) {
          const joint = joints[k]!;
          const rest = rests[k]!;
          joint.setLimits(rest + j.minRad[k]!, rest + j.maxRad[k]!);
          const b1 = k === 0 ? pi : mids[k - 1]!;
          const b2 = k === 2 ? ci : mids[k]!;
          const dof: Dof = {
            dofIndex: this.dofs.length,
            joint: i, name: j.name, axis: k,
            b1, b2,
            applyB1: pi, applyB2: ci,
            axisLocal: k === 0 ? { x: 1, y: 0, z: 0 } : k === 1 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 },
            tauMax: j.maxTorque[k] ?? 0,
            rest,
            min: j.minRad[k]!, max: j.maxRad[k]!,
            anchorB1Local: anchorLocal[k]!,
            engineLimited: true,
            impulseMax: 0,
            engineMotor: false,
            engineJoint: joint,
            angle: 0, vel: 0, inertia: 0, inertiaLow: 0, axisWorld: new Float64Array(3), anchorWorld: new Float64Array(3),
          };
          this.dofs.push(dof);
          this.dofIndex[i * 3 + k] = dof.dofIndex;
        }
      } else {
        // ── 原生球铰（默认）：3 转动自由、无中介体 ──
        //   实测：关自碰撞后，零重力零力矩 720 拍 Σ|Δθ| = 0.0000（_probe-spherical）。
        //   执行器力偶施加在父子真实刚体上（applyB1/applyB2 = pi/ci），
        //   限位由 Drive 的 limit 通道承担（引擎无球铰限位 API）。
        const joint = this.world.createImpulseJoint(
          RAPIER.JointData.spherical(parentLocal, childLocal), parent, child, true,
        );
        const axes: Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
        for (let k = 0; k < 3; k++) {
          const dof: Dof = {
            dofIndex: this.dofs.length,
            joint: i, name: j.name, axis: k,
            b1: pi, b2: ci,
            applyB1: pi, applyB2: ci,
            axisLocal: axes[k]!,
            tauMax: j.maxTorque[k] ?? 0,
            rest: j.restRad[k] ?? 0,
            min: j.minRad[k]!, max: j.maxRad[k]!,
            anchorB1Local: { x: aw[0]!, y: aw[1]!, z: aw[2]! },
            engineLimited: false,
            impulseMax: 0,
            engineMotor: false,
            engineJoint: joint as RAPIER.RevoluteImpulseJoint,
            angle: 0, vel: 0, inertia: 0, inertiaLow: 0, axisWorld: new Float64Array(3), anchorWorld: new Float64Array(3),
          };
          this.dofs.push(dof);
          this.dofIndex[i * 3 + k] = dof.dofIndex;
        }
      }
    });
  }

  private createMid(q: Quat, pos: { x: number; y: number; z: number }): RAPIER.RigidBody {
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCanSleep(false)
        .setAngularDamping(0.04),
    );
    const I = this.opt.gimbalMidInertia;
    rb.setAdditionalMassProperties(
      this.opt.gimbalMidMass, { x: 0, y: 0, z: 0 },
      { x: I, y: I, z: I }, { x: 0, y: 0, z: 0, w: 1 }, true,
    );
    if (this.opt.gimbalMidExtraIters > 0) rb.setAdditionalSolverIterations(this.opt.gimbalMidExtraIters);
    this.allBodies.push(rb);
    this.midSpawns.push({ pos: { x: pos.x, y: pos.y, z: pos.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } });
    return rb;
  }

  // ────────────────────────────────────────────────────────────────
  /** 逻辑关节 i 的子端原始刚体子树（含 i 子体自身） */
  private buildSubtrees(): number[][] {
    const kids = new Map<number, number[]>();
    for (const j of this.sk.joints) {
      const p = this.indexByKey.get(j.parentKey)!;
      const c = this.indexByKey.get(j.childKey)!;
      const arr = kids.get(p) ?? [];
      arr.push(c);
      kids.set(p, arr);
    }
    return this.sk.joints.map((j) => {
      const start = this.indexByKey.get(j.childKey)!;
      const out: number[] = [];
      const st = [start];
      while (st.length) {
        const n = st.pop()!;
        if (out.includes(n)) continue;
        out.push(n);
        for (const k of kids.get(n) ?? []) st.push(k);
      }
      return out;
    });
  }

  /** 逻辑关节数量（渲染层契约） */
  get jointCount(): number {
    return this.sk.joints.length;
  }

  /** 躯干参考点 = 最上一段脊柱（胸腔），与 v1 `torso()` 同语义 */
  torso(): RAPIER.RigidBody {
    let best = 'torso', bestY = -Infinity;
    for (const b of this.sk.bodies) {
      if (/^spine\d+$/.test(b.key) && b.cy > bestY) { bestY = b.cy; best = b.key; }
    }
    return this.bodies[this.indexByKey.get(best) ?? 0]!;
  }

  /** 树根 = 骨盆 */
  root(): RAPIER.RigidBody {
    return this.bodies[this.indexByKey.get('torso') ?? 0]!;
  }

  /** 逻辑关节 (i, k) 对应的自由度下标；revolute 非自由轴 / 不存在 ⇒ −1 */
  dofOf(jointIdx: number, axis: number): number {
    return this.dofIndex[jointIdx * 3 + axis]!;
  }

  /** 关节名的自由度（探针用） */
  dofByName(name: string, axis: number): number {
    for (let i = 0; i < this.sk.joints.length; i++) {
      if (this.sk.joints[i]!.name === name) return this.dofOf(i, axis);
    }
    return -1;
  }

  // ────────────────────────────────────────────────────────────────
  /**
   * 刷新每个自由度的读数（角/角速度）与有效惯量。每物理步调用一次。
   *
   * 有效惯量（Featherstone & Orin 2000 的折合惯量，两侧并联近似）：
   *   I_eff = 1 / (1/I_child + 1/I_parent)
   *   I_side = Σ_bodies [ u·(R I Rᵀ)·u + m·d⊥² ]（绕该轴、过锚点的平行轴项）
   * 串联铰链的子/父"侧"都用**逻辑子树**：子侧 = 逻辑子体及其下游；
   * 父侧 = 其余全部原始刚体。这一项同时决定伺服稳定性上限与阻尼的隐式换算。
   */
  updateDofState(): void {
    this.inertiaTick++;
    // ── ① 原生球铰：swing-twist 分解（Baerlocher & Boulic 2001）──
    const st = this.stTmp;
    for (let ji = 0; ji < this.sk.joints.length; ji++) {
      const j = this.sk.joints[ji]!;
      if (j.revoluteAxis !== undefined || this.opt.sphericalMode !== 'native') continue;
      const pi = this.jointBodies[ji * 2]!;
      const ci = this.jointBodies[ji * 2 + 1]!;
      const qp = qOf(this.bodies[pi]!.rotation());
      const qc = qOf(this.bodies[ci]!.rotation());
      const qrest = qFromRotVec(j.restRad[0], j.restRad[1], j.restRad[2]);
      const qdev = qMul(qRel(qp, qc), qConj(qrest));
      swingTwistY(qdev, st);
      const d0 = this.dofOf(ji, 0);
      const d1 = this.dofOf(ji, 1);
      const d2 = this.dofOf(ji, 2);
      if (d0 >= 0) this.dofs[d0]!.angle = st[1]!;   // 轴0 = 摆动 X（外展）
      if (d1 >= 0) this.dofs[d1]!.angle = st[0]!;   // 轴1 = 扭转
      if (d2 >= 0) this.dofs[d2]!.angle = st[2]!;   // 轴2 = 摆动 Z（屈伸）
    }

    for (const d of this.dofs) {
      const b1 = this.allBodies[d.b1]!;
      const b2 = this.allBodies[d.b2]!;
      const q1 = qOf(b1.rotation());
      const q2 = qOf(b2.rotation());
      if (d.engineLimited) {
        d.angle = qSignedAngle(qRel(q1, q2), d.axisLocal.x, d.axisLocal.y, d.axisLocal.z) - d.rest;
      }

      const w1 = b1.angvel();
      const w2 = b2.angvel();
      const ax = d.axisWorld;
      qRotateVec(q1, d.axisLocal.x, d.axisLocal.y, d.axisLocal.z, ax);
      d.vel = (w2.x - w1.x) * ax[0]! + (w2.y - w1.y) * ax[1]! + (w2.z - w1.z) * ax[2]!;

      // 锚点世界点（b1 侧）
      const p1 = b1.translation();
      const an = d.anchorWorld;
      qRotateVec(q1, d.anchorB1Local.x, d.anchorB1Local.y, d.anchorB1Local.z, an);
      an[0] = an[0]! + p1.x; an[1] = an[1]! + p1.y; an[2] = an[2]! + p1.z;
      // ★ 惯性估计按 tick 降频（性能：每步全量算 46×23 次重函数占步时 ~57%）
      if ((this.inertiaTick & 3) === 0) {
        const sub = this.subtree[d.joint]!;
        if (this.subStamp.length !== this.bodies.length) this.subStamp = new Int32Array(this.bodies.length);
        this.subGen++;
        for (let k = 0; k < sub.length; k++) this.subStamp[sub[k]!] = this.subGen;
        let iChild = 0, iParent = 0;
        for (let bi = 0; bi < this.bodies.length; bi++) {
          const v = this.axisInertiaAbout(this.bodies[bi]!, ax, an[0]!, an[1]!, an[2]!);
          if (this.subStamp[bi] === this.subGen) iChild += v; else iParent += v;
        }
        const eps = 1e-9;
        d.inertia = 1 / (1 / Math.max(eps, iChild) + 1 / Math.max(eps, iParent));
        const childIdx = this.jointBodies[d.joint * 2 + 1]!;
        d.inertiaLow = Math.max(eps, this.axisInertiaAbout(this.bodies[childIdx]!, ax, an[0]!, an[1]!, an[2]!));
      }
    }
  }

  /** 刚体绕"过 anchor、方向 u"的轴的转动惯量（主惯量投影 + 平行轴） */
  private readonly eTmp = new Float64Array(3);
  private axisInertiaAbout(rb: RAPIER.RigidBody, u: Float64Array, ax: number, ay: number, az: number): number {
    const I = rb.principalInertia();
    const qb = qOf(rb.rotation());
    const qp = qOf(rb.principalInertiaLocalFrame());
    const qw = qMul(qb, qp);
    const e = this.eTmp;
    let proj = 0;
    qRotateVec(qw, 1, 0, 0, e); proj += I.x * (e[0]! * u[0]! + e[1]! * u[1]! + e[2]! * u[2]!) ** 2;
    qRotateVec(qw, 0, 1, 0, e); proj += I.y * (e[0]! * u[0]! + e[1]! * u[1]! + e[2]! * u[2]!) ** 2;
    qRotateVec(qw, 0, 0, 1, e); proj += I.z * (e[0]! * u[0]! + e[1]! * u[1]! + e[2]! * u[2]!) ** 2;
    const com = rb.worldCom();
    const rx = com.x - ax, ry = com.y - ay, rz = com.z - az;
    const along = rx * u[0]! + ry * u[1]! + rz * u[2]!;
    const d2 = rx * rx + ry * ry + rz * rz - along * along;
    return proj + rb.mass() * Math.max(0, d2);
  }

  // ────────────────────────────────────────────────────────────────
  /** 全身质心（质量加权，用真实 worldCom） */
  com(out: Float64Array): void {
    let m = 0, x = 0, y = 0, z = 0;
    for (const b of this.bodies) {
      const bm = b.mass();
      const c = b.worldCom();
      m += bm; x += bm * c.x; y += bm * c.y; z += bm * c.z;
    }
    out[0] = x / m; out[1] = y / m; out[2] = z / m;
  }

  /** 全身质心速度（质量加权 linvel = COM 速度） */
  comVel(out: Float64Array): void {
    let m = 0, x = 0, y = 0, z = 0;
    for (const b of this.bodies) {
      const bm = b.mass();
      const v = b.linvel();
      m += bm; x += bm * v.x; y += bm * v.y; z += bm * v.z;
    }
    out[0] = x / m; out[1] = y / m; out[2] = z / m;
  }

  /**
   * **静态重力补偿**：每自由度需要施加多少 τ 才能抵消重力。
   *   τ_g(i) = u_i · Σ_{b∈子树(i)} (r_b − a_i) × (m_b·g)   ⇒ 补偿 = −τ_g
   * 这是 RNEA 的静态项（Featherstone），也是人工力矩控制能"拿得住"的前提。
   * 引擎电机自由度（柔性足）跳过 —— 它们由引擎隐式电机承担。
   */
  gravityComp(out: Float64Array, gY: number): void {
    for (const d of this.dofs) {
      if (d.engineMotor) { out[d.dofIndex] = 0; continue; }
      const u = d.axisWorld, a = d.anchorWorld;
      let tau = 0;
      for (const bi of this.subtree[d.joint]!) {
        const rb = this.bodies[bi]!;
        const c = rb.worldCom();
        const m = rb.mass();
        // r × F，F = (0, m·gY, 0)
        const rx = c.x - a[0]!, ry = c.y - a[1]!, rz = c.z - a[2]!;
        const Fy = m * gY;
        const tx = -rz * Fy;
        const tz = rx * Fy;
        tau += u[0]! * tx + u[2]! * tz;
      }
      out[d.dofIndex] = -tau;
    }
  }

  /**
   * **全身质心雅可比** J（nDofs × 3，行主序，写入 out[3i..3i+2]）。
   *
   * 站立时"哪一侧在动"取决于接地侧：
   *   · 腿链（踝/膝/髋）：脚踩地 ⇒ 身体绕关节转 ⇒ 用**互补侧**（`comJacobianComplement`）
   *   · 躯干/手臂（脊柱/颈/肩/肘）：骨盆被腿撑住 ⇒ 子端在动 ⇒ 用**子端子树**（本函数）
   * 两者由平衡控制器按关节选择（纯几何 Jᵀ 在浮动基座下有符号/量级误差）。
   */
  comJacobian(out: Float64Array): void {
    const M = this.sk.massTotal;
    for (const d of this.dofs) {
      const u = d.axisWorld, a = d.anchorWorld;
      let jx = 0, jy = 0, jz = 0;
      for (const bi of this.subtree[d.joint]!) {
        const rb = this.bodies[bi]!;
        const c = rb.worldCom();
        const m = rb.mass();
        const rx = c.x - a[0]!, ry = c.y - a[1]!, rz = c.z - a[2]!;
        // u × r
        jx += m * (u[1]! * rz - u[2]! * ry);
        jy += m * (u[2]! * rx - u[0]! * rz);
        jz += m * (u[0]! * ry - u[1]! * rx);
      }
      const i3 = d.dofIndex * 3;
      out[i3] = jx / M; out[i3 + 1] = jy / M; out[i3 + 2] = jz / M;
    }
  }

  /** 互补侧质心雅可比（脚接地、身体绕关节转的近似；见 comJacobian 注释） */
  comJacobianComplement(out: Float64Array): void {
    const M = this.sk.massTotal;
    for (const d of this.dofs) {
      const u = d.axisWorld, a = d.anchorWorld;
      const sub = this.subtree[d.joint]!;
      const inSub = new Set(sub);
      let jx = 0, jy = 0, jz = 0;
      for (let bi = 0; bi < this.bodies.length; bi++) {
        if (inSub.has(bi)) continue;
        const rb = this.bodies[bi]!;
        const c = rb.worldCom();
        const m = rb.mass();
        const rx = c.x - a[0]!, ry = c.y - a[1]!, rz = c.z - a[2]!;
        // −(u × r)
        jx += -m * (u[1]! * rz - u[2]! * ry);
        jy += -m * (u[2]! * rx - u[0]! * rz);
        jz += -m * (u[0]! * ry - u[1]! * rx);
      }
      const i3 = d.dofIndex * 3;
      out[i3] = jx / M; out[i3 + 1] = jy / M; out[i3 + 2] = jz / M;
    }
  }

  /**
   * 某侧脚的法向接触力（N，向上为正）。**必须在 world.step() 之后调用**。
   * 遍历该侧 foot/arch/mfoot 的全部 collider，累加接触冲量沿法线的竖直分量 / dt。
   */
  footNormalForce(side: 'l' | 'r', dt: number): number {
    const keys = [`foot_${side}`, `arch_${side}`, `mfoot_${side}`];
    let f = 0;
    for (const key of keys) {
      const bi = this.indexByKey.get(key);
      if (bi === undefined) continue;
      for (const col of this.collidersByBody[bi] ?? []) {
        this.world.contactPairsWith(col, (other) => {
          this.world.contactPair(col, other, (manifold) => {
            const n = manifold.normal();
            const ny = Math.abs(n.y);
            if (ny < 0.5) return;
            for (let i = 0; i < manifold.numContacts(); i++) {
              f += manifold.contactImpulse(i) * Math.sign(n.y) * ny;
            }
          });
        });
      }
    }
    return f / dt;
  }

  /**
   * 某侧脚的 CoP（压力中心，世界 x/z）与法向合力（N）；写入 out[0..2]。
   * 返回 false = 该脚当前基本无接触（out 清零）。**必须在 world.step() 之后调用**。
   * 逐接触点用冲量加权（接触点从 collider1 局部系转到世界）。
   */
  footCoP(side: 'l' | 'r', dt: number, out: Float64Array): boolean {
    const keys = [`foot_${side}`, `arch_${side}`, `mfoot_${side}`];
    let sx = 0, sz = 0, si = 0;
    const w3 = this.copWorldBuf;
    for (const key of keys) {
      const bi = this.indexByKey.get(key);
      if (bi === undefined) continue;
      for (const col of this.collidersByBody[bi] ?? []) {
        this.world.contactPairsWith(col, (other) => {
          this.world.contactPair(col, other, (manifold, flipped) => {
            const n = manifold.normal();
            if (Math.abs(n.y) < 0.5) return;
            const sgn = Math.sign(n.y);
            const q = qOf(col.rotation());
            const t = col.translation();
            for (let i = 0; i < manifold.numContacts(); i++) {
              const imp = manifold.contactImpulse(i);
              if (imp <= 1e-12) continue;
              // ★ flipped 时 manifold 的 1/2 侧与 (col, other) 相反
              const lp = flipped ? manifold.localContactPoint2(i) : manifold.localContactPoint1(i);
              if (!lp) continue;
              qRotateVec(q, lp.x, lp.y, lp.z, w3);
              const w = imp * sgn;
              sx += (t.x + w3[0]!) * w;
              sz += (t.z + w3[2]!) * w;
              si += w;
            }
          });
        });
      }
    }
    if (Math.abs(si) < 1e-9) { out[0] = 0; out[1] = 0; out[2] = 0; return false; }
    out[0] = sx / si; out[1] = sz / si; out[2] = Math.abs(si) / dt;
    return true;
  }

  /** 关节 i 的锚点世界坐标 */
  jointWorld(i: number, out: Float64Array): void {
    const j = this.sk.joints[i]!;
    const p = this.bodies[this.jointBodies[i * 2]!]!;
    const q = qOf(p.rotation());
    qRotateVec(q, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2], out);
    const t = p.translation();
    out[0] += t.x; out[1] += t.y; out[2] += t.z;
  }

  /** 逻辑关节 i 的三轴**控制角**（串联：Euler 角；revolute：自由轴角，其余 0） */
  jointRot(i: number, out: Float64Array): void {
    out[0] = 0; out[1] = 0; out[2] = 0;
    for (let k = 0; k < 3; k++) {
      const di = this.dofOf(i, k);
      if (di >= 0) out[k] = this.dofs[di]!.angle;
    }
  }

  /** 逻辑关节 i 的三轴角速度（父体系，与 v1 `jointRelVel` 同口径） */
  jointRelVel(i: number, out: Float64Array): void {
    const pi = this.jointBodies[i * 2]!;
    const ci = this.jointBodies[i * 2 + 1]!;
    const p = this.bodies[pi]!;
    const c = this.bodies[ci]!;
    const wp = p.angvel(), wc = c.angvel();
    const qp = qOf(p.rotation());
    qInvRotateVec(qp, wc.x - wp.x, wc.y - wp.y, wc.z - wp.z, out);
  }

  /** 发动机电机（柔性足）的目标角：rad，相对关节零点 */
  setEngineMotorTarget(dofIdx: number, rad: number): void {
    const d = this.dofs[dofIdx]!;
    if (!d.engineJoint || !d.engineMotor) return;
    d.engineJoint.configureMotorPosition(rad + d.rest, this.opt.archStiffness, this.opt.archDamping);
  }

  /** 复位到静姿态（含中间体），清速度与账本 */
  reset(): void {
    this.sk.bodies.forEach((b: BodyDef, i: number) => {
      const rb = this.bodies[i]!;
      rb.setTranslation({ x: b.cx, y: b.cy, z: b.cz }, true);
      rb.setRotation(this.restQuatOfBody(b), true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    for (let k = 0; k < this.midSpawns.length; k++) {
      const s = this.midSpawns[k]!;
      const rb = this.allBodies[this.bodies.length + k]!;
      rb.setTranslation(s.pos, true);
      rb.setRotation({ x: s.q.x, y: s.q.y, z: s.q.z, w: s.q.w }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.executor.beginStep();
    this.updateDofState();
  }

  private resetMids(): void {
    // 中间体出生姿态 = 父体静姿态 ⊗ Euler 分解（与 createJoints 同算法）
    let mi = this.bodies.length;
    for (let i = 0; i < this.sk.joints.length; i++) {
      const j = this.sk.joints[i]!;
      if (j.revoluteAxis) continue;
      const pi = this.jointBodies[i * 2]!;
      const ci = this.jointBodies[i * 2 + 1]!;
      const qP = qOf(this.bodies[pi]!.rotation());
      const qC = qOf(this.bodies[ci]!.rotation());
      const [p1, p2] = qEulerXYZ(qRel(qP, qC));
      const R1 = qMul(qP, qAxisAngle(1, 0, 0, p1));
      const R2 = qMul(R1, qAxisAngle(0, 1, 0, p2));
      const aw = new Float64Array(3);
      qRotateVec(qP, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2], aw);
      const t = this.bodies[pi]!.translation();
      const pos = { x: t.x + aw[0]!, y: t.y + aw[1]!, z: t.z + aw[2]! };
      for (const q of [R1, R2]) {
        const rb = this.allBodies[mi++]!;
        rb.setTranslation(pos, true);
        rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }
}

/** revolute 关节的自由轴（0/1/2）；球铰 −1 */
export function freeAxisOf(j: JointDef): number {
  if (!j.revoluteAxis) return -1;
  const [x, y] = j.revoluteAxis;
  return x !== 0 ? 0 : y !== 0 ? 1 : 2;
}

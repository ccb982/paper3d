/**
 * 救援模块（唯一实现；用户："向前向后统一为一个模块；侧向也统一为一个模块；不要重复的实现"）
 *
 * - `rescueOffsets()`：**单一需求律**——pitch/roll 误差(带死区) + 速率，双向对称（前后/左右同一条公式，
 *   无分方向代码路径）；输出=按轴权重分配的目标偏移表（rad），由既有唯一写手消费：
 *   踝=引擎电机目标 / 膝=膝pair λ / 髋=支撑髋 λ / 脊柱=spine trend。
 * - 方向标定：`SAG_SIGN`/`LAT_SIGN`（±各标一次）；增益/死区/帽/权重 env 可扫。
 * - 状态：module 级上帧值算速率；单腿期外调用无害（误差≈0→输出≈0）。
 */
import type { ServoRefs } from './supportReg';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const num = (k: string, d: number): number => Number(ENV[k] ?? d);

export interface RescueDist { ankle: number; knee: number; hip: number; spine: number }
export interface RescuePair { sag: RescueDist; lat: RescueDist }

/** 最近一次计算结果（各写手消费；每帧由 supportColumn 刷新一次） */
export const lastRescue: RescuePair = {
  sag: { ankle: 0, knee: 0, hip: 0, spine: 0 },
  lat: { ankle: 0, knee: 0, hip: 0, spine: 0 },
};

/** ★ §2.668 唯一"标准位置"（用户："上身目标位置统一=一开始的位置；竖直角度=一开始的竖直角度"）：
 *  单腿成立瞬间一次捕获，全系统共享（planeSag/lateralStab/stepPhases 全部改读此处，删除各自捕获）。 */
export const standardPose = {
  ready: false,
  comX0: 0,
  comZ0: 0,
  roll0W: 0,
  pitch0W: 0,
  sp0L: [0, 0, 0] as [number, number, number],
  sp0P: [0, 0, 0] as [number, number, number],
};
/** ★ §2.669 上身总开关（唯一读取点）：Node=环境变量 `UPPER_OFF=1`；网页=?upper=off 或按钮（setUpperOff）。 */
let _upperOffOverride = false;
export function setUpperOff(v: boolean): void { _upperOffOverride = v; }
export function upperOff(): boolean {
  if (_upperOffOverride) return true;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.UPPER_OFF ?? '';
  if (env === '1') return true;
  const loc = (globalThis as { location?: { search?: string } }).location;
  if (loc?.search && loc.search.includes('upper=off')) return true;
  return false;
}

let _sgPrev: number | null = null;
let _ltPrev: number | null = null;
let _dyPrev: number | null = null;
let _comZ0: number | null = null;   // ★ §2.651 标准位置：刚好抬腿时的 CoM 侧向位置（判定中心&钉位参考）
let _comX0r: number | null = null;  // ★ §2.658 前后标准位置（comX 位移项——对称补齐：前后也要"钉位"）
let _prLp = 0, _rrLp = 0;           // ★ §2.656 速率低通（治翻号泵：速率不直接进律）

/** 单一律（用户定 v2："救援应该是持续施力，然后根据倾倒程度提升挡位；阻尼 99%"）：
 *  位置项=死区外**单调持续**（随 |e| 升挡：G1 → RESCUE_GEAR×G1 线性过渡，不翻号）；
 *  阻尼项=**低通速率**×kD（99% 档），只做耗能不做泵。 */
function law(err: number, rate: number, sign: number, dead: number, kP: number, kD: number, cap: number): number {
  if (Math.abs(err) <= dead) return 0;
  const e = err - Math.sign(err) * dead;
  const a = Math.abs(e);
  const gear = a <= 0.087 ? 1 : 1 + (Number(ENV.RESCUE_GEAR ?? 2.2) - 1) * Math.min(1, (a - 0.087) / 0.17);
  const pos = sign * Math.sign(e) * kP * gear * a;   // 持续、单调、随倾倒升挡
  const damp = sign * kD * rate;
  return Math.max(-cap, Math.min(cap, pos + damp));
}

/** 最近一次计算的调试快照（探针用） */
export const lastRescueDbg = { latSig: 0, latRollD: 0, comDz: 0, sagD: 0 };

/** ★ §2.670 刚体上身（受力解剖用）：脊柱 6 轴高刚锁（controller 内） + 上身世界冻结（freezeUpperStep，独立可调）。 */
let _rigidUpper = false;
let _wasRigid = false;
let _rigidBodies: Array<{ idx: number; p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }> | null = null;
export function setRigidUpper(v: boolean): void { _rigidUpper = v; }
export function rigidUpperOn(): boolean { return _rigidUpper; }

/** ★ 刚体上身步骤（独立函数：每帧由 web 主循环调用——任何时刻切换都可见生效）。
 *  开：捕获上身各段世界位姿 + 脊柱六轴超刚锁（setAngle+pin）；每帧回置位姿+清零速度。
 *  关：解除。 */
export function freezeUpperStep(
  body: { indexByKey: Map<string, number>; bodies: Array<unknown>; dofByName(j: string, a: number): number },
  manual?: { setAngle(j: string, a: number, r: number, kp?: number, kd?: number): void; pin(j: string, a: number, v: boolean): void; clearAngle(j: string, a: number): void; angleOf?(j: string, a: number): number },
): void {
  const deg = body as unknown as { dofs: Array<{ angle: number }> };
  if (!_rigidUpper) {
    if (_wasRigid || _rigidBodies !== null) {
      _rigidBodies = null;
      if (manual) {
        for (const sn of ['spine1', 'spine2', 'spine3']) for (const ax of [0, 2]) {
          manual.pin(sn, ax, false);
          manual.clearAngle(sn, ax);
        }
      }
      _wasRigid = false;
    }
    return;
  }
  if (!_wasRigid) {
    _rigidBodies = [];
    // ★ §2.672b 用户："胳膊也不要动"——冻结集合含臂链（arm=上臂、hand=前臂）
    // ★ §2.678b 探针选项 FREEZE_SKIP_TORSO=1：不钉骨盆（torso）——只冻骨盆以上，腿链正常控骨盆（录"上身自己的控制"数据用）
    const _skipTorso = (((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).FREEZE_SKIP_TORSO === '1');
    for (const key of ['spine1', 'spine2', 'spine3', 'spine4', 'torso', 'arm_l', 'arm_r', 'hand_l', 'hand_r']) {
      if (_skipTorso && key === 'torso') continue;   // ★ §2.678 补 spine4（最上段原缺→只被伺服吊着微振 vel3.26→力矩伪迹±146）
      const idx = body.indexByKey.get(key);
      if (idx === undefined) continue;
      const rb = body.bodies[idx] as { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } };
      _rigidBodies.push({ idx, p: { ...rb.translation() }, q: { ...rb.rotation() } });
    }
    if (manual) {
      for (const sn of ['spine1', 'spine2', 'spine3']) for (const ax of [0, 2]) {
        const d = body.dofByName(sn, ax);
        if (d >= 0) {
          manual.setAngle(sn, ax, deg.dofs[d]!.angle, 20000, 300);
          manual.pin(sn, ax, true);
        }
      }
    }
    _wasRigid = true;
  }
  if (_rigidBodies) {
    for (const f of _rigidBodies) {
      const rb = body.bodies[f.idx] as {
        setTranslation(t: { x: number; y: number; z: number }, wake: boolean): void;
        setRotation(q: { x: number; y: number; z: number; w: number }, wake: boolean): void;
        setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
        setAngvel(v: { x: number; y: number; z: number }, wake: boolean): void;
      };
      rb.setTranslation(f.p, true);
      rb.setRotation(f.q, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
}

export function rescueOffsets(ctx: ServoRefs, dt: number): RescuePair {
  const pitch = ctx.sensors.torsoTilt[0]!;
  const roll = ctx.sensors.torsoTilt[1]!;
  const pr = _sgPrev === null ? 0 : (pitch - _sgPrev) / Math.max(dt, 1e-6);
  const rr = _ltPrev === null ? 0 : (roll - _ltPrev) / Math.max(dt, 1e-6);
  _sgPrev = pitch;
  _ltPrev = roll;
  // ★ §2.656 速率低通 τ50ms（进律前平滑——翻号泵的根治件）
  const aLp = 1 - Math.exp(-dt / 0.05);
  _prLp += (pr - _prLp) * aLp;
  _rrLp += (rr - _rrLp) * aLp;
  const prS = _prLp, rrS = _rrLp;
  // 盆线 Δy（支撑髋高−摆腿髋高；抬腿侧沉为正）——侧向救援的第二信号（唯一计算点）
  let dy = 0;
  {
    const supSide = ctx.bal.drive.legReflex.side;
    if (supSide !== null) {
      const dSup = ctx.body.dofByName(`hip_${supSide}`, 0);
      const dSw = ctx.body.dofByName(`hip_${supSide === 'l' ? 'r' : 'l'}`, 0);
      if (dSup >= 0 && dSw >= 0) dy = (ctx.body.dofs[dSup]!.anchorWorld[1]! - ctx.body.dofs[dSw]!.anchorWorld[1]!) * 100;
    }
  }
  const dyd = _dyPrev === null ? 0 : (dy - _dyPrev) / Math.max(dt, 1e-6);
  _dyPrev = dy;
  const dead = num('RESCUE_DEAD', 0.035);   // ★ §2.666b 回归（dead=0 过驱→弹飞；回 2° 死区）
  const cap = num('RESCUE_CAP', 0.15);      // ★ 回归 0.25→0.15（过驱源）
  // ── 标准位置（抬腿起点）捕获 + 位移项（前后/左右对称"钉位"）──
  // ── 标准位置（抬腿起点）捕获 + 位移项（前后/左右对称"钉位"）──
  if (ctx.bal.drive.legReflex.side !== null) {
    if (_comZ0 === null) {
      _comZ0 = ctx.sensors.com[2]!;
      _comX0r = ctx.sensors.com[0]!;
      // ★ §2.668 唯一标准位置：一次捕获全部场（位置/世界姿态/关节初态）
      standardPose.ready = true;
      standardPose.comX0 = ctx.sensors.com[0]!;
      standardPose.comZ0 = ctx.sensors.com[2]!;
      standardPose.roll0W = ctx.sensors.torsoTilt[1]!;
      standardPose.pitch0W = ctx.sensors.torsoTilt[0]!;
      (['spine1', 'spine2', 'spine3'] as const).forEach((sn, k) => {
        const dL = ctx.body.dofByName(sn, 0);
        const dP = ctx.body.dofByName(sn, 2);
        standardPose.sp0L[k] = dL >= 0 ? ctx.body.dofs[dL]!.angle : 0;
        standardPose.sp0P[k] = dP >= 0 ? ctx.body.dofs[dP]!.angle : 0;
      });
    }
  } else {
    _comZ0 = null;
    _comX0r = null;
    standardPose.ready = false;
  }
  const comDz = _comZ0 === null ? 0 : ctx.sensors.com[2]! - _comZ0;
  const comDx = _comX0r === null ? 0 : ctx.sensors.com[0]! - _comX0r;
  const comXTerm = num('SAG_COMX_K', 6) * comDx;
  // ★ §2.665 用户："矢状面硬也包括及时往中心拉回"——两项取主导（原来相加会互相抵消=回中拉不及时）
  const sagSig = Math.abs(pitch) >= Math.abs(comXTerm) ? pitch : comXTerm;
  const latSig = roll + num('LAT_COMZ_K', -6) * comDz;    // ★ §2.653 标定：K=−6（负=钉位方向；正号外走发散）
  // ── 矢状（前后）：位置持续升挡 + 阻尼99%
  const sagD = law(sagSig, prS, num('SAG_SIGN', 1), dead, num('SAG_KP', 0.34), num('SAG_KD', 0.12), cap);   // ★ §2.664 矢状链上强度（用户："矢状面没人管"；先别撤，看效果）
  // ── 侧向（左右）──
  const latRollD = law(latSig, rrS, num('LAT_SIGN', 1), dead, num('LAT_KP', 0.15), num('LAT_KD', 0.12), cap);   // ★ §2.660 用户："侧向力太大"——kP 0.5→0.15（平时小额，大偏才靠挡位放大）
  const dyHip = Math.max(-0.15, Math.min(0.15, -1 * (num('LAT_DY_KP_HIP', 0.01) * dy + num('LAT_DY_KD_HIP', 0.004) * dyd)));   // §2.644 标定：髋符号 −1
  const dySpine = Math.max(-0.03, Math.min(0.03, +(num('LAT_DY_KP_SPINE', 0.005) * dy + num('LAT_DY_KD_SPINE', 0.002) * dyd))) + num('LAT_TONE', 0.02);   // §2.639/641：脊符号 +1 +tonic
  const out: RescuePair = {
    sag: {
      // ★ §2.673 标定修正（摆动腿尸检：原 + 方向在支撑髋/踝上=向后弹飞源；脊柱 +1 单独标定过）
      ankle: sagD * num('SAG_W_ANKLE', -1.0),
      knee: sagD * num('SAG_W_KNEE', 0),        // 待单独标定（暂 0）
      hip: sagD * num('SAG_W_HIP', -1.0),
      spine: sagD * num('SAG_W_SPINE', 3.5),    // ★ 绝对大头（§2.657 方向已标定+）
    },
    lat: {
      ankle: latRollD * num('LAT_W_ANKLE', 0.0),
      knee: latRollD * num('LAT_W_KNEE', 0.0),
      hip: latRollD * num('LAT_W_HIP', 1.3) + dyHip,     // ★ §2.652 腿=位置维持主力（用户："腿要维持上身一直在初始位置±5cm"）
      spine: latRollD * num('LAT_W_SPINE', 0.5) + dySpine,
    },
  };
  lastRescue.sag = out.sag;
  lastRescue.lat = out.lat;
  // ★ §2.670 刚体上身：完整逻辑已移至独立 freezeUpperStep（web 主循环调用，任何时刻生效）
  lastRescueDbg.latSig = latSig;
  lastRescueDbg.latRollD = latRollD;
  lastRescueDbg.comDz = comDz;
  lastRescueDbg.sagD = sagD;
  return out;
}

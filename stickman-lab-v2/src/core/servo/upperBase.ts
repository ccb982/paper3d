/**
 * servo/upperBase.ts —— 上身基础挡（**唯一架构**，2026-10-15 用户定调）
 *
 * 用户定调（本轮）：
 *  - "四个方向 / 有每个方向的基础力矩和基础修正 / 每个方向都是独立的"
 *  - "基础力矩是固定的，模拟的是一点外力不受情况下、能正常站着的力矩"
 *  - "修正量要看自身受力"；"每方向修正公式唯一"；"架构唯一、不要时间"。
 *
 * 结构（脊柱 6 轴 spine1/2/3 × 轴0/轴2；每帧；前后/左右独立）：
 *   四个方向 d ∈ {左, 右, 前, 后}，每方向两个独立参数：
 *     · 基础力矩 B_d（N·m）——固定档：无外力时正常站着的力矩
 *     · 基础修正 G_d（无量纲）——对"需求矩"的取用比例（不抢不欠 = 1）
 *   唯一公式：
 *     需求矩 τ_need = −W·(comErr + comVel/ω₀)        （体重 × XcoM 偏差，N·m，受力驱动）
 *     指令矩 τ_cmd  = B_d + G_d·τ_need                （方向 d 按所需力矩符号选）
 *     λ = θ₀ + wg[k]·τ_cmd/(C·K_pair·kStage_NOM)      （经肌肉对刚度换算；钳 ±LCLAMP）
 *   通道 = commandMusclePair（申请制）；单向阻尼/F0/弧度生长走 drive 内建。
 *   C = 张力档（分轴分侧 + KC·|dev|）——肌肉对的刚度来源（非方向参数）。
 *
 * 生效：单腿相 && standardPose 已建立 && !upperOff()。调用点 = stepPhases B 相 + C 保持。
 *
 * env：UPPER_BASE=1/0；B 族 UPPER_B0N/B0P/B2N/B2P（默认 0，待标定）；G 族 UPPER_G0N/G0P/G2N/G2P（默认 1）；
 *      C 族 UPPER_C/C2/CP/CN/CP2/CN2/KC；UPPER_LCLAMP（默认 0.08）；UPPER_WG（默认 0.2,1,1）；UPPER_KSTAGE（默认 1.1）。
 */
import type { ServoRefs } from './supportReg';
import { standardPose, upperOff } from './rescue';
import { propose, PRI } from '../proposalBus';   // ★ 提案制：唯一出口=ControlModule 整合器

const ENV = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
const num = (k: string, d: number): number => {
  const v = Number(ENV[k]);
  return Number.isFinite(v) ? v : d;
};

/** 基础挡通道覆盖的自由度（脊柱 9 轴：spine1/2/3 × 轴0/轴1/轴2） */
const SPINE: ReadonlyArray<readonly [string, number]> = [
  ['spine1', 0], ['spine1', 1], ['spine1', 2],
  ['spine2', 0], ['spine2', 1], ['spine2', 2],
  ['spine3', 0], ['spine3', 1], ['spine3', 2],
];

/** 盆骨通道状态（Δy 速率低通）；旋转通道初值（轴1；单腿成立时捕获） */
let _dyPrev: number | null = null;
let _dydLp = 0;
let _sp0T: [number, number, number] | null = null;

export function upperBaseWrite(ctx: ServoRefs, dt: number): void {
  if (String(ENV.UPPER_BASE ?? '1') !== '1') return;
  if (upperOff()) return;
  if (!standardPose.ready) return;
  if (ctx.bal.drive.legReflex.side === null) { _dyPrev = null; _dydLp = 0; _sp0T = null; return; }   // 单腿相才写
  // ── 四个方向：每方向独立（基础力矩 B_d + 基础修正 G_d）──
  //   ★ 理论约束（_tmp-model：倒立摆模型）：x_eq≈kτ·B/(kτGW−ω₀²)≈2.8mm×B —— |B|≲7 N·m 才能 10s 站住；
  //   B=16 → x_eq 4.45cm 超出支撑面 4cm → 必然倒（实测吻合）。B 只做小偏置。
  const B0N = num('UPPER_B0N', -4), B0P = num('UPPER_B0P', -4);   // 轴0：左 / 右（小偏置，压侧漂）
  const B2N = num('UPPER_B2N', 4), B2P = num('UPPER_B2P', 4);   // 轴2：前 / 后（理论范围内 +4）
  const G0N = num('UPPER_G0N', 1), G0P = num('UPPER_G0P', 1);
  const G2N = num('UPPER_G2N', 1), G2P = num('UPPER_G2P', 1);
  // ── 轴1（旋转："斜了要转回初始朝向"）——两方向（正旋/负旋），同结构 ──
  const B1N = num('UPPER_B1N', 0), B1P = num('UPPER_B1P', 0);
  const G1N = num('UPPER_G1N', 1), G1P = num('UPPER_G1P', 1);
  const KROT = num('UPPER_KROT', 60), TAUR = num('UPPER_TAUR', 0.1);   // 需求矩刚度 N·m/rad + 速度前视 s
  const lclamp = num('UPPER_LCLAMP', 0.08);
  const wg = (ENV.UPPER_WG ?? '0.2,1,1').split(',').map(Number);
  const kStageNom = num('UPPER_KSTAGE', 1.1);
  // ── 张力档 C（肌肉对刚度来源）──
  const C0 = num('UPPER_C', 0.2), C2 = num('UPPER_C2', C0);
  const CP0 = num('UPPER_CP', C0), CN0 = num('UPPER_CN', C0);
  const CP2 = num('UPPER_CP2', num('UPPER_CP', C2)), CN2 = num('UPPER_CN2', num('UPPER_CN', C2));
  const C1 = num('UPPER_C1', C0);
  const CP1 = num('UPPER_CP1', C1), CN1 = num('UPPER_CN1', C1);
  const KC = num('UPPER_KC', 0);
  // ── 需求矩（受力驱动；体重 × XcoM 偏差，N·m）──
  const Wg = ctx.body.sk.massTotal * 9.81;
  const omega0 = Math.sqrt(9.81 / Math.max(0.5, ctx.sensors.com[1]!));
  const eZ = ctx.sensors.com[2]! - standardPose.comZ0;
  const eX = ctx.sensors.com[0]! - standardPose.comX0;
  const tqZ = -Wg * (eZ + ctx.sensors.comVel[2]! / omega0);   // 左右需求矩
  const tqX = -Wg * (eX + ctx.sensors.comVel[0]! / omega0);   // 前后需求矩
  // 方向选择：按所需力矩符号（eZ/eX < 0 → 负向档 N；≥0 → 正向档 P）
  const bSel0 = eZ < 0 ? B0N : B0P, gSel0 = eZ < 0 ? G0N : G0P;
  const bSel2 = eX < 0 ? B2N : B2P, gSel2 = eX < 0 ? G2N : G2P;
  const tqCmd0 = bSel0 + gSel0 * tqZ;
  const tqCmd2 = bSel2 + gSel2 * tqX;
  const kPair = ctx.bal.drive.opt.musclePairK;
  // ── 盆骨通道（腹部两侧肌肉；用户定调："给盆骨服务——把盆骨拉到水平位置，处理摆动腿处下跌；天然有一侧要多发力"）──
  //   信号：dy = 承重髋高 − 摆动髋高（+ = 摆动侧沉）；速率 dyd（30ms 低通）。
  //   需求矩：τ_pelv = B_dir + P_dir·dy + D_dir·dyd（摆动侧沉 / 非沉 两方向独立参数）。
  //   输出：加到腰段(spine1)轴0 的 λ（盆骨通道全责在腰）；肌肉对 f1−f2 天然产生"一侧多发力"。
  const sup1 = ctx.bal.drive.legReflex.side!;
  const dSup0 = ctx.body.dofByName(`hip_${sup1}`, 0);
  const dSw0 = ctx.body.dofByName(`hip_${sup1 === 'l' ? 'r' : 'l'}`, 0);
  let dy = 0, dyd = 0;
  if (dSup0 >= 0 && dSw0 >= 0) {
    dy = ctx.body.dofs[dSup0]!.anchorWorld[1]! - ctx.body.dofs[dSw0]!.anchorWorld[1]!;
    const raw = _dyPrev === null ? 0 : (dy - _dyPrev) / Math.max(dt, 1e-6);
    _dyPrev = dy;
    _dydLp += (raw - _dydLp) * (1 - Math.exp(-dt / 0.03));
    dyd = _dydLp;
  }
  const pelvP = dy >= 0 ? num('UPPER_PDY_P', 120) : num('UPPER_PDY_N', 120);
  const pelvD = dy >= 0 ? num('UPPER_DDY_P', 50) : num('UPPER_DDY_N', 50);
  // ★ 基础力矩：常档（用户定调："那个摆动腿侧的需要基础力矩"——单腿期把下沉侧托住；
  //   符号实测：+8 把髋 dy 从 −1.4cm 推回 +1.2cm（-8 → −7.1cm 恶化）→ 取正）
  const pelvB = num('UPPER_PELV_B', 8);
  const pelvClamp = num('UPPER_PELV_CLAMP', 0.05);
  const tauPelv = pelvB + pelvP * dy + pelvD * dyd;
  // ── 轴1（旋转）通道：捕获初值 → 需求矩回初始朝向 ──
  if (_sp0T === null) {
    _sp0T = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const d1 = ctx.body.dofByName(`spine${k + 1}`, 1);
      _sp0T[k] = d1 >= 0 ? ctx.body.dofs[d1]!.angle : 0;
    }
  }
  const sp0T = _sp0T;
  const tqCmdT: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const d1 = ctx.body.dofByName(`spine${k + 1}`, 1);
    if (d1 < 0) continue;
    const err = ctx.body.dofs[d1]!.angle - sp0T[k]!;
    const need = -KROT * (err + TAUR * ctx.body.dofs[d1]!.vel);   // 需求矩（把身体转回初始朝向）
    const b = err >= 0 ? B1P : B1N, g = err >= 0 ? G1P : G1N;
    tqCmdT[k] = b + g * need;
  }
  for (let bi = 0; bi < SPINE.length; bi++) {
    const [n, ax] = SPINE[bi]!;
    const di = ctx.body.dofByName(n, ax);
    if (di < 0) continue;
    const d = ctx.body.dofs[di]!;
    const k = n === 'spine1' ? 0 : n === 'spine2' ? 1 : 2;
    const isT1 = ax === 1;
    const th0 = isT1 ? sp0T[k]! : ax === 0 ? standardPose.sp0L[k]! : standardPose.sp0P[k]!;
    const w = Number.isFinite(wg[k]) ? wg[k]! : 1;
    const cp = isT1 ? CP1 : ax === 0 ? CP0 : CP2, cn = isT1 ? CN1 : ax === 0 ? CN0 : CN2;
    // 张力档（按当前偏差侧）
    const devNow = d.angle - th0;
    const c = Math.min(1.0, (devNow >= 0 ? cp : cn) + KC * Math.abs(devNow));
    // 指令矩 → λ 预载（肌肉对刚度换算；不抢不欠 = 给多少力矩就压多少）
    const tauCmd = isT1 ? tqCmdT[k]! : ax === 0 ? tqCmd0 : tqCmd2;
    let dLam = w * tauCmd / Math.max(1e-6, c * kPair * kStageNom);
    if (n === 'spine1' && ax === 0) {
      let dlp = tauPelv / Math.max(1e-6, c * kPair * kStageNom);
      if (dlp > pelvClamp) dlp = pelvClamp; else if (dlp < -pelvClamp) dlp = -pelvClamp;
      dLam += dlp;
    }
    if (dLam > lclamp) dLam = lclamp; else if (dLam < -lclamp) dLam = -lclamp;
    propose({ dof: di, kind: 'pair', pri: PRI.servo, c, rad: th0 + dLam, src: 'upperBase' });
  }
  void dt;
}

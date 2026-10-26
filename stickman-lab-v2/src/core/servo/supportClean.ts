/**
 * supportClean.ts —— 回正力写手（2026-10-16 重构：按《基础力写手审计.md》§4.2 + 《张力层迁移设计》）
 *
 * 三层架构：
 *   基础力 = gcomp（抗重力，antiG 通道）——不在本模块
 *   回正力 = **本模块**：回标准弹簧（迁移自旧张力层的"保持"部分）+ 方向项 + 预算
 *   张力   = stability ⓪ 的纯单向阻尼
 *
 * 每轴：τ = kp·(ref−θ) + kd·(−ω) + [方向项]，限幅 = 预算
 *   ref = 抬腿结束那一刻捕获的标准态（_ref；supportCleanReset 清空重捕）
 *   方向项（仅承重/平衡链）：
 *     foot0 → CoP 侧向 = XCoM 需求 → CoP 跟踪
 *     foot2 → CoP 矢状 = XCoM 需求 → CoP 跟踪
 *     hip0  → Kz·(z_std − z_com)
 *     hip2  → Kx·(x_std − x_com)
 *     knee2 → Ky·(y_std − y_com)（com 低于标准→伸膝抬起）
 *   摆动腿：同式（无方向项）+ 静偏置（SW_* env）
 * 已删除（旧体系）：N/P 四套增益、dirState 方向态、kCom+守护器消费、kTilt、模式分套 B0、spineShare。
 */
import { propose, PRI } from '../proposalBus';
import { baseTq, baseAng, baseState, baseParams } from './baseTable';
import { Loop2, CopLoop, pdDev, baseTorque, baseRef, clamp } from './kernel';   // ★ 提取的共享内核   // ★ v3：基础力矩表+目标角度表
import type { ServoRefs } from './supportReg';
import { rescueOffsets } from './rescue';

const envOf = (): Record<string, string | undefined> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
let _refState = '';   // ★ 2026-10-17 用户（'回读力矩这怎么可能是蹲下了'）：_ref 缓存只读一次 →
//   切蹲下状态后仍是站立目标！状态变化时必须清缓存重读 baseAng。
function syncRefState(): void {
  const st = baseState();
  if (st !== _refState) { _refState = st; _ref.clear(); }
}
const _lp = new Map<string, number>();   // ★ 2026-10-16 频段分离：回正力低通状态（论文：姿势控制是低频 0.5-2Hz）
let _tcFrame = 0;   // v2 Loop2 帧计数
const _kernelLoop2 = new Loop2();
const _kernelCop = new CopLoop();
const _tauHist = new Map<string, Float64Array>();   // v2 Loop2: τ 环缓冲（延迟用）
const _tcLp = new Map<string, number>();      // v2 Loop2: 低通 Tc
let _com0: { x: number; y: number; z: number } | null = null;
export function supportCleanReset(): void {
  _ref.clear();
  _lp.clear();
  _tcFrame = 0; _tauHist.clear(); _tcLp.clear();
  _com0 = null;
}

const ARM_AXES: Array<[string, number]> = [
  ['neck', 0], ['neck', 1], ['neck', 2],
  ['spine1', 0], ['spine1', 1], ['spine1', 2],
  ['spine2', 0], ['spine2', 1], ['spine2', 2],
  ['spine3', 0], ['spine3', 1], ['spine3', 2],
  ['neck', 0], ['neck', 1], ['neck', 2],
  ['shoulder_l', 0], ['shoulder_l', 1], ['shoulder_l', 2],
  ['shoulder_r', 0], ['shoulder_r', 1], ['shoulder_r', 2],
  ['elbow_l', 0], ['elbow_l', 1], ['elbow_l', 2],
  ['elbow_r', 0], ['elbow_r', 1], ['elbow_r', 2],
];

const AXES: Array<[string, number]> = [
  ['hip', 0], ['hip', 1], ['hip', 2],
  ['knee', 0], ['knee', 1], ['knee', 2],
  ['foot', 0], ['foot', 1], ['foot', 2],
];

export function supportClean(ctx: ServoRefs, side: 'l' | 'r'): void {
  syncRefState();   // ★ 状态变化→清目标缓存
  if (side === 'r') _tcFrame++;   // v2 Loop2 帧计数（每帧一次）
  rescueOffsets(ctx, 1 / 240);   // standardPose 捕获（保留旧链）
  // ★ 2026-10-17 合并：trunkClean 已并入本写手（ARM_AXES 含脊柱/颈）——不再调用独立写手
  const e = envOf();
  // 支撑模式：双支撑（both/none）两腿都是支撑腿；单腿（l/r）只有支撑侧（对侧=摆动）
  const mode = ctx.bal.supportState.mode;
  const sup = mode === 'both' || mode === 'none' ? true : mode === side;
  const body = ctx.body;
  const sen = ctx.sensors;
  const com = sen.com;
  // ★ 2026-10-16 首帧守卫：传感器未初始化（com.y≈0）时不得捕获标准态——
  //   否则 std=(0,0,0) → 方向项 2500×(0−真实com) = 满格钳位（站立探针首帧 −220@knee2 的根因）
  if (!_com0 && com[1]! > 0.3) _com0 = { x: com[0]!, y: com[1]!, z: com[2]! };
  const std = _com0 ?? { x: com[0]!, y: com[1]!, z: com[2]! };

  // ── 回标准弹簧（★ 2026-10-16 量程归一化：默认=旧张力公式 postureTone×0.5×τmax/lim，
  //    小量程关节（膝0/踝0/脊柱）自动获得大刚度——这是"同效"的关键；env 可覆盖）──
  const tone = ctx.bal.opt.postureTone;
  const kpNorm = (d0: { tauMax: number; min: number; max: number; name: string; axis: number }): number => {
    const tauKp = d0.axis === 0 && (d0.name === 'hip_l' || d0.name === 'hip_r') ? Math.min(d0.tauMax, 120) : d0.tauMax;
    const lim0 = Math.max(Math.abs(d0.min), Math.abs(d0.max), 0.3);
    return tone * 0.5 * tauKp / lim0;
  };
  const kpLat = Number(500);   // ★ v3：旧版验证值 500（侧向）
  const kpSag = Number(400);   // ★ v3：旧版验证值 400（矢状）
  const kpTw = Number(0);
  const kdLat = Number(16);
  const kdSag = Number(12);
  const kdTw = Number(8);
  // ── 方向项（符号可 env 翻转，便于实测标定）──
  const Kz = Number(2500) * Number(1);   // ★ v3：旧版验证值 2500（=旧 kCom）
  const Kx = Number(2500) * Number(1);
  const Ky = Number(2500) * Number(-1);   // ★ 符号标定：−1（站立后仰漂移的修复）
  const kCopSag = Number(250) * Number(1);   // ★ 符号标定：+1
  // ★ 2026-10-26 删废：`const kCopLat = Number(0) * Number(-1);` 恒 0（原侧向 CoP 项，2026-10-17 已归零）。
  // ── 预算（基于脚上力；用户："预算要基于脚上的力"）──
  const fzS = sen.feet[side === 'l' ? 0 : 1]!.fz;
  const copK = Number(0.7);
  const fw = Number(0.045);   // ★ v3：旧版值（脚半宽 4.5cm）
  // ★ 2026-10-17 用户（'踝部回正力完全不够'）：蹲下状态踝要承重——零重力/蹲姿时
  //   fz=0 → cap 只剩 max(15,...)=15N·m → 踝软。蹲姿给更高地板（承重档）
  const isSquat = baseState() === 'squat';
  // ★ 2026-10-26 删废：原 `const legsClean = isSquat && String('1') === '1';` 只用来包一个
  //   **空的 if 块**（块内只有一段 2026-10-18 的注释，没有任何语句）⇒ 整块删掉。
  const footFloor = Number(baseParams().footFloor);   // ★ 状态参数（baseTable.params）
  const capFootLat = Math.max(footFloor, fzS * fw * copK);
  const capFootSag = Math.max(footFloor, fzS * 0.12 * copK);
  // ── XCoM 需求（CoP 目标）──
  const hgt = Math.max(0.3, com[1]!);
  const w0 = Math.sqrt(9.81 / hgt);
  const xcomX = com[0]! + sen.comVel[0]! / w0;
  const copNowX = sen.feet[side === 'l' ? 0 : 1]!.copX;
  // ★ 2026-10-26 删废：整段「v2 Loop 2（Peterka 双回路）CoP 低通外环」——
  //   它算出的 `_copLpZ / _copLpX` 唯一消费者是下面 foot 的 `- Number(0) * _copLp*`（恒 0，已删）
  //   ⇒ 这段是纯无副作用的空转（6 个量：_cop0Z/_cop0X/_copLpZ/_copLpX/copNowZ/xcomZ）。
  //   注意：**Peterka 延迟环本体（_kernelLoop2）不在这里**，下面单独处理。

  // 站立腿 PD；蹲姿腿由 squat.pairBase 唯一写手，本函数在蹲姿不 propose 腿。
  for (const [jn, ax] of AXES) {
    const di = body.dofByName(`${jn}_${side}`, ax);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.engineMotor) continue;
    // ★ 预环物理锁死 [rest,rest]；蹲姿踝/足扭转轴（轴1）关闭 PD——foot/1 的 21N·m 脏力矩源
    if (d.preRing) continue;
    if (isSquat && /^(foot|ankle)/.test(d.name) && d.axis === 1) continue;
    if (ctx.bal.manual.hasAngle(di) || ctx.bal.manual.torqueOf(di) !== 0) continue;
    const key = `${jn}_${side}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, baseAng(jn, ax) ?? d.angle);   // ★ v3：目标角度表优先（缺省=初态捕获）
    const dev = _ref.get(key)! - d.angle;
    // ★ 2026-10-16 v2 人类版 Loop 2（Peterka 2002 Fig.9）：e' = e + Ktorq·LP(Tc)，Tc=上帧回正力矩
    // ★ 2026-10-20 用户（'把站立重构/只提取'）：Loop2 改走共享内核（参数/默认值原样，行为逐位一致）
    // ★ 2026-10-26 **已恢复**：这一处不是废码——ktorq 现在是 0 所以恒等，但它是标定 Peterka
    //   延迟环的入口（ktorq>0 即生效），属于「可调参数」而非「死代码」。删过头了，恢复。
    const dev2 = _kernelLoop2.dev2(
      `${baseState()}:${key}`, dev,
      Number(0), Number(1.5), Math.round(Number(36)),
    );

    let tau: number;
    let lim: number;
    if (sup) {
      const kpEnv = ax === 0 ? kpLat : ax === 2 ? kpSag : kpTw;
      // ★ 2026-10-26 删废：原 wHip/wKnee/wFoot 三个三元的每一支都是 1.0（`ax===0?1.0:ax===2?1.0:1.0`），
      //   合成 wJ 也恒为 1.0 ⇒ 下面 `* wJ` 等于没乘。策略权重表实际已被写死成"均分"，整组删。
      const hipSqKpMul = isSquat && jn === 'hip' ? Number(baseParams().hipKpMul) : 1;
      const kp = (kpEnv > 0 ? kpEnv : kpNorm(d)) * hipSqKpMul;
      // ★ v3：tqCom（旧版机制）——CoM 回拉 + 链分配（髋.45/膝.15/踝.10/脊柱.30）
      let dir = 0;
      {
        // ★ 2026-10-17 动态参考（用户）：双脚连线中点——身体滑动时参考跟脚走，上身相对脚稳定
        const frI = body.indexByKey.get('foot_r'), flI = body.indexByKey.get('foot_l');
        let tgtC: { x: number; z: number };
        if (frI !== undefined && flI !== undefined) {
          const pr = body.bodies[frI]!.translation(), pl = body.bodies[flI]!.translation();
          tgtC = { x: (pr.x + pl.x) / 2, z: (pr.z + pl.z) / 2 };
        } else {
          tgtC = (ctx.bal as unknown as { getComTarget?: () => { x: number; z: number } }).getComTarget?.() ?? { x: 0, z: 0 };
        }
        // ★ 2026-10-17 用户（'com 按比例分配在下蹲状态要改'）：蹲姿力学——踝/膝多、髋少
        const wCh = isSquat
          ? (jn === 'hip' ? Number(0.25) : jn === 'knee' ? Number(0.30) : jn === 'foot' ? Number(0.45) : 0)
          : (jn === 'hip' ? 0.45 : jn === 'knee' ? 0.15 : jn === 'foot' ? 0.10 : 0);
        if (ax === 0) dir = wCh * Kz * (tgtC.z - com[2]!);        // 侧向（z 轴）
        else if (ax === 2) dir = wCh * Kx * (tgtC.x - com[0]!);   // 矢状（x 轴）
      }
      // CoP 项保留（脚专用）
      // ★ 2026-10-26 删废：原侧向分支 `dir += kCopLat * (xcomZ - copNowZ) - Number(0) * _copLpZ;`
      //   而 kCopLat = Number(0)*Number(-1) = 0、后面那项也 ×0 ⇒ 整行是 `dir += 0`，删。
      //   连带 xcomZ / copNowZ 两个只为它算的量一起删。
      if (jn === 'foot' && ax === 2) dir += kCopSag * (xcomX - copNowX);   // ★ 2026-10-26 删废：去掉尾部 `- Number(0)*_copLpX`（恒 0）
      const bias = Number(e[`SC_B0_${jn.toUpperCase()}${ax}`] ?? baseTorque(jn, ax, sup));   // ★ v3：基础力矩表（分侧；env 可覆盖）
      // ★ 蹲下状态：膝扭转 tau 上限抬高（knee1 目标-36° 被 77 卡住——用户'所有轴要有回正力'）
      const kneeTwFloor = isSquat && jn === 'knee' && ax === 1 ? Number(baseParams().kneeTwFloor) : 0;
      const hipSqFloor = isSquat && jn === 'hip' ? Number(260) : 0;   // ★ 用户：'髋回正力要大'——髋承担大头
      lim = jn === 'foot' ? (ax === 2 ? capFootSag : capFootLat) : Math.max(d.tauMax ?? 200, kneeTwFloor, hipSqFloor);
      // ★ 3 层架构（2026-10-16 用户定调）：回正力=**主动弹簧+方向项**（主动发力）；
      //   单向阻尼归张力层（stability ⓪，被动肌肉张力）；kd 保留给方向项滤波（暂未用）。
      // ★ 2026-10-16 v2 超前项（论文：低频需相位裕度——还没倒就先用力）
      // ★ 2026-10-17 侧向轴镜像：左腿轴0 与右腿反向（物理同向=符号反；gcomp 已正确反号）
      const sgn0 = ax === 0 && side === 'l' ? Number(-1) : 1;   // ★ 镜像方向可测（默认 -1）
      // ★ 2026-10-17 修复正反馈：sgn0 只镜像 bias+dir（世界物理方向）；弹簧 dev 在关节自身坐标系→不镜像
      tau = sgn0 * (bias + dir) + pdDev(kp, Number(0), dev2, d.vel);   // ★ 内核
    } else {
      // 摆动腿：回标准弹簧（无方向项）+ 静偏置（同款量程归一化）
      // ★ 2026-10-26 删废：原 `kpEnvS = ax===0?0 : ax===2?0 : 0` 三支全是 0，
      //   `kp = kpEnvS > 0 ? kpEnvS : kpNorm(d)` 永远走后者 ⇒ 直接写 kpNorm(d)。
      const kp = kpNorm(d);
      const bias = Number(e[`SW_${jn.toUpperCase()}${ax}`] ?? baseTorque(jn, ax, false));   // ★ v3：摆动侧表值（旧版 80/−55）
      lim = d.tauMax ?? 200;
      const sgn0s = ax === 0 && side === 'l' ? Number(-1) : 1;
      tau = sgn0s * bias + pdDev(kp, Number(0), dev2, d.vel);   // ★ 内核
    }
    const cl = clamp(tau, lim);   // ★ 内核
    // ★ 2026-10-16 频段分离：回正力=低频（截止 SC_LP Hz，默认 3）——高频扰动交给张力阻尼
    const fcLp = Number(1000);   // ★ 2026-10-16 回退：低通默认关（3Hz 会滤掉 19Hz 平衡机制→0.95s 倒）
    const aLp = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * fcLp);
    const lpPrev = _lp.get(key) ?? cl;
    const clLp = lpPrev + (cl - lpPrev) * aLp;
    _lp.set(key, clLp);
        _kernelLoop2.write(`${baseState()}:${key}`, clLp);   // ★ 内核同步力矩历史
    if (Math.abs(clLp) < 0.5) continue;
    if (!isSquat && !ctx.bal.manual.hasAngle(di)) propose({ dof: di, kind: 'torque', pri: PRI.action, tau: clLp, src: 'supportClean' });   // ★ 蹲姿禁用 legacy
  }

  // ── 上肢/颈姿态保持（§4.2.4/4.2.5）——★ 2026-10-16 补齐：旧张力层弹簧覆盖全身，
  //    干净版漏了肩/肘/颈（15 轴）→ 手臂自由甩动反作用鞭翻躯干（"四足/翻转"真身之一）──
  const kpArmEnv = Number(baseParams().armKp ?? 0);   // ★ 状态表（0=kpNorm）   // 0=逐关节量程归一化
  for (const [jn, ax] of ARM_AXES) {
    const di = body.dofByName(jn, ax);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.engineMotor) continue;
    if (d.preRing) continue;
    // ★★★ 2026-10-18 用户（'为什么上身没有力'）：蹲姿脊柱/颈**只写基础力表**（bias，无弹簧）——
    //   CH 回读：腰需求-116 实际+1 缺口118；表值 sup_spine12=-117 却没写手读 → 在此接上
    // ★★★ 2026-10-18 用户（'两个胳膊是乱动的'）：手臂接上 **sqCorr PD**（每轴回正，架构统一）——
    //   此前只有张力阻尼（裸手臂=乱动）；PD 的 kp=I×ω² 对轻手臂天然极小 ✓
    if (baseState() === 'squat') {
      const keyA2 = `${jn}:${ax}`;
      if (!_ref.has(keyA2)) _ref.set(keyA2, d.angle);
      const wA = Number(baseParams().corrW ?? 3);
      const IA = Math.max(1e-4, d.inertia);
      const upMulA = Number(0.5);   // ★ 上身削弱
      const kpA2 = IA * wA * wA * upMulA;
      const kdA2 = 2 * IA * wA * upMulA;
      const tauA2 = kpA2 * (_ref.get(keyA2)! - d.angle) - kdA2 * d.vel;
      if (Math.abs(tauA2) > 0.05) propose({ dof: di, kind: 'torque', pri: PRI.action, tau: tauA2, src: 'supportClean.arm' });   // ★ 蹲姿手臂/颈 PD（原 !isSquat 门是死代码）
      continue;
    }
    // ★ 2026-10-26 删废：`const kpArmSquat = 0;` —— 唯一用途是下面 `+ kpArmSquat`，恒等于加 0。
    // ★ 2026-10-17 动作接管让位（用户："写动作的时候屏蔽伺服"）——动作声明接管则手臂伺服跳过
    if (ctx.bal.manual.hasAngle(di)) continue;
    const key = `${jn}:${ax}`;
    // ★ 2026-10-26 删废：原来这里有 `const isSquatS = baseState() === 'squat';`，
    //   但本循环上面第 246 行的蹲姿分支已经 `continue`，走到这里 state 必然不是 'squat'
    //   ⇒ isSquatS 恒为 false，它保护的三处（baseAng 目标 / 几何俯仰偏差 / kpArmSquat）全是死代码。
    if (!_ref.has(key)) _ref.set(key, d.angle);
    const dev = _ref.get(key)! - d.angle;
    const lim = d.tauMax ?? 200;
    const kpArm = kpArmEnv > 0 ? kpArmEnv : kpNorm(d);
    const tau = clamp(kpArm * dev, lim);
    if (Math.abs(tau) < 0.5) continue;
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'supportClean.arm' });
  }
}

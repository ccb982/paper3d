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
import { baseTq, baseAng, baseState, baseParams } from './baseTable';   // ★ v3：基础力矩表+目标角度表
import type { ServoRefs } from './supportReg';
import { rescueOffsets } from './rescue';
import { virtualLeg } from './virtualLeg';   // ★ 虚拟腿协同（用户：'把下身固定'）

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
let _cop0Z: number | null = null, _cop0X: number | null = null;   // Loop2 CoP 基线
let _copLpZ = 0, _copLpX = 0;   // Loop2 低通 CoP
let _tcFrame = 0;   // v2 Loop2 帧计数
const _tauHist = new Map<string, Float64Array>();   // v2 Loop2: τ 环缓冲（延迟用）
const _tcLp = new Map<string, number>();      // v2 Loop2: 低通 Tc
let _com0: { x: number; y: number; z: number } | null = null;
export function supportCleanReset(): void {
  _ref.clear();
  _lp.clear();
  _cop0Z = null; _cop0X = null; _copLpZ = 0; _copLpX = 0;
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
  const kpLat = Number(e.SC_KP_LAT ?? 500);   // ★ v3：旧版验证值 500（侧向）
  const kpSag = Number(e.SC_KP_SAG ?? 400);   // ★ v3：旧版验证值 400（矢状）
  const kpTw = Number(e.SC_KP_TW ?? 0);
  const kdLat = Number(e.SC_KD_LAT ?? 16);
  const kdSag = Number(e.SC_KD_SAG ?? 12);
  const kdTw = Number(e.SC_KD_TW ?? 8);
  // ── 方向项（符号可 env 翻转，便于实测标定）──
  const Kz = Number(e.SC_KZ ?? 2500) * Number(e.SC_SGN_Z ?? 1);   // ★ v3：旧版验证值 2500（=旧 kCom）
  const Kx = Number(e.SC_KX ?? 2500) * Number(e.SC_SGN_X ?? 1);
  const Ky = Number(e.SC_KY ?? 2500) * Number(e.SC_SGN_Y ?? -1);   // ★ 符号标定：−1（站立后仰漂移的修复）
  const kCopLat = Number(e.SC_KCOP_LAT ?? 0) * Number(e.SC_SGN_COPLAT ?? -1);   // ★ 2026-10-17 归零：侧向 CoP 项=左腿发散源（53→24 N·m）
  const kCopSag = Number(e.SC_KCOP_SAG ?? 250) * Number(e.SC_SGN_COPSAG ?? 1);   // ★ 符号标定：+1
  // ── 预算（基于脚上力；用户："预算要基于脚上的力"）──
  const fzS = sen.feet[side === 'l' ? 0 : 1]!.fz;
  const copK = Number(e.SC_COPK ?? 0.7);
  const fw = Number(e.SC_FOOTW ?? 0.045);   // ★ v3：旧版值（脚半宽 4.5cm）
  // ★ 2026-10-17 用户（'踝部回正力完全不够'）：蹲下状态踝要承重——零重力/蹲姿时
  //   fz=0 → cap 只剩 max(15,...)=15N·m → 踝软。蹲姿给更高地板（承重档）
  const isSquat = baseState() === 'squat';
  // ★★★ 2026-10-18 用户（'在目标姿态下还有写手——先把目标姿态下的写手都请了'）：
  //   蹲姿=静态保持，除基础力(ff)外其他写手（弹簧/方向项/CoP/超前）全部让位——
  //   多写手对拉=抽搐源。SQ_LEGS_CLEAN=0 可回退对照。
  const legsClean = isSquat && String(e.SQ_LEGS_CLEAN ?? '1') === '1';
  const footFloor = Number(e.SC_FOOT_FLOOR ?? baseParams().footFloor);   // ★ 状态参数（baseTable.params）
  const capFootLat = Math.max(footFloor, fzS * fw * copK);
  const capFootSag = Math.max(footFloor, fzS * 0.12 * copK);
  // ── XCoM 需求（CoP 目标）──
  const hgt = Math.max(0.3, com[1]!);
  const w0 = Math.sqrt(9.81 / hgt);
  const xcomX = com[0]! + sen.comVel[0]! / w0;
  const xcomZ = com[2]! + sen.comVel[2]! / w0;
  const copNowX = sen.feet[side === 'l' ? 0 : 1]!.copX;
  const copNowZ = sen.feet[side === 'l' ? 0 : 1]!.copZ;
  // ★ 2026-10-16 v2 Loop 2（Peterka 双回路）：低通 CoP 反馈（CoP∝踝力矩；机器人模型=反号缩放后从角度误差减）
  {
    if (_cop0Z === null) { _cop0Z = copNowZ; }
    if (_cop0X === null) { _cop0X = copNowX; }
    const copFc = Number(e.SC_LOOP2_FC ?? 1.5);
    const aCop = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * copFc);
    _copLpZ += ((copNowZ - _cop0Z) - _copLpZ) * aCop;
    _copLpX += ((copNowX - _cop0X) - _copLpX) * aCop;
  }

  // ★★★ 2026-10-18 用户（'试试肌肉路径/本来就是人类样式的仿真'）：蹲姿腿=**肌肉对**（共收缩 C）——
  //   站立同款的双肌模型（drive：K=1100×C×dev + 稳定阻尼帽）：人类蹲姿=股四头/腘绳共收缩锁腿。
  //   机制：pair 上岗 → 扭矩提案自动让位（control.ts:102）→ 与 sqCorr 不叠加。
  if (isSquat && String(e.SQB_ON ?? '1') === '1' && String(e.SQ_PAIR ?? '1') === '1') {
    const cPair = Number(e.SQ_PAIR_C ?? 0.7);
    for (const side2 of ['l', 'r'] as const) {
      for (const jn2 of ['hip', 'knee', 'foot'] as const) {
        for (const ax2 of [0, 2] as const) {
          const di2 = body.dofByName(`${jn2}_${side2}`, ax2);
          if (di2 < 0) continue;
          const d2 = body.dofs[di2]!;
          if (d2.engineMotor) continue;
          const keyQ2 = `${jn2}_${side2}:${ax2}`;
          // ★ ref=实际捕获角（★修：baseAng 表是过期值——膝表-119° vs 实际-66°=53°dev 混沌源）
          //   静置期持续重捕（速度≈0=零受力静止）；释放后速度起来即锁定
          if (!_ref.has(keyQ2) || Math.abs(d2.vel) < 0.02) _ref.set(keyQ2, d2.angle);
          propose({ dof: di2, kind: 'pair', pri: PRI.action, c: cPair, rad: _ref.get(keyQ2)!, src: 'supportClean.musclePair' });
        }
      }
    }
  }
  // ★★★ 2026-10-18 用户（'把下身固定'/'看论文'）：虚拟腿协同——先算（每帧一次），逐关节路径跳过髋/膝矢状
  if (isSquat && String(e.SQB_ON ?? '1') === '1' && String(e.SQ_VLEG ?? '1') === '1') {
    for (const [vdof, vtau] of virtualLeg(body)) {
      if (Math.abs(vtau) > 0.5) propose({ dof: vdof, kind: 'torque', pri: PRI.action, tau: vtau, src: 'supportClean.virtualLeg' });
    }
  }
  for (const [jn, ax] of AXES) {
    const di = body.dofByName(`${jn}_${side}`, ax);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.engineMotor) continue;
    // ★★★ 2026-10-18 用户（'把下身固定'/'看论文'）：虚拟腿协同（髋+膝锁成一个自由度）——
    //   腿的矢状伸缩由 virtualLeg 模块负责（虚功分配），逐关节路径跳过这两个 dof。
    if (isSquat && String(e.SQB_ON ?? '1') === '1' && String(e.SQ_VLEG ?? '1') === '1'
        && (jn === 'hip' || jn === 'knee') && ax === 2) continue;
    // ★★★ 2026-10-18 用户（'快实装吧'）：蹲姿=站立方式的干净版——基础力表 + 姿态弹簧 + 阻尼
    //   （无方向项/CoP/loop2/超前=预测层全无）。静态实测：弹簧一挂姿势就稳（不稳定平衡必须反馈）。
    if (legsClean) {
      // ★★★ 2026-10-18 用户（'你得自己算回正力，用很小的力矩'）：**临界阻尼 PD（从惯量算）**——
      //   kp = I×ω²、kd = 2I×ω（ω=3 rad/s 姿势带宽）——髋 kp≈4.5/kd≈3（不是拍脑袋的 80！）
      if (String(e.SQB_ON ?? '1') === '1' && String(e.SQ_CORR ?? '1') === '1') {   // ★ 用户（'把旧版肌肉对弄进去'）：SQ_CORR=0 只留肌肉对
        // ★★★ 2026-10-18 用户（'回正力别动脚'→'脚还在乱动怎么改'）：
        //   踝=**纯阻尼吸收**（腿的乱动全交给踝——kd 吃上游振动，kp=0 不拉位置不碰姿势）
        const keyQ = `${jn}_${side}:${ax}`;
        if (!_ref.has(keyQ)) _ref.set(keyQ, d.angle);
        const wQ = Number(e.SQ_CORR_W ?? baseParams().corrW ?? 3);
        const I0 = Math.max(1e-4, d.inertia);
        // ★ 用户（'腿关节侧向轴的回正力不够'）：轴0 单独倍率（侧向=外展/内收）
        const mulA0 = ax === 0 ? Number(e.SQ_CORR_M0 ?? 3) : 1;
        // ★ 用户（'髋部回正力需要大增强'）：髋单独倍率
        const mulHip = jn === 'hip' ? Number(e.SQ_CORR_MHIP ?? 1) : 1;   // ×8 实测：髋夹住但躯干反作用加速折叠 → 回 1
        const mulKnee = jn === 'knee' ? Number(e.SQ_CORR_MKNEE ?? 5) : 1;   // ★ 用户（'膝盖回正力不够'）

        const kpQ = I0 * wQ * wQ * mulA0 * mulHip * mulKnee;
        const kdQ = 2 * I0 * wQ * mulA0 * Math.min(mulHip * mulKnee, 3);
        // ★ com 写手：方向项（站立同款：目标 CoM − 实际 CoM，链权重分配）
        let dirQ = 0;
        if (ax === 0 || ax === 2) {
          const tgt = (ctx.bal as unknown as { getComTarget?: () => { x: number; z: number } }).getComTarget?.() ?? { x: 0, z: 0 };
          // ★ 用户（'上身为主'）：CoM 平衡的链权重——髋/脊柱为主，脚=0（不走脚）
          const wChS = jn === 'hip' ? Number(e.SC_W_SQ_HIP ?? 0.4) : jn === 'knee' ? Number(e.SC_W_SQ_KNEE ?? 0.1) : jn === 'foot' ? 0 : 0;
          // ★ 侧向（轴0）用站立量级 Kz；矢状（轴2）用小 Kx
          const KcS = ax === 0 ? Number(e.SQ_COM_KZ ?? 3000) : Number(e.SQ_COM_K ?? 200);   // ★ 用户（'侧向回正不够/腿要牢牢在下面'）：1500→3000 实测下沉浅 5.6cm
          dirQ = ax === 0 ? wChS * KcS * (tgt.z - com[2]!) : wChS * KcS * (tgt.x - com[0]!);
        }

        const tauQ = (jn === 'foot' ? 0 : kpQ * (_ref.get(keyQ)! - d.angle)) - (jn === 'foot' ? kdQ * 2 : kdQ) * d.vel + (jn === 'foot' ? 0 : dirQ);
        if (Math.abs(tauQ) > 0.5) propose({ dof: di, kind: 'torque', pri: PRI.action, tau: tauQ, src: 'supportClean.sqCorr' });
        continue;
      }
      // ★★★ 2026-10-18 用户（'从踝到髋直接托起来'）：**虚拟直连通道**——
      //   踝（地面路径起点）的软弹簧力，原样传到髋（直连托举骨盆），不在每关节挂弹簧
      const biasOnly = Number(e[`SC_B0_${jn.toUpperCase()}${ax}`] ?? baseTq(jn, ax, true));
      const sgn0c = ax === 0 && side === 'l' ? Number(e.SC_MIRROR_L ?? -1) : 1;
      let tauC = sgn0c * biasOnly;
      // ★★★ 2026-10-18 用户（'髋的力也是可以直接给踝的'）：髋的力反向直连给踝（走地面路径，不拽脚）
      if (jn === 'hip' && ax === 2) {
      }
      // ★★★ 2026-10-18 用户（'删掉不必要的写手/脚就应该是基础力和重力'）：
      //   脚（踝）上只剩**基础力表**（tauC=bias）；踝弹簧/髋→踝全部删除
      if (Math.abs(tauC) > 0.5) propose({ dof: di, kind: 'torque', pri: PRI.action, tau: tauC, src: 'supportClean.sqChain' });
      continue;
    }
    const key = `${jn}_${side}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, baseAng(jn, ax) ?? d.angle);   // ★ v3：目标角度表优先（缺省=初态捕获）
    const dev = _ref.get(key)! - d.angle;
    // ★ 2026-10-16 v2 人类版 Loop 2（Peterka 2002 Fig.9）：e' = e + Ktorq·LP(Tc)，Tc=上帧回正力矩
    const torqFc = Number(e.SC_LOOP2_FC ?? 1.5);
    const aT = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * torqFc);
    const buf = _tauHist.get(key) ?? new Float64Array(64);
    if (!_tauHist.has(key)) _tauHist.set(key, buf);
    const delayF = Math.round(Number(e.SC_LOOP2_DELAY ?? 36));   // 150ms@240Hz
    const tcPrev = buf[((_tcFrame - delayF) % 64 + 64) % 64]!;
    const tcLp = (_tcLp.get(key) ?? 0) + (tcPrev - (_tcLp.get(key) ?? 0)) * aT;
    _tcLp.set(key, tcLp);
    const dev2 = dev + Number(e.SC_KTORQ ?? 0) * tcLp;

    let tau: number;
    let lim: number;
    if (sup) {
      const kpEnv = ax === 0 ? kpLat : ax === 2 ? kpSag : kpTw;
      // ★ 2026-10-17 修正权重表（人体策略的参数化——干净可控：改表=改策略）
      //   侧向=髋策略（髋主导）/ 矢状=踝策略（脚主导）/ 扭转=均分
      // （默认全 1.0=现状；策略权重待标定——表结构保留供可控调参）
      const wHip = ax === 0 ? Number(e.SC_W_HIP_LAT ?? 1.0) : ax === 2 ? Number(e.SC_W_HIP_SAG ?? 1.0) : 1.0;
      const wKnee = ax === 0 ? Number(e.SC_W_KNEE_LAT ?? 1.0) : ax === 2 ? Number(e.SC_W_KNEE_SAG ?? 1.0) : 1.0;
      const wFoot = ax === 0 ? Number(e.SC_W_FOOT_LAT ?? 1.0) : ax === 2 ? Number(e.SC_W_FOOT_SAG ?? 1.0) : 1.0;
      const wJ = jn === 'hip' ? wHip : jn === 'knee' ? wKnee : jn === 'foot' ? wFoot : 1.0;
      const hipSqKpMul = isSquat && jn === 'hip' ? Number(e.SC_HIP_KP_MUL ?? baseParams().hipKpMul) : 1;
      const kp = (kpEnv > 0 ? kpEnv : kpNorm(d)) * wJ * hipSqKpMul;
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
          ? (jn === 'hip' ? Number(e.SC_W_SQ_HIP ?? 0.25) : jn === 'knee' ? Number(e.SC_W_SQ_KNEE ?? 0.30) : jn === 'foot' ? Number(e.SC_W_SQ_FOOT ?? 0.45) : 0)
          : (jn === 'hip' ? 0.45 : jn === 'knee' ? 0.15 : jn === 'foot' ? 0.10 : 0);
        if (ax === 0) dir = wCh * Kz * (tgtC.z - com[2]!);        // 侧向（z 轴）
        else if (ax === 2) dir = wCh * Kx * (tgtC.x - com[0]!);   // 矢状（x 轴）
      }
      // CoP 项保留（脚专用）
      if (jn === 'foot' && ax === 0) dir += kCopLat * (xcomZ - copNowZ) - Number(e.SC_LOOP2 ?? 0) * _copLpZ;
      else if (jn === 'foot' && ax === 2) dir += kCopSag * (xcomX - copNowX) - Number(e.SC_LOOP2 ?? 0) * _copLpX;
      const bias = Number(e[`SC_B0_${jn.toUpperCase()}${ax}`] ?? baseTq(jn, ax, sup));   // ★ v3：基础力矩表（分侧；env 可覆盖）
      // ★ 蹲下状态：膝扭转 tau 上限抬高（knee1 目标-36° 被 77 卡住——用户'所有轴要有回正力'）
      const kneeTwFloor = isSquat && jn === 'knee' && ax === 1 ? Number(e.SC_KNEE_TW_FLOOR ?? baseParams().kneeTwFloor) : 0;
      const hipSqFloor = isSquat && jn === 'hip' ? Number(e.SC_HIP_SQ_FLOOR ?? 260) : 0;   // ★ 用户：'髋回正力要大'——髋承担大头
      lim = jn === 'foot' ? (ax === 2 ? capFootSag : capFootLat) : Math.max(d.tauMax ?? 200, kneeTwFloor, hipSqFloor);
      // ★ 3 层架构（2026-10-16 用户定调）：回正力=**主动弹簧+方向项**（主动发力）；
      //   单向阻尼归张力层（stability ⓪，被动肌肉张力）；kd 保留给方向项滤波（暂未用）。
      // ★ 2026-10-16 v2 超前项（论文：低频需相位裕度——还没倒就先用力）
      // ★ 2026-10-17 侧向轴镜像：左腿轴0 与右腿反向（物理同向=符号反；gcomp 已正确反号）
      const sgn0 = ax === 0 && side === 'l' ? Number(e.SC_MIRROR_L ?? -1) : 1;   // ★ 镜像方向可测（默认 -1）
      // ★ 2026-10-17 修复正反馈：sgn0 只镜像 bias+dir（世界物理方向）；弹簧 dev 在关节自身坐标系→不镜像
      tau = sgn0 * (bias + dir) + kp * dev2 + Number(e.SC_LEAD ?? 0) * -d.vel;
    } else {
      // 摆动腿：回标准弹簧（无方向项）+ 静偏置（同款量程归一化）
      const kpEnvS = ax === 0 ? Number(e.SW_KP_LAT ?? 0) : ax === 2 ? Number(e.SW_KP_SAG ?? 0) : Number(e.SW_KP_TW ?? 0);
      const kp = kpEnvS > 0 ? kpEnvS : kpNorm(d);
      const bias = Number(e[`SW_${jn.toUpperCase()}${ax}`] ?? baseTq(jn, ax, false));   // ★ v3：摆动侧表值（旧版 80/−55）
      lim = d.tauMax ?? 200;
      const sgn0s = ax === 0 && side === 'l' ? Number(e.SC_MIRROR_L ?? -1) : 1;
      tau = sgn0s * bias + kp * dev2 + Number(e.SC_LEAD ?? 0) * -d.vel;
    }
    const cl = Math.max(-lim, Math.min(lim, tau));
    // ★ 2026-10-16 频段分离：回正力=低频（截止 SC_LP Hz，默认 3）——高频扰动交给张力阻尼
    const fcLp = Number(e.SC_LP ?? 1000);   // ★ 2026-10-16 回退：低通默认关（3Hz 会滤掉 19Hz 平衡机制→0.95s 倒）
    const aLp = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * fcLp);
    const lpPrev = _lp.get(key) ?? cl;
    const clLp = lpPrev + (cl - lpPrev) * aLp;
    _lp.set(key, clLp);
    (_tauHist.get(key) ?? new Float64Array(64))[_tcFrame % 64] = clLp;
    if (Math.abs(clLp) < 0.5) continue;
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau: clLp, src: 'supportClean' });
  }

  // ── 上肢/颈姿态保持（§4.2.4/4.2.5）——★ 2026-10-16 补齐：旧张力层弹簧覆盖全身，
  //    干净版漏了肩/肘/颈（15 轴）→ 手臂自由甩动反作用鞭翻躯干（"四足/翻转"真身之一）──
  const kpArmEnv = Number(e.SC_KP_ARM ?? 0);   // 0=逐关节量程归一化
  const armOff = String(e.ARM_OFF ?? '0') === '1';   // ★ 手臂控制全关（被动测试）
  for (const [jn, ax] of ARM_AXES) {
    if (armOff) break;
    const di = body.dofByName(jn, ax);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.engineMotor) continue;
    // ★★★ 2026-10-18 用户（'为什么上身没有力'）：蹲姿脊柱/颈**只写基础力表**（bias，无弹簧）——
    //   CH 回读：腰需求-116 实际+1 缺口118；表值 sup_spine12=-117 却没写手读 → 在此接上
    if (baseState() === 'squat' && /^(neck|spine)/.test(jn)) {
      // ★ 脊柱同款站立式架构，参数单独调
      const keySp2 = `${jn}:${ax}`;
      if (!_ref.has(keySp2)) _ref.set(keySp2, d.angle);
      const wS = Number(e.SQ_CORR_W ?? baseParams().corrW ?? 3);
      const I1 = Math.max(1e-4, d.inertia);
      const kpSp2 = I1 * wS * wS;
      const kdSp2 = 2 * I1 * wS;   // 回退（同腿）
      const tauSp2 = kpSp2 * (_ref.get(keySp2)! - d.angle) - kdSp2 * d.vel;
      if (Math.abs(tauSp2) > 0.5) propose({ dof: di, kind: 'torque', pri: PRI.action, tau: tauSp2, src: 'supportClean.sqCorr' });
      continue;
    }
    // ★★★ 2026-10-18 用户（'两个胳膊是乱动的'）：手臂接上 **sqCorr PD**（每轴回正，架构统一）——
    //   此前只有张力阻尼（裸手臂=乱动）；PD 的 kp=I×ω² 对轻手臂天然极小 ✓
    if (baseState() === 'squat') {
      const keyA2 = `${jn}:${ax}`;
      if (!_ref.has(keyA2)) _ref.set(keyA2, d.angle);
      const wA = Number(e.SQ_CORR_W ?? baseParams().corrW ?? 3);
      const IA = Math.max(1e-4, d.inertia);
      const kpA2 = IA * wA * wA;
      const kdA2 = 2 * IA * wA;
      const tauA2 = kpA2 * (_ref.get(keyA2)! - d.angle) - kdA2 * d.vel;
      if (Math.abs(tauA2) > 0.05) propose({ dof: di, kind: 'torque', pri: PRI.action, tau: tauA2, src: 'supportClean.sqCorr' });
      continue;
    }
    const kpArmSquat = 0;
    // ★ 2026-10-17 动作接管让位（用户："写动作的时候屏蔽伺服"）——动作声明接管则手臂伺服跳过
    if (ctx.bal.manual.hasAngle(di)) continue;
    const key = `${jn}:${ax}`;
    // ★★★★★ 2026-10-17 用户（'你的改动让正常站着也出问题了'）：**必须状态门**——
    //   蹲下状态专属逻辑不得泄漏到站立！站立保持原行为（捕获式）。
    const isSquatS = baseState() === 'squat';
    if (!_ref.has(key)) _ref.set(key, (isSquatS ? baseAng(jn, ax) : undefined) ?? d.angle);
    let dev = _ref.get(key)! - d.angle;
    // 蹲姿专属：脊柱矢状轴读数(rotvec)与物理脱节 → 几何实测（spine3 世界俯仰）
    if (isSquatS && ax === 2 && jn === 'spine1') {   // ★ 用户：'盆骨回正、不需要脊柱自己弯'——几何偏差只给腰段（盆骨-躯干关节）
      const i3 = body.indexByKey.get('spine3');
      if (i3 !== undefined) {
        const q3 = body.bodies[i3]!.rotation();
        const upx = 2 * (q3.x * q3.y - q3.w * q3.z), upy = 1 - 2 * (q3.x * q3.x + q3.z * q3.z);
        const pitch = Math.atan2(upx, upy);
        const tgt = Number(e.TR_SAG_TGT ?? 0.65);   // ★ 用户：'脊柱不需要弯这么多'（1.15→0.65，约37°）
        dev = (pitch - tgt);   // ★ 全部给腰段（原来/3分三段——腰硬的原因）
      }
    }
    const lim = d.tauMax ?? 200;
    const kpArm = (kpArmEnv > 0 ? kpArmEnv : kpNorm(d)) + kpArmSquat;
    const tau = Math.max(-lim, Math.min(lim, kpArm * dev));
    if (Math.abs(tau) < 0.5) continue;
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'supportClean.arm' });
  }
}

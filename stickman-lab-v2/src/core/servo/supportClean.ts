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

const envOf = (): Record<string, string | undefined> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
const _refPair = new Map<string, number>();   // ★ 肌肉对专属捕获 map（与 sqCorr 隔离）
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
  // ★★★ 站立迁移试验（用户：'可以把站立也迁移过来'）：ST_PAIR=1 时站立也用肌肉对（回正力）
  //   基础力站立已有（gcomp 的 antiG 通道）；ref=站立目标（baseAng 表 S 形）
  if (!isSquat && String(e.ST_PAIR ?? '1') === '1') {   // ★ 用户：转默认（站立全面肌肉化；ST_PAIR=0 回退对照）
    const cSt = Number(e.ST_PAIR_C ?? 0.6);
    for (const side3 of ['l', 'r'] as const) {
      // ★ 重做回正力（J行发现：脊柱双写对打）——测试：肌肉不写脊柱（ST_SPINE_OFF=1，gcomp单独管）
      // ★ 重做回正力定稿（J行发现）：**脊柱归 gcomp（基础力），肌肉只管腿**——实测完美站立（roll 3.2°）
      const jns3 = String(e.ST_SPINE_OFF ?? '1') === '1' ? ['hip', 'knee', 'foot'] as const : ['hip', 'knee', 'foot', 'spine1', 'spine2', 'spine3'] as const;
      for (const jn3 of jns3) {
        for (const ax3 of [0, 2] as const) {
          let di3 = body.dofByName(`${jn3}_${side3}`, ax3);
          if (di3 < 0) di3 = body.dofByName(jn3, ax3);
          if (di3 < 0) continue;
          const d3 = body.dofs[di3]!;
          const key3 = `ST:${jn3}_${side3}:${ax3}`;
          if (!_refPair.has(key3)) _refPair.set(key3, baseAng(jn3, ax3) ?? d3.angle);
          propose({ dof: di3, kind: 'pair', pri: PRI.action, c: cSt, rad: _refPair.get(key3)!, src: 'supportClean.muscleStand' });
        }
      }
    }
  }
  if (isSquat && String(e.SQB_ON ?? '1') === '1' && String(e.SQ_PAIR ?? '1') === '1') {
    const cPair = Number(e.SQ_PAIR_C ?? 0.7);

    for (const side2 of ['l', 'r'] as const) {
      // ★★★ 2026-10-19 用户（'手臂乱动，固定一下手臂'）：肩/肘加入肌肉对——
        //   蹲姿臂 PD 已让位（squatArmSkip）→ 臂只靠张力=乱甩；肌肉对固定到法庭捕获角
        for (const jn2 of ['hip', 'knee', 'foot', 'spine1', 'spine2', 'spine3', 'shoulder', 'elbow'] as const) {
        // ★ 轴1（扭转）覆盖实验：更差（1395）——回退（扭转保持自由，或需专门的软处理）
        // ★ 用户（'肌肉对不是用来执行回正力的吗'）：**全轴覆盖**（每个轴都要有——原始设计）
        for (const ax2 of [0, 1, 2] as const) {
          let di2 = body.dofByName(`${jn2}_${side2}`, ax2);
          if (di2 < 0) di2 = body.dofByName(jn2, ax2);   // ★ 脊柱无左右（spine1/spine2/spine3 中心骨）
          if (di2 < 0) continue;
          const d2 = body.dofs[di2]!;
          if (d2.engineMotor) continue;
          const keyQ2 = `${jn2}_${side2}:${ax2}`;
          // ★ ref=实际捕获角（baseAng 是过期值）；★ 重捕只在静置期（法庭门控——|vel|判定会追慢漂移=dev永远0）
          // ★ 修（EPDBG 实锤 flag 卡死）: 本地帧计数判定静置期（2.0s=480帧，dt=1/240）——不依赖跨模块标志
          const gF2 = globalThis as { __SQ_FRAME?: number };
          gF2.__SQ_FRAME = (gF2.__SQ_FRAME ?? 0) + 1;
          const settling = gF2.__SQ_FRAME <= 480;
          // ★★★ 2026-10-19 用户（'统一！！架构准则'）：ref 单一真相源=法庭 ang0（放开瞬间同刻同源）
          // ★★★ 2026-10-19 用户（'能不能删了重构'）：**目标姿态=单一源，无本地缓存**——
          //   ref 每帧直读法庭的 __COURT_ANG0（删除 _refPair 的蹲姿路径 + 回退 + 自举）
          const courtAng = (globalThis as { __COURT_ANG0?: Map<number, number> }).__COURT_ANG0;
          const refQ = courtAng?.get(di2) ?? d2.angle;   // 法庭未发布时=当前角（无害）
          // ★★ 平衡写手迁移（用户：'写手全给肌肉对'）：CoM 方向项 → **ref 偏移（EP 平衡点）**——
          //   平衡层只出需求，肌肉对出力（脚不接：只抓地）
          let epShift = 0;
          if (jn2 !== 'foot') {
            // ★★★ 修（EPDBG 实锤）: getComTarget 返回实时 CoM → 误差恒 0 → EP 天然无效！
            //   正解: 平衡目标=**释放瞬间捕获的 CoM**（固定），误差=目标−当前
            const gT = globalThis as { __BAL_TGT?: { x: number; z: number } };
            if (!gT.__BAL_TGT || settling) gT.__BAL_TGT = { x: com[0]!, z: com[2]! };   // 静置期持续跟，释放后冻结
            // ★★★ 2026-10-19 用户（'改吧'→论文标准做法 Sugihara 2002/Kajita 2003）：
            //   **CoM 不进关节目标！**（epShift 删除——改目标=每帧破坏标准姿势=回正力永远拉不到真目标）
            //   CoM 回正走**踝关节（CoP 控制）**——脚不动时 CoM 的唯一执行器！见下方 ankleCoP 块
            void gT;
          }
          // ★ 重做：sqCorr 的部位倍率肌肉化（轴0×3/膝×5——旧写手的活被肌肉参数吸收）
          // ★★★ 用户（'肌肉对不是用来执行回正力的吗'）：**kmul 回 1**——
          //   sqCorr 的 3/5 是老 PD 的标定；肌肉的刚度=C×K（自然值），不需要外来倍率
          const kmul = 1;
          if (String(e.SQ_EPDBG ?? '0') === '1' && jn2 === 'hip' && side2 === 'r' && ax2 === 2) {
            const gE = globalThis as { __EPN?: number };
            gE.__EPN = (gE.__EPN ?? 0) + 1;
            if (gE.__EPN % 240 === 60) {
              const gR = globalThis as { __PUBREF?: Map<number, number> };
              console.log(`EPDBG ref=${refQ.toFixed(3)}(${(refQ * 57.3).toFixed(1)}°) courtAng===PUBREF? ${courtAng === gR.__PUBREF} courtAng.get20=${courtAng?.get(20)?.toFixed(3)} PUBREF.get20=${gR.__PUBREF?.get(20)?.toFixed(3)}`);
            }
          }
          propose({ dof: di2, kind: 'pair', pri: PRI.action, c: cPair, rad: refQ + epShift, kmul, src: 'supportClean.musclePair' });

        }
      }
    }
    // ★★★ 2026-10-19 用户（'改吧'→论文 Sugihara 2002/Kajita 2003）：**踝 CoP 控制**（CoM 回正的唯一执行器）——
    //   LIPM: ẍ=ω₀²(x−cop)；CoP 目标 = 捕获点式: cop* = x* + (v/ω₀)×damp
    //   踝力矩 τ = −N×(cop* − x_ankle)（GRF 绕踝的矩）；CoP 钳位在脚内（±SQ_COP_CLAMP）
    {
      const gT2 = globalThis as { __BAL_TGT?: { x: number; z: number } };
      const tx = gT2.__BAL_TGT?.x ?? com[0]!;
      const cv2 = new Float64Array(3);
      body.comVel(cv2);
      const vx = cv2[0]!;
      const hCom = Math.max(0.1, com[1]!);          // CoM 高度（米）
      const om0 = Math.sqrt(9.81 / hCom);           // LIPM ω₀
      const damp = Number(e.SQ_COP_DAMP ?? 0.7);    // 捕获点阻尼（0.5-1.0）
      const copClamp = Number(e.SQ_COP_CLAMP ?? 0.12);   // 脚内钳位（米）
      const fpos2 = (side: 'l' | 'r'): { x: number; z: number } => {
        const bi = body.indexByKey.get(`foot_${side}`);
        if (bi === undefined) return { x: 0, z: 0 };
        const t2 = body.bodies[bi]!.translation();
        return { x: t2.x, z: t2.z };
      };
      let mTot2 = 0;
      for (const rb of body.bodies) mTot2 += rb.mass();
      const W2 = mTot2 * 9.81;
      const fl2 = body.footNormalForce('l', 1 / 240);
      const fr2 = body.footNormalForce('r', 1 / 240);
      const tot2 = fl2 + fr2;
      const shareL = tot2 > 50 ? fl2 / tot2 : 0.5;
      for (const side of ['l', 'r'] as const) {
        const fp = fpos2(side);
        const N = W2 * (side === 'l' ? shareL : 1 - shareL);
        const copDesRaw = tx + (vx / om0) * damp;
        const copDes = Math.max(fp.x - copClamp, Math.min(fp.x + copClamp, copDesRaw));
        // τ_ankle = −N×(copDes − x_ankle)（矢状面，绕横轴）
        const tauAnkle = -N * (copDes - fp.x);
        const diA = body.dofByName(`foot_${side}`, 2);
        if (diA >= 0) {
          const dA = body.dofs[diA]!;
          const capA = 0.5 * (dA.tauMax > 0 ? dA.tauMax : 1e9);
          const tauCap = Math.max(-capA, Math.min(capA, tauAnkle));
          propose({ dof: diA, kind: 'torque', pri: PRI.servo, tau: tauCap, src: 'ankleCoP' });
          if (String(e.SQ_COPDBG ?? '0') === '1') {
            const gC = globalThis as { __CN?: number };
            gC.__CN = (gC.__CN ?? 0) + 1;
            if (gC.__CN % 480 === 1) console.log(`COPDBG ${side} copDes=${copDes.toFixed(3)} 踝x=${fp.x.toFixed(3)} N=${N.toFixed(0)} τ=${tauCap.toFixed(0)}`);
          }
        }
      }
    }
  }
  // ★ 虚拟腿协同已删（2026-10-19 用户：'停用了可以把旧的删了'）
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
      // ★ sqCorr 已删（2026-10-19 用户：'旧的删了'）——回正力=肌肉对（pairSquat 块）
      continue;   // ★ sqChain 已删（SQB_ON=0 旧路径——2026-10-19）
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
    // ★ 站立迁移开关（ST_SERVO_OFF=1：老伺服让位，只留肌肉对+基础力）
    if (String(e.ST_SERVO_OFF ?? '0') !== '1') propose({ dof: di, kind: 'torque', pri: PRI.action, tau: clLp, src: 'supportClean' });
  }

  // ── 上肢/颈姿态保持（§4.2.4/4.2.5）——★ 2026-10-16 补齐：旧张力层弹簧覆盖全身，
  //    干净版漏了肩/肘/颈（15 轴）→ 手臂自由甩动反作用鞭翻躯干（"四足/翻转"真身之一）──
  const kpArmEnv = Number(e.SC_KP_ARM ?? 0);   // 0=逐关节量程归一化
  const armOff = String(e.ARM_OFF ?? '0') === '1';   // ★ 手臂控制全关（被动测试）
  // ★★★ 2026-10-19 用户（'蹲下我只要基础力和回正力/有不应该存在的力'）：
  //   手臂 PD 是站立路径——蹲姿让位（蹲姿的臂=张力层单向阻尼即可）
  const squatArmSkip = String(e.SQ_ARM_SKIP ?? '1') === '1' && baseState() === 'squat';
  for (const [jn, ax] of ARM_AXES) {
    if (armOff || squatArmSkip) break;
    const di = body.dofByName(jn, ax);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.engineMotor) continue;
    // ★★★ 2026-10-18 用户（'为什么上身没有力'）：蹲姿脊柱/颈**只写基础力表**（bias，无弹簧）——
    //   CH 回读：腰需求-116 实际+1 缺口118；表值 sup_spine12=-117 却没写手读 → 在此接上
    // ★ sqSpine 已删（2026-10-19：脊柱=肌肉对）
    // ★ 手臂 sqCorr 已删（2026-10-19：张力层管手臂）
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

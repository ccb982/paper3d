/**
 * 伺服 · 侧向稳定（躯干侧倾调重心）——**唯一伺服**的侧向项（2026-10 自动作层收编）。
 *
 * 文献：Mouchnino 1996（稳定模式 = 躯干侧倾修重心）；van Dieën 2015（单腿不稳时躯干反旋使用大增）；
 * Geng/Bruijn/van Dieën 2024（单腿延迟 204ms、增益略高于临界）；Sci Rep 2021（延迟 PD 取
 * node-spiral 分离线=非振荡+稳健）。
 *
 * ★ 2026-10-11 关键教训（与脚部链同源）：平衡时位置/速度误差都是**微量**——律若只吃它们等于
 *   **零作用**（实测 gain 0.9~2.6 扫描全同值）。扰动藏在**加速度**里 → 必须加速度项主导。
 *   加速度用 `sensors.rawVel` 差分（comVel 是 100ms 低通，差分不出量级）。
 *
 * 分层（用户定调）：腰（spine1）= 主/快环；脊柱（spine2/3）= 次/慢环（更未来的倾倒趋势）。
 */
import type { ServoRefs } from './supportReg';

export const LATERAL = {
  /** 位置增益（rad/m；环境变量可覆盖，安全扫描用） */
  stabKz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KZ ?? 0.9),
  /** ★ 权限（rad/节），人类域
   *  ★ §2.622c 标定（用户："只需要一个刚到竖直的初始位置的力度"；回读：λ0.15→~124N·m/节、
   *   v项9×vz 顶满→实际写 900-1400 N·m/节=30 倍超标 → ±30° 摇摆）：
   *   "刚好" = 需求 M·g·x ≈75-105 N·m ÷ 3节 ÷ (c·K·1.5≈825) ≈ **0.04 rad/节**。 */
  cap: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_CAP ?? 0.08),   // ★ §2.622h 用户："不够"→保 0.08（不回撤）
  stabKx: 1.4,
  /** 实测灵敏度：spine 侧倾(0/2 轴) → CoM 位移（m/rad） */
  sensZ: 0.30,    // lean0 正 → comZ 正（翻符号实验测无变化→回滚）
  /** 速度增益（相位超前，NMP 补偿） */
  kvz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KV ?? 0.7),   // ★ 0.5→0.9（抬腿后预测灵敏度）
  /** ★ 加速度增益（rad/(m/s²)；扰动主要在加速度里——本日核心修正） */
  kaz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KA ?? 0.04),   // ★ 0.02→0.05
  /** ★ 本体反馈增益（rad/m；PCDC 律——CoP 偏离脚下中心即出力） */
  kCop: 0.9,
  /** ★ 慢层增益（长期误差修正，§2.114） */
  slowGain: 3.0,   // ★ 3.0=双指标甜点（危险动量0.0608+对齐50%；4.5→39%退）
  /** 脊柱慢环（次要/前瞻）：趋势项主导、位置为辅 */
  spineKz: 0.9,   // ★ §2.338（用户：那个力不能改变方向）：内力无效→倾斜(质量移动=真通道)加强 0.3→0.9
  /** ★ §2.622b/c/h/i 速度项=相位超前/阻尼（用户："容易脱离掌控"→振荡增根=阻尼不足）→ 1.2 */
  spineKvz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_SPKV ?? 1.2),
  /** ★ 输出限速（rad/s）——"慢半拍，让扰动先来" */
  rate: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_RATE ?? 0.8),   // ★ §2.285 用户：还快——1.2→0.8 rad/s
  sensX: -0.36,   // lean2 正 → comX 负
  /** ★ §2.622 回正强度（用户："可算有了，就是力太大了"）：trend × trendK；LAT_TREND 可扫 */
  trendK: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_TREND ?? 1.0),
};

/** ★ 急救参数（用户定调：腰=急救、快借快还；Reimann/Jeka 2018 髋策略=角动量临时借贷） */
export const LATERAL_EMERG = {
  /** 触发阈值：marginZ 小于此值 或 TTB 小于此值 → 急救 */
  marginZ: -0.02,
  ttb: 0.6,
  /** 脉冲时长（s）——快借快还 */
  hold: 0.30,
  /** ★ §2.631 用户："爆发脉冲后 0.5s 冷却 不用这个"——去冷却（危险仍在可连发；脉冲间隔仅受 hold 限制） */
  cool: 0,
  /** 急救放大倍数（增益/cap/速率） */
  boost: 2.0,
};

/** ★ 限速/差分状态（模块级；单动作场景足够） */
let prevVzRaw = 0;
let azNow = 0;
let latPulseT = 0;   // 间歇脉冲计时（Morasso 2019）
let slowInt = 0;     // ★ 长期误差积分（§2.114）
let emergT = 0;    // 脉冲剩余
let _cSlew = 0.5;   // ★ §2.583 激活变化率限幅(Remus2023第一纪律:防激活尖峰→不稳定)
let coolT = 0;     // 冷却剩余
let _trendF = 0;   // ★ §2.622f 回正项低通状态（用户："回正力不用这么快速生效"——τ0.3s 缓起）
let _trendXF = 0;  // ★ §2.627 前后回正项低通状态（同构）
let _comX0: number | null = null;   // ★ §2.627 前后参照（首帧捕获）
let _sp0L: [number, number, number] | null = null;   // ★ §2.628b 单腿起点脊柱侧向初态 θ₀（span 让位后由本写手承接）
let _sp0P: [number, number, number] | null = null;   // ★ 同上（前后）

/** 输入：横向重心误差（实际−基准，米）→ 输出写到 spine1–3 的侧屈目标（限速跟随） */
export function lateralStab(ctx: ServoRefs, errZ: number, dt = 1 / 240, residS = 0): void {
  if (LATERAL.stabKz === 0) return;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const vz = ctx.sensors.comVel[2]!;
  const vzRaw = ctx.sensors.rawVel[2]!;
  const azRaw = (vzRaw - prevVzRaw) / Math.max(dt, 1e-6);
  prevVzRaw = vzRaw;
  // ★ 轻平滑（30ms）——纯原始差分噪声过大，full 会满幅抡（实测 ±0.18 暴走）
  const aAlpha = 1 - Math.exp(-dt / 0.03);
  azNow += (azRaw - azNow) * aAlpha;
  const az = azNow;
  // ★ 急救判定（marginZ/TTB）→ 短脉冲放大（快借快还）
  const mz = ctx.bal.supportState?.marginZ ?? 0;
  const ttb = ctx.bal.lastFut?.ttbZ ?? 1;
  const danger = mz < LATERAL_EMERG.marginZ || ttb < LATERAL_EMERG.ttb;
  if (coolT > 0) coolT -= dt;
  if (danger && emergT <= 0 && coolT <= 0) emergT = LATERAL_EMERG.hold;
  if (emergT > 0) emergT -= dt;
  const boost = emergT > 0 ? LATERAL_EMERG.boost : 1;
  if (emergT <= 0 && danger) coolT = LATERAL_EMERG.cool;
  // ★ 本体反馈（2026-10-11 第二件；Roden-Reynolds 2015：髋本体感觉主导 ML 稳定；
  //   PCDC=比例于 CoP 偏差，Kim & Collins）：用支撑脚 CoP 直接读"脚底压力中心"，
  //   替代 comZ 二阶微分的噪声源——这是离地最近的真信号。
  const sf = ctx.sensors.feet[0]!.loaded ? ctx.sensors.feet[0]! : ctx.sensors.feet[1]!;
  const copDev = sf.copValid ? sf.copZ - sf.z : 0;
  // ★ §2.237 预测性脊柱（用户）：用 T=0.25s 后的误差预报 ePred=errZ+T·vz+½T²·az 驱动侧倾
  //   （原式各项分散加权；预报式=统一到一个未来偏差上，提前倚/提前拉）
  // ★ §2.239 修正为 Hof 2008 XcoM：预测量 = 位置 + 速度/ω₀（原文 ξ=x+v/ω₀）——
  //   无加速度项（旧式 0.25vz+0.031az 是自造的泰勒展开，不是文献形式）
  const omega0h = Math.sqrt(9.81 / Math.max(0.5, ctx.sensors.com[1]!));
  // ★ §2.245 用户：脊柱需要提前多偏移一点——前视加长1.6×XcoM（过度外推=提前倚）
  const ePred = errZ + vz / omega0h;   // ★ §2.245 1.6×前视实测无效（近锁定期vz≈0）→回 1.0；预期偏移改在参考端实现
  // ★ §2.238 间歇开关（Asai 2009/Bottaro 2008：鞍形稳定流形附近=PD关、自滑行；偏离=开）
  //   与预测并联：关闭条件 = 流形距离小 且 预报小（真的不用出手时才静默）
  const sMan = vz + omega0h * errZ;   // （=ω₀·XcoM偏差——开关与预测同源）
  // ★ §2.623b 间歇门放宽（原 0.02/0.012 几乎常关→算法失效；文献为"可开合"的带）
  const inDead = Math.abs(sMan) < 0.05 && Math.abs(ePred) < 0.025;
  // 腰快环：位置+速度+加速度（加速度主导扰动响应）+ 本体项
  // ★ 慢层：长期误差积分（泄漏型，防饱和＋自然回中）——"欠债慢慢还"（§2.114 Dalin 2023）
  slowInt += errZ * dt;
  slowInt -= slowInt * (1 - Math.exp(-dt / 2.5));   // 泄漏 τ2.5s
  slowInt = Math.max(-0.05, Math.min(0.05, slowInt));
  const slowTerm = -LATERAL.slowGain * slowInt / LATERAL.sensZ;
  const _g0 = (i: number): number => { const d = ctx.body.dofByName(`spine${i}`, 0); return d >= 0 ? ctx.body.dofs[d]!.angle : 0; };
  const _cslew = (tgt: number): number => {   // ★ §2.583 上限0.9（腰肌当主力）+变化率限幅（防churn）
    const capped = Math.min(0.9, tgt);
    const stp = 2.0 * dt;
    const dd = capped - _cSlew;
    _cSlew += Math.abs(dd) <= stp ? dd : Math.sign(dd) * stp;
    return _cSlew;
  };
  void copDev; void slowTerm;   // ★ §2.626 用户："加左右腰部肌肉的爆发性救急"——boost 解禁（emerg 脉冲期×2）
  // ★ §2.623 文献算法落地（Morasso/Asai 间歇控制 + Hof XcoM；Sci Rep 2021 节点螺旋分离线）：
  //   误差=预测量 ePred（位置+速度/ω₀，相位超前）；**流形安全带内(inDead)→关**（自然滑行=阻尼），
  //   带外才出力——"来回施力但不过冲"=稳定极限环晃，而不是增益堆阻尼的增根振荡。
  const kzPos = LATERAL.spineKz * (1 + 2 * Math.min(1, Math.abs(errZ) / 0.08));
  // ★ §2.629 用户："过了中间再向那个方向移动，自动变成阻尼"——越中/背离相位（err·v≥0）弹簧缩 0.3、阻尼×1.5；
  //   回中相位（err·v<0）弹簧全量、阻尼正常。防"弹簧把身体推向另一侧"的摇摆。
  const toward = errZ * vz < 0;
  const trend = inDead ? 0 : clamp(
    -(kzPos * ePred * (toward ? 1 : 0.3) + LATERAL.spineKvz * vz * (toward ? 1 : 1.5)) / LATERAL.sensZ,
    -LATERAL.cap, LATERAL.cap,
  );
  // ★ §2.622f 慢生效（用户："回正力不用这么快速生效"）：一阶低通 τ0.3s（LAT_TTAU 可调）。
  const trendAll = trend;
  const _ttau = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_TTAU ?? 0.12);   // ★ §2.622h 0.3→0.12（"生效太慢"）
  _trendF += (trendAll - _trendF) * (1 - Math.exp(-dt / Math.max(0.02, _ttau)));
  // ★ §2.627 前后修正力（用户："很多时候向前折腰，因为前后的修正力没做"）——与左右完全同构：
  //   脊柱 pitch（axis2）单一非线性 PD（ePred=XcoM 超前）+ 慢生效 + 爆发 boost；参照=首帧 comX0。
  {
    if (_comX0 === null) _comX0 = ctx.sensors.com[0]!;
    const errX = ctx.sensors.com[0]! - _comX0;
    const vx = ctx.sensors.comVel[0]!;
    const ePredX = errX + vx / omega0h;
    const kzX = LATERAL.spineKz * (1 + 2 * Math.min(1, Math.abs(errX) / 0.08));
    // ★ §2.629b 前后同构：越中/背离（err·v≥0）→弹簧缩 0.3、阻尼×1.5；回中→弹簧全量
    const towardX = errX * vx < 0;
    const trendX = inDead ? 0 : clamp(
      -(kzX * ePredX * (towardX ? 1 : 0.3) + LATERAL.spineKvz * vx * (towardX ? 1 : 1.5)) / LATERAL.sensX,
      -LATERAL.cap, LATERAL.cap,
    );
    _trendXF += (trendX - _trendXF) * (1 - Math.exp(-dt / Math.max(0.02, _ttau)));
    for (let sxi = 0; sxi < 3; sxi++) {
      const snX = (['spine1', 'spine2', 'spine3'] as const)[sxi]!;
      const d2 = ctx.body.dofByName(snX, 2);
      if (d2 < 0 || ctx.bal.manual.isPinned(snX, 2)) continue;
      if (ctx.bal.drive.legReflex.side !== null) {
        const base = _sp0P ? _sp0P[sxi]! : ctx.body.dofs[d2]!.angle;   // ★ §2.628b 守初态锚
        ctx.bal.drive.commandMusclePair(d2, 0.75, base + _trendXF * boost);
      }
    }
  }
  // ★ §2.262 洗脉归因实验：漂移时脊柱伺服吃掉髋纠偏矩——动则让位（kp250→60），停稳才恢复
  const latActive = Math.abs(vz) > 0.02 || Math.abs(errZ) > 0.03;
  // ★ §2.314 P1.1：C = 连续三档状态机（用户：壱直档）——躯干世界倾角到 ±10° 的归一风险：
  //   常态 C=0.45；临界（接近±10°）渐上升；越界 C→0.9（缓转形式，全程无阶跃；激活动力学在 drive 内）
  const tiltNow = Math.abs(ctx.sensors.torsoTilt[1] ?? 0);
  const risk = Math.min(1, tiltNow / 0.1745);   // ±10°归一
  // ★ §2.343 用户：锁主要锁上身！——全链统一 0.55 基档（上身不弱于下）+ 风险项
  const cTone = Math.min(1.0, (0.55 + 0.35 * risk * risk) * 1.6);   // ★ §2.474 回读：脊柱侧倒到14.6°→恢复力不足，C上限提档
  const spGate = 0.3 + 0.7 * Math.min(1, Math.abs(residS) / 60);   // ★ §2.544 链门控：下级残差小→腰只绷张力(0.3×)，残差大→上岗
  // ★ §2.628b 单腿起点捕获 θ₀（span 已让位，本写手承接"守初态"）——单腿期首帧记，离期释放
  {
    const singleNow = ctx.bal.drive.legReflex.side !== null;
    if (singleNow && _sp0L === null) {
      const cap3 = (ax: number): [number, number, number] => (['spine1', 'spine2', 'spine3'] as const).map((sn) => {
        const d = ctx.body.dofByName(sn, ax);
        return d >= 0 ? ctx.body.dofs[d]!.angle : 0;
      }) as [number, number, number];
      _sp0L = cap3(0);
      _sp0P = cap3(2);
    }
    if (!singleNow) { _sp0L = null; _sp0P = null; }
  }
  const diSp1 = ctx.body.dofByName('spine1', 0);
  if (!latActive && diSp1 >= 0 && !ctx.bal.manual.isPinned('spine1', 0)) {
    ctx.bal.drive.commandMusclePair(diSp1, _cslew(cTone * spGate), _sp0L ? _sp0L[0] : _g0(1));   // ★ §2.628b 守初态锚（承接 span）
  } else if (diSp1 >= 0 && latActive) {
    // 漂移期：C 按风险维持（锁不下岗；越界时就是壱直档）——“肌肉一直绷着”
    // ★ §2.390 回读：单腿期腰部锁=空转(C0.12)！——冷却分级：
    //   单腿成立(U_ACTIVE)→C=0.45（腰挺着）；转移/未成立→C=0.12（让位保转移）
    const singleOn = ctx.bal.drive.legReflex.side !== null;   // supportColumn 在单腿段设过 side
    // ★ §2.621 修（回读 dpe≡0=trend 被 void 丢掉→脊柱弹簧恒零、只剩阻尼churn）：
    //   活跃/危险段恢复论文级回正项：λ = 当前角 + trend（位置+速度，节点螺旋 PD；Mouchnino1996/vanDieën2015/Geng2024）
    ctx.bal.drive.commandMusclePair(diSp1, singleOn ? _cslew(Math.max(0.75, cTone) * spGate) : 0.12, (_sp0L ? _sp0L[0] : _g0(1)) + _trendF * LATERAL.trendK * boost);   // ★ §2.626/628b 锚+爆发
  }
  // ★ §2.400 回读（用户：侧偏到15°都不发力）：原写法 spine2/3 只在 !latActive 时写——漂移一发生就集体撒手(C=0)
  //   而漂移正是侧偏上涨时刻(实测 4.6→10.4° 段 spine2/3 全 0.00)。修=对称 spine1 两支：漂移期持当前(C按单腿分级)，肌肉永不下岗。
  for (const sn of ['spine2', 'spine3']) {
    const diSn = ctx.body.dofByName(sn, 0);
    if (diSn < 0 || ctx.bal.manual.isPinned(sn, 0)) continue;
    if (!latActive) {
      ctx.bal.drive.commandMusclePair(diSn, _cslew((0.55 + 0.35 * risk * risk) * spGate), _sp0L ? _sp0L[sn === 'spine2' ? 1 : 2]! : _g0(sn === 'spine2' ? 2 : 3));   // ★ §2.628b 守初态锚
    } else {
      const singleOn = ctx.bal.drive.legReflex.side !== null;
      // ★ §2.621/622/628b 同上：锚+同号梯度趋势
      ctx.bal.drive.commandMusclePair(diSn, singleOn ? Math.min(0.5, Math.max(0.75, cTone) * spGate) : 0.12, (_sp0L ? _sp0L[sn === 'spine2' ? 1 : 2]! : _g0(sn === 'spine2' ? 2 : 3)) + _trendF * LATERAL.trendK * boost);   // ★ §2.626 爆发期×boost
    }
  }
  void trend;
}

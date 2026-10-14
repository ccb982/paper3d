/**
 * 迈步原语（step primitive）——单脚站立是它的特例；走路 = 左右交替的序列。
 *
 * 相骨架（文献化，见 `docs/动作层架构.md` §2）：
 *   A 转移：重心闸门（Mouchnino：腿启动延迟到重心完成转移）+ 弹道/精靠两段轨线
 *   B 抬腿：**强制命令**（唯一允许写死关节角的段）+ 稳定模式=重心侧移补偿（Mouchnino 1996）
 *   C 落点：**落点寻找器全权接管**（端点控制；目标点=footfall 策略）
 *   D 下落：强制命令（寻找器目标高度→0；晚段回收将在此加强）
 *   E 站稳：双脚中点回中 + 抓地反射（消力模块负责）
 *
 * 纪律：只提案不直写 Executor（写入经 ManualControl/comTarget，由控制层整合裁定）；
 * 写进去的都要能交还（含完成路径/超时）。
 */
import type { Phase, PhaseCtx } from '../program';
import { LandingSeek } from './landingSeek';
import { defaultFootfall } from './footfall';
import { transferTarget, counterbalanceZ, swingLegCoM, CB_MASS } from './stanceBalance';
/** ★ 脚部侧向对抗（文献 per-step 常数前馈；Kim&Collins ±20Nm 口径，我们取 ±35） */
import { lateralStab } from '../servo/lateralStab';
import { SagittalStab, setSagOffset, decaySagOffset } from '../servo/sagittalStab';
import { supportColumn, reactionComp, trunkSupport, pelvisForward, captureSupportPose, releaseSupportPose, captureComY, footLateral, resetFootLateral, FOOT_SERVO, footModeOf, copeErr, setLiftDone } from '../servo/supportReg';
import { loadBearing } from '../servo/loadBearing';

/** ★ §2.212 连续升降（≤0→0，≥1→1，中间 smoothstep） */
const sstep = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** ★ §2.212 摆动腿伺服写手（用户：抬腿过程不稳）：误差+速度双因子连续门控——
 *  在动（误差大 或 速度快）→全功率（带 kd 刹车）；停稳（到位 且 慢）→透明（轻）。
 *  旧版病：硬阈值且只换 kp（kd 恒为 air 值=0.3 无刹车）→ B 相动量一路冲过目标（实测 100° vs 目标 31°）。 */
function swingWrite(ctx: PhaseCtx, name: string, ax: number, tgt: number, holdKp: number, holdKd: number, mvKp: number, mvKd: number): void {
  const di = ctx.body.dofByName(name, ax);
  if (di < 0) { ctx.bal.manual.setAngle(name, ax, tgt, holdKp, holdKd); return; }
  const err = Math.abs(ctx.body.dofs[di]!.angle - tgt);
  const v = Math.abs(ctx.bal.drive.velFilteredOf(di));
  const w = Math.max(sstep((err - 0.08) / 0.25), sstep((v - 0.3) / 0.7));
  ctx.bal.manual.setAngle(name, ax, tgt, holdKp + (mvKp - holdKp) * w, holdKd + (mvKd - holdKd) * w);
}

export interface StepOptions {
  support?: 'l' | 'r';
  /** C 相保持时长（s） */
  hold?: number;
}

export function stepPhases(opts: StepOptions = {}): Phase[] {
  const support = opts.support ?? 'r';
  const holdSeconds = opts.hold ?? 1.0;
  const lift = support === 'l' ? 'r' : 'l';
  const fi = (ctx: PhaseCtx) => ctx.sensors.feet[lift === 'l' ? 0 : 1]!;
  const si = (ctx: PhaseCtx) => ctx.sensors.feet[support === 'l' ? 0 : 1]!;
  const W = (ctx: PhaseCtx) => ctx.body.sk.massTotal * 9.81;
  const hip = `hip_${lift}`, knee = `knee_${lift}`, foot = `foot_${lift}`;
  const supHip = `hip_${support}`;

  let seek: LandingSeek | null = null;
  const sag = new SagittalStab();
  const ensureSeek = (ctx: PhaseCtx): LandingSeek =>
    (seek ??= new LandingSeek(ctx.bal.manual, hip, knee, foot));
  const angOf = (ctx: PhaseCtx, name: string, ax: number): number => {
    const i = ctx.body.dofByName(name, ax);
    return i >= 0 ? ctx.body.dofs[i]!.angle : 0;
  };

  let groundY = 0, supportZ0 = 0, fiRestZ = 0, shiftT = 0, inited = false, armT = -1, fiRestAb = 0, bendPeak = 0;
  let comZ0 = 0;
  let cKnee = 0;   // ★ C 相摆腿冻结姿态（enter 捕获）
  let sHip = 0;   // ★ C 相支撑髋矢状保持角（2026-10-11：回读该轴 4.2-4.7 净τ=0=自由折 −1→−20°）   // ★ 盒子基准（2026-10-11：CoM 到脚心的绝对距离含解剖 offset=误报；改用 A 相完成的 CoM 位置为 0 点）
  let legRestZ = 0, legRestX = 0;   // ★ 摆腿质量 CoM 静止 x/z（配重的真基准）
  let bendLoopF = 0;   // 弯腰闭环低通（§2.75）

  const legGetter = (ctx: PhaseCtx) => (name: string) => {
    const i = ctx.body.indexByKey.get(name);
    if (i === undefined) return null;
    const b = ctx.body.bodies[i]!;
    const t = b.translation();
    return { m: b.mass(), x: t.x, z: t.z };
  };
  /** ★ 承重盆骨（用户定调 2026-10）：单支撑段（B–E）支撑髋外展**加力锁紧**——
   *  回读依据：B 相骨盆滚转 ±17°、外展 servo 饱和 120 仍差 0.3 rad（承重能力不够）。
   *  文献：Duchenne（骨盆保持）、Prior 2014（骨盆下沉→被动/强收缩）。A 相转移段不调用（要自由）。 */
  let pbYaw0: number | null = null;   // ★ §2.550 世界偏航锁基准(每动作重建)
  const pelvisBearing = (ctx: PhaseCtx): void => {
    if ((globalThis as any).__PB_OFF2) return;   // 【审计】OFF 开关
    const di = ctx.body.dofByName(`hip_${support}`, 0);
    if (di < 0) return;
    // ★ tonic 基底（2026-10-11；Basmajian 经典 EMG：臀中肌单腿支撑全程有持续张力，非脉冲）：
    //   保底 ≥35 N·m 让外展永不断电（支撑侧恒正）。
    //   （§2.133 收缩固化：roll P/D/APA 三件套已清零——曾是 82% 扰动源；放回需先过审计）
    const TONIC_AB = 25;   // ★ §2.189 盆骨轻：35→25（人 GMed 持续张力 ~10-20%MVC）
    const sgn = support === 'r' ? 1 : -1;
    // ★ §2.427 用户：写手干净——tonic 并入 pair（"绷着"=λ偏置，supportReg §2.427 读）。此处不再 setTorque。
    const man = ctx.bal.manual;
    void sgn; void TONIC_AB; void di;
    // ★ §2.161 脊柱 yaw 阻尼（"还在转"：D/E 全身 yaw 甩 −120°——横向角动量全程无控；腹斜肌/腹横肌）
    for (const sn of ['spine1', 'spine2', 'spine3']) {
      const dy = ctx.body.dofByName(sn, 1);
      if (dy >= 0 && man.torqueOf(dy) === 0) {
        const ay = ctx.body.dofs[dy]!.angle;
        const vy = ctx.body.dofs[dy]!.vel;
        // ★ §2.531 用户：腰侧向/正向需专门肌肉！腹斜肌=侧向+反旋转专责——yaw改走肌肉对(λ=初始偏航角)
        const diY = dy;
        void diY; void ay; void vy;
      }
    }
    // ★ §2.157 支撑髋偏航保持（"撑腿转圈"：支撑脚 yaw 以 −8.8rad/s 暴转，髋 yaw 轴无写手）
    //   只写支撑髋（摆动侧不碰，避 §2.130 共振）；髋旋肌保持
    {
      const dYaw = ctx.body.dofByName(`hip_${support}`, 1);
      if (dYaw >= 0 && man.torqueOf(dYaw) === 0) {
        const a1 = ctx.body.dofs[dYaw]!.angle;
        const v1 = ctx.body.dofs[dYaw]!.vel;
        // ★ §2.550 世界偏航闭环（回读：torso 世界yaw -10→-28°在扭而本地 a1≈0→PD空转 mean 3.35）：世界yaw为主+本地速度阻尼
        let wYaw = 0, wYawV = 0;
        const ixT = ctx.body.indexByKey.get('torso');
        if (ixT !== undefined) {
          const rb = ctx.body.bodies[ixT] as unknown as { rotation(): { w: number; x: number; y: number; z: number }; angvel(): { x: number; y: number; z: number } };
          const q = rb.rotation();
          wYaw = Math.atan2(2 * (q.w * q.y - q.z * q.x), 1 - 2 * (q.y * q.y + q.z * q.z));
          wYawV = rb.angvel().y;
        }
        if (pbYaw0 === null) pbYaw0 = wYaw;
        ctx.bal.drive.setTorque(dYaw, Math.max(-131, Math.min(131, -150 * (wYaw - pbYaw0) - 30 * wYawV - 40 * v1)));
      }
    }
  };

  /** ★ 配重：目标 = 支撑锚 − K×(摆腿质量 CoM 位移)（用户定调：footZ 只有毫米级=没生效） */
  const cbTargetZ = (ctx: PhaseCtx): number => {
    const c = swingLegCoM(legGetter(ctx), lift);
    const dz = c ? c.z - legRestZ : 0;
    // ★ 承重伺服（用户架构 2026-10-11："Fz 占比探针也接入伺服"）：
    //   支撑脚欠载（fr < 95%W）→ comTarget 往支撑侧压（负 z 方向），把荷载拉回脚上。
    const fr = ctx.sensors.feet[support === 'l' ? 0 : 1]!.fz;
    const W = ctx.body.sk.massTotal * 9.81;
    const under = Math.max(0, Math.min(1, (0.95 * W - fr) / W));
    // ★ §2.297b 回读修正（用户：一发力承重腿飞）：支撑足抬腿瞬间欠载(37%)→该拉一帧跳 3.5cm→M2追阶跃目标猛泵=两脚被震。
    //   目标类信号不可阶跃：150ms 低通。
    // ★ §2.457 用户：正常人不会扫堂腿！——“承重伺服”（_loadPullF）就是那只手：
    //   抬腿瞬间支撑欠载→CoM目标被否 6cm 拉向支撑侧→身体横移→摆腿被惯性甩出=27cm扫。
    //   关闭（人类无此机制）。
    void under;
    // ★ §2.458 用户：正常人不扫堂腿——CB_MASS.k 自带判决注释"无效已证"(§2.163,杆杆错位方程量≈零)→删除残骸系数项。
    void dz; void CB_MASS;
    return supportZ0;   // ★ §2.458 纯支撑脚上方
  };
  /** ★ 前向配重（2026-10 末，用户："抬腿后瞬间失衡"复盘）：摆腿折起→质心前移（vx→0.81）
   *  却只配了横向。x 补偿同构：目标 = −K×(摆腿质量 CoM 前移量)。 */
  const cbTargetX = (ctx: PhaseCtx): number => {
    const c = swingLegCoM(legGetter(ctx), lift);
    const dx = c ? c.x - legRestX : 0;
    return CB_MASS.kx * dx;   // 【试反号】腿折向后→反作用推身体向前，目标跟着腿走
  };
  let _loadPullF = 0;   // ★ §2.297b 承重伺服目标低通态
  let shiftOk = false;
  let _vzSettleN = 0;   // ★ §2.562 出口门:速度连续稳定帧计数
  let liftT = 0, lowerT = 0, settleT = 0, recenterT = 0, cT = 0, recZ = 0;
  let relL2 = 0, relK = 0, relF = 0;

  /** ★ 抬腿力链（§2.132 架构重构）：B 相摆动腿的唯一编排点。
   *  同值同序提取（行为不变）：目标轨迹（一阶逼近）→ 三关节写手 → 外展保护。
   *  后续抬腿相关的力学演进（髋领速度、反作用对偶账本、偏航稳定）只在此处发生。 */
  const liftSwing = (ctx: PhaseCtx, dt: number): void => {
    // ★ §2.338b 抬腿完成旗标（计时器版：B+0.25s）——纠正正式持续接棒
    setLiftDone(liftT > 0.12);   // ★ §2.367 迭代：反应慢→更早（0.25→0.12）
    const s = ensureSeek(ctx).state;
    // ★ §2.134 用户定调：轻且向前——大腿领起（温和）、小腿自然下垂（少折）、不弹道
    // ★ §2.300 回读修正（用户：腿还在飞）：进 B 相立即折腿⼉脚还踩地上时折腿=往地里掘（实测左脚 31%→101% 二次砸地→反冲右脚飞）。
    //   折腿等卸载（负载门控：摆动脚载 < 15%W 才开始折）。
    const wLiftFz = ctx.sensors.feet[lift === 'l' ? 0 : 1]!.fz;
    // ★ §2.398c 卸载门=单向闩锁（回读：A相转移后左足仍 13-24% 在门限15%上下抖→膝折被反复斩）：首次卸载即放行整相。
    if (!(liftSwing as any)._ul) (liftSwing as any)._ul = false;
    if (wLiftFz < 0.15 * ctx.body.sk.massTotal * 9.81) (liftSwing as any)._ul = true;
    if (wLiftFz > 0.35 * ctx.body.sk.massTotal * 9.81) (liftSwing as any)._ul = false;   // 回该脚重新承重=重置（防下一次误闩）
    const liftUnloaded = !!(liftSwing as any)._ul;
    // ★ §2.317 （用户：找到跳的原因）：门控期目标必须=“保持当前”，不能=0！
    //   除 0 → 髇从入相角向 0 驱动 = 左腿在身体下方伸直蹬控 = 弹射（实测左足157%+右脚离地3.5cm）。
    // ★ §2.357（用户：找到不了单腿真相）：门控死锁（抬需卸载/卸载需抬）——髇抬腿无条件先行（把腿重卸下），膝/踝折腿保持门控。
    s.l2 = app(s.l2, 0.60, 2.0, dt);   // ★ §2.463 用户：抬腿太大了（像迈步）/need单腿站立——57°→35°提腿站立档
    if (liftUnloaded) {
      s.k = app(s.k, -1.05, 2.0, dt);   // ★ §2.438 回读纠正：膝折叠=抬高器（-34°时足高10.7cm vs -74°时16-18cm）→中间档 -60°
      s.f = app(s.f, -0.40, 3.0, dt);
    }   // else：膝踝保持当前角
    // ★ §2.144 足伺服三态（用户架构）：摆动脚按模式取参数——起抬段=单腿值(有力)，离地=air(轻引导)
    // ★ §2.325 用户：只想让支撑脚别再莫名其妙蹬地！上抬腿同理——
    //   摆动腿从 B 起只用轻档（move70/50/15、离地 air10/2/2）；
    //   旧：脚仍载→footModeOf=‘stand’→kp120/120/60 强增益在将抬腿上反压地面=蹬地真身。
    const m = footModeOf(ctx, lift) === 'air' ? FOOT_SERVO.air : FOOT_SERVO.move;
    // ★ §2.212 连续门控 + kd 刹车（原硬阈值/g只换kp）
    const mv = FOOT_SERVO.move;
    swingWrite(ctx, hip, 2, s.l2, m.hipKp, m.hipKd, mv.hipKp, mv.hipKd);
    swingWrite(ctx, knee, 2, s.k, m.kneeKp, m.kneeKd, mv.kneeKp, mv.kneeKd);
    swingWrite(ctx, foot, 2, s.f, m.ankKp, m.ankKd, mv.ankKp, mv.ankKd);
    // ★ §2.147 离地速度阻尼（用户："还在抖"——回读：踝 48Hz 离散振铃，
    //   伺服/kd 路径被 Bmax 削平→改 ff 通道直接速度力矩（不受 Bmax））
    if (footModeOf(ctx, lift) === 'air') {
      const ffDamp = (n: string, ax: number, k: number, cap: number): void => {
        const di = ctx.body.dofByName(n, ax);
        if (di >= 0) {
          const v = ctx.bal.drive.velFilteredOf(di);   // ★ §2.149 低通速度（原始噪声不进力矩）
          ctx.bal.drive.setTorque(di, Math.max(-cap, Math.min(cap, -k * v)));
        }
      };
      // ★ §2.436 用户：摆动腿关闭伺服（"抬腿过程有东西在写关节"）——ffDamp 三处全关，摆腿=自由。
      void ffDamp;
      // ffDamp(hip, 2, 2.0, 15);   // ★ §2.389 回读：倒下时摆腿空中狂甩(300°/s)→马面加重 0.4/3→2/15
      // ffDamp(hip, 1, 2.5, 15);   // ★ §2.204 摆动髋 yaw 阻尼 2.5/15（§2.213 实测 8/40 无增益，按“轻”回退）
      // ffDamp(knee, 2, 2.0, 15);  // ★ §2.389 同上
      // ★ §2.213 快速抬腿回读：踝偏航轴（foot/1）无人管——快节奏下 v1±25、7-10Hz 甩（旧慢速仅±0.9）。
      //   速度门控轻阻尼：只有真在运动(|v|>1)才写，静止零写入（守 §2.203“不给静止脚写高频力”）
      // （§2.213 试验：踝偏航阻尼 2.5→6 对 mfoot 世界 ωy 无改善（±30）40Hz 源头在快速屈伸本身，非踝轴）→彻底撤）
      // ffDamp(foot, 2, 5.0, 40);   // ★ §2.199 摆动踝 3.9e3→强阻尼   【§2.203 摆动足零写入实验】
      // ffDamp(foot, 1, 3.0, 25);   // ★ §2.202 踝的第3根轴（偏航）之前裸奔（摆动=悬空无接触阻尼）   【§2.203 摆动足零写入实验】
      // ffDamp(foot, 0, 0.3, 3);   【§2.203 摆动足零写入实验】
    }
    // ★ §2.140 回退 §2.135（用户："抬脚后迅速向外"=补偿符号反→主动外展偏置；恢复自然位）
    // ★ §2.218 大腿侧向落点（Rankin 2014 神经力学策略）：
    //   摆动臀中肌 ← CoM与支撑脚的侧向位移；位移越大→落脚越外侧（把支撑面提前摆到 CoM 下）。
    //   原固定 fiRestAb=自然位无侧向反馈；新=基线 + K×(com_z − 支撑脚_z)（锁±0.25rad）。
    // ★ §2.456 回撤 §2.455（用户：回撤吧回撤吧效果更差了）
    {
    const entryAb = ensureSeek(ctx).state.ab ?? fiRestAb;
    s.ab = Math.max(-0.25, Math.min(0.25, entryAb));
    }
    ctx.bal.manual.setAngle(hip, 0, s.ab, 110, 8);   // ★ §2.456 回退 kp500→110
    // ★ §2.599 抬腿阻尼（用户："抬腿能不能加个阻尼"；论文 Zajac 1989 激活动力学/Hill PE：
    //   抬腿=力缓起+阻尼吸收，不弹道）——摆动腿三轴轻 pair（λ=当前角=纯阻尼，C=0.25）：
    //   把折腿过冲/抖动吸收成平滑运动，反作用更小；C 相由既有 CW=0.6 pair 接棒。
    for (const [nm, ax] of [[hip, 2], [knee, 2], [foot, 2]] as Array<[string, number]>) {
      const di = ctx.body.dofByName(nm, ax);
      if (di >= 0) ctx.bal.drive.commandMusclePair(di, 0.25, ctx.body.dofs[di]!.angle);
    }
  };

  return [
    {
      name: 'A重心转移',
      timeout: 7.0,
      enter: (ctx) => {
        shiftOk = false; shiftT = 0; inited = false; ctx.bal.drive.opt.itbStiffness = 12;
      },   // ★ A 相 ITB 放松（转移需外展自由）（pin 实验：C 0.00s 崩→回滚）
      update: (ctx, dt) => {
        if (!inited) {
          supportZ0 = si(ctx).z;
          groundY = fi(ctx).y;
          fiRestZ = fi(ctx).z;                 // 摆腿静止位置（配重耦合的基准）
          fiRestAb = angOf(ctx, hip, 0);       // ★ 摆髋自然外展位（防抬腿内收）
          const rc = swingLegCoM(legGetter(ctx), lift);
          legRestZ = rc ? rc.z : fi(ctx).z;
          legRestX = rc ? rc.x : fi(ctx).x;
          inited = true;
        }
        shiftT += dt;
        // ★ 用户定调：重心预先往支撑侧**多偏一点**（目标越过支撑脚 2.5cm）——
        //   起始就更靠支撑侧，抬腿后往抬起侧的漂移有更多余量。
        const pre = supportZ0 + Math.sign(supportZ0) * 0.025;
        // ★ 用户架构（2026-10-11）：**转移=脊柱侧弯、用自身体重把 CoM 压过去**（质量配重，
        //   低刚度——不靠力矩硬拽）；腰（高 kp 急救）只在失衡时才该出手。
        // ★ §2.435 用户：我只想竖直着正常抬腿——A 相侧倾配重删除（躯干保持竖直）
        void 0;
        // ★ 用户定调（2026-10）：**抬腿之前先弯腰**（主动、直接写动作层）——脊柱前弯，
        //   上身弯、CoM 不平移（comTarget 前移实测把转移搞崩 1.1cm）；伺服照常工作=双保险。
        // ★ 弯腰=直接写动作层（用户定调）：**向前弯=负**（spine 轴2 正=向后，实测）
        // ★ §2.435 同上：A 相弯腰删除（竖直抬腿）
        ctx.bal.setTrunkRef(0);
        ctx.bal.setComTarget(0, transferTarget(shiftT, pre));
        // ★ 安全带预加载（2026-10-11 论文处方：先系安全带，后抬腿）：
        //   转移接近完成（承重>0.6W 且位置快到位）就把 ITB 拉紧——
        //   否则骨盆在"抬腿后 0.6s"里滚 36°（Inman：ITB 承担 OLB 47%）。
        if (si(ctx).fz > 0.6 * W(ctx) && Math.abs(ctx.sensors.com[2]! - supportZ0) < 0.06) {
          ctx.bal.drive.opt.itbStiffness = 45;
        }
      },
      done: (ctx) => {
        // ★ 闸门（人类同款：重心到支撑脚上方才允许抬；余量放宽——达成完美精度不容易）
        // ★ 用户定调（回读实证）：**抬脚那一刻支撑脚必须已经压住全部体重**——
        //   旧判据支撑>0.6W、抬脚<0.25W → 实测抬起时支撑只有 ~85%（抬脚还吃 15-25%）。
        //   收紧：支撑>0.75W 且抬脚<8%W；位置/速度同前；超时兜底保留。
        // ★ §2.434 人体档重调（用户：方向1调参/抬腿抬不起来了）：8% 是超人力矩时代收的线
        //   （当时实测残余 15-25%）；人体档（hip 212/knee 190）下实测卡在 17% 永不过门。
        //   现实值：人抬脚时本就带 10-15% 残余 → 放行线 8%→15%。
        _vzSettleN = Math.abs(ctx.sensors.comVel[2]!) < 0.05 ? _vzSettleN + 1 : 0;   // ★ §2.562 连续稳定>0.12s 才放行
        shiftOk = si(ctx).fz > 0.75 * W(ctx)
          && fi(ctx).fz < 0.15 * W(ctx)
          // ★ §2.341 回测：收到2cm→转移永远达不到（7s超时）=4.1cm 是当前站姿/可达的机械极限（几何课题）
          // ★ §2.597 试收紧 0.045 → 实测转移卡在 5.9-6.2cm（pad 侧向 CoP 目标 ±2cm 封顶+载重分配）
          //   → A 相会拖到 7s 超时硬抬；回退 0.085，抬腿力改由"反作用补偿"卸（§2.598，用户方向）。
          && Math.abs(ctx.sensors.com[2]! - supportZ0) < 0.085   // ★ §2.435b 实际可达 7.5cm（历史 5cm 门是超人档时代的）
          && _vzSettleN > 14   // ★ §2.562 连续0.06s稳定(折中)   // ★ §2.551 回读:交接速度实测-8~-28cm/s——阀值8→4cm/s(刹车到位才交接)
          // ★ 入区门（§2.96：通道入场=CoM-CoP<3cm；前移不进不抬腿）
          && Math.abs(ctx.sensors.com[0]!) < 0.05
          && Math.abs(ctx.sensors.comVel[0]!) < 0.15;
        if (shiftOk) comZ0 = ctx.sensors.com[2]!;   // ★ 盒子基准=转移完成的 CoM 位置
        return shiftOk;
      },
      onTimeout: (ctx) => {
        // ★ 无条件抬（用户定调：抬腿优先——"抬不起来"不可接受；安全由 C 相早落/落腿兜底）。
        //   人类策略同样是"重心转移完成才抬"，但我们是仿真，宁可抬了再落，也不要干站着。
        shiftOk = true;
        comZ0 = ctx.sensors.com[2]!;   // ★ 盒子基准（超时兜底同）
        void ctx;
      },
    },
    {
      name: 'B抬腿',
      timeout: 2.0,
      enter: (ctx) => {
        setLiftDone(false);   // ★ §2.337 抬腿期——纠正静默
        // （IAP 预锁 v1：280 无效→回滚；改主动预张力 v2 在 update 写）
        captureSupportPose(ctx, support);   // ★ 冻结支撑腿进相姿态（刚度弹簧的锚）
        // ★ §2.181 预倾释放（用户："侧向力不该这么大"）：A 相的转移预倾(0.10)在 B 相无人释放——
        //   整个 B/C 带着侧卷跌倒（测：CoM 侧飙 68cm/1.6s、侧向力±2000N）。进 B 即回正。
        // ★ §2.424 用户：写手干净——原 setAngle(sn,0,0,50,16) 留下每帧重放的 stale 目标
        //   （审计实锤 ManualControl.step 每帧代言）。改为 clearAngle：该轴交还 lateralStab 的 pair。
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          ctx.bal.manual.clearAngle(sn, 0);
        }
        captureComY(ctx);   // ★ 竖直反下沉参考（进相站高）
        resetFootLateral();   // ★ 脚部侧向对抗归零（伺服层）
        if (!shiftOk) return;
        liftT = 0;
        const seekLeg = ensureSeek(ctx);
        seekLeg.resetFrom({
          l2: angOf(ctx, hip, 2), k: angOf(ctx, knee, 2), f: angOf(ctx, foot, 2), ab: angOf(ctx, hip, 0),
        });
        ctx.bal.manual.pin(hip, 0);
        ctx.bal.manual.pin(hip, 2);
        ctx.bal.manual.pin(knee, 2);
        ctx.bal.manual.pin(foot, 2);
        // ★ §2.401 回读死亡代码（用户：侧偏到15°都不发力）：
        //   原这里 pin(spine1/2/3 轴0+轴2) 的本意=屏蔽其他写手，但 lateralStab/sagittalStab 自己也有 isPinned 守卫→把自己也屏蔽了：
        //   单腿期整个上身（spine2/3 侧向 pair + 全脊柱矢状）全程空转（实测：tilt 4.6→15° 那段 spine2/3 C=0.00）。
        //   leanReflex 已自行按 singleLeg 让位（leanReflex.ts “场合分权”），此 pin 纯多余——删。
        releaseSupportPose(support);
        // ★ §2.316 回读实验（用户：优先重做承重脚/找跳的原因）：
        //   B进入把承重膝“归动作绷直”（kp350）可能=登起弹跳源。改：锁住入相膝角（支撑柱）。
        {
          const dk = ctx.body.dofByName(`knee_${support}`, 2);
          const kNow = dk >= 0 ? ctx.body.dofs[dk]!.angle : 0;
          ctx.bal.manual.setAngle(`knee_${support}`, 2, kNow, 400, 40);
        }
        supportColumn(ctx, support);   // ★ 进相即写支撑柱：让姿势基线在**首帧**就看到 ff 并让位
        pelvisBearing(ctx);   // ★ 承重盆骨（单支撑段加力锁紧）
        //   （否则首帧 ff=0，基线把膝目标写回 0，之后即使基线让位，残留 PD 仍在吃主动伸展）
      },
      update: (ctx, dt) => {
        if (!shiftOk) return;
        // ★ 用户定调"边抬边调整"：目标 = 支撑脚**外越 1.5cm**（把实际重心拉满压上）+
        //   抬腿质量变化的实时配重（counterbalanceZ，边抬边算）
        // 目标=支撑正上方（原越支撑 2.5cm 的 pull 已证 CoP 够不到，撤）
        decaySagOffset(dt);   // ★ 交接残余指数衰减（τ=0.25s）
        ctx.bal.setComTarget(cbTargetX(ctx), cbTargetZ(ctx));
        // ★ B 抬腿 = 强制命令（唯一写死关节角的段）：抬过事件线即交寻找器
        liftSwing(ctx, dt);   // §2.132：摆动腿力链（唯一编排点）
        sag.step(ctx, 0.5, dt);   // ★ §2.507 书共时在线：B相也跑矢状缆绳（回读：弯腰窗口无缆绳）
        // ★ 自主计算前弯（用户定调 2026-10：鞠躬后抬腿居然平衡了——固定 −0.15 不够）：
        //   文献：单腿的预防策略=**CoM 前移**（支撑面小防向后倒）。闭环：目标 comX=+0.025，
        //   按实测灵敏度 ~0.3 m/rad 反推所需弯腰角（负=前弯），限幅 0.40。
        const COM_FWD_TGT = -0.01;   // ★ §2.167 落点修：0.02→−0.01（CoP前4.2cm骑达趾尖——目标回脚心之后）
        // ★ 用户定调（硬要求）：**抬脚时要持续弯腰**——闭环会随 CoM 前移变浅（违背），
        //   改为**单调棘轮**：弯腰只深不浅（bendPeak 记录历史最深），并随抬腿进程持续加深。
        const ramp = 0.03 * Math.min(1, liftT / 0.55);                    // 进程持续加深项（温和）
        const loopRaw = (COM_FWD_TGT - ctx.sensors.com[0]!) / 0.3;        // comX 闭环项
        bendLoopF += (loopRaw - bendLoopF) * (1 - Math.exp(-dt / 0.1));   // ★ 低通（噪声→目标微颤→kp180 追出 HF 217）
        const loop = bendLoopF;
        bendPeak = Math.max(0, Math.min(0.45, loop + ramp));   // ★ §2.168 方案B：撤棘轮（弯腿随 comX 闭环，不再只深不浅）
        // ★ 抬脚后早伸直+后移（用户 2026-10-11：防向前摔）：抬脚 0.45s 起、0.55s 内
        //   从弯腰(−bendPeak)过零到轻微后仰(+0.15×bendPeak)——姿态从"前倾支点"变"后仰锚"。
        // ★ 力沿脊柱上行（用户 2026-10-11："后挺无力，且是从腰沿着脊柱往上传力"）：
        //   阶梯时序——腰(spine1)先动，脊2 迟 0.05s、脊3 再迟 0.05s（近端领先=鞭状传力链）。
        // （慢挺腰实验：0.70s窗口→34%/C崩——"慢"让comX更长窗口有机会跑，回滚0.25）
        const rel1 = Math.min(1, Math.max(0, (liftT - 0.00) / 0.25));
        const rel2 = Math.min(1, Math.max(0, (liftT - 0.04) / 0.25));
        const rel3 = Math.min(1, Math.max(0, (liftT - 0.08) / 0.25));
        const bendAuto = -(1 - 1.15 * rel1) * bendPeak;   // ★ 回 1.3s 版（≤0 钳位实验：滞空 0.79 代价大→回退）
        const bend2 = -(1 - 1.15 * rel2) * bendPeak;
        const bend3 = -(1 - 1.15 * rel3) * bendPeak;   // ★ 1.45→滞空 0.71 更差=回滚；「后挺无力」不在脊柱幅度（另找发力路径）
        // ★ (a) 动作层：弯腰同步把骨盆推前（−0.05 温和；−0.10 实测 0.162 过强）
        // ★ 挺腰 CoM 配重（§2.97：bend 释放的 CoM 涌出需同步反向配重）：
        //   支撑髋/2 跟随 bend 同向延伸——骨盆跟退，CoM 保在通道内。
        // ★ §2.187 撤蹬地耦合（用户：不蹬地也要能挺腰）：挺腰=bendAuto/qXf 已在 spine 写手；supHip 位置伺服彻底撤（纯 th 力矩）
        // ★ (b) 伺服 L1-Future：骨盆前移前馈（随弯深联动）
        // ★ 删（Bechet 2025：骨盆前移=走的启动机制；踏步/单腿终态=姿势，CoM 不该前进）
        // pelvisForward(ctx, support, bendPeak);

        ctx.bal.setTrunkRef(bendAuto);
        // ★ 挺腰闭环（§2.98+ 用户定调：增大前后修正力度）——comX 超前 → 脊柱多后仰
        // ★ 持续力（用户：通道外需持续发力不弹）：PD（位置+阻尼速度），低通滤拉牵位置项
        const qXf = Math.max(-0.15, Math.min(0.15, (ctx.sensors.com[0]! - 0.02) * 1.05 - ctx.sensors.comVel[0]! * 0.6));   // 1.05甜点（1.3→C 0.86退）
        ctx.bal.manual.setAngle('spine1', 2, bendAuto + qXf, 140, 6);   // ★ §2.188 论文标定：挺腰用力 300→140（人 L5 伸矩 25-60N·m）
        ctx.bal.manual.setAngle('spine2', 2, bend2 + qXf, 140, 6);
        ctx.bal.manual.setAngle('spine3', 2, bend3 + qXf, 140, 6);
        // ★ 向前甩臂（A 相末已启动；B 相保持/微调——−=前屈）
        if (armT < 0) armT = 0;
        armT += dt;
        // ★ 最小急动（Flash & Hogan 1985）：线性斜坡→smootherstep（两端一阶二阶导为零，
        //   消除起停冲击的惯性力尖峰——力链的惯性主导问题从源头压）
        const armU = Math.max(0, Math.min(1, (armT - 0.08) / 0.12));
        const armSw = 0.55 * armU * armU * (3 - 2 * armU);
        // ★ 横断编舞（2026-10-11 深夜，§2.85）：对侧差动——支撑右腿/抬左腿 → 右臂前多、左臂后少
        //   （Hof M2 的横断版：摆腿的 yaw 反账由对侧臂的前后差动搭档；非对称才是反旋）
        const yawSw = 0.60 * armU;   // ★ §2.179 反摆再加强（0.35→0.60）
        ctx.bal.manual.setAngle('shoulder_l', 2, armSw - yawSw, 120, 14);   // ★ kp80→120
        ctx.bal.manual.setAngle('shoulder_r', 2, armSw + yawSw, 120, 14);
        // ★ 额状编舞：A 相弯腰同步由 pre 阶段已给（此处仅 B 相保持差动）
        supportColumn(ctx, support);   // ★ 主动任务发力（Winter 标准值 + 卸载并入，单写手）
        // ★ 支柱态（§2.105：用户“摆腿抬腿时承重腿同步蹬地挺腰”）：
        //   B 相支撑腿膝直目标 + 跡定角 —— 从第一帧就是坚固柱。
                // （§2.191 并链：支柱态膝/踝位置伺服撤除——踝 tf 已在力矩渠）
        pelvisBearing(ctx);   // ★ 承重盆骨（单支撑段加力锁紧）
        lateralStab(ctx, (ctx.sensors.com[2]! - supportZ0) * 1.0, dt, ctx.bal.drive.legReflex.latResidS);   // ★ 腰部主动对抗（B 相=抖动源头，此前漏接）
        // ★ 预锁 v2（2026-10-12，主动预张力：共激活的力矩版）：B 相前 0.4s 给躯干侧向成对预张力，
        //   包络衰减——把锁合上再发力（文献 Duchene 2026：主动肌提前激活）。
        // ★ §2.543 侧向脉冲彻底移除（用户：不要这种脉冲/必须申请制——这是原则）
        void supHip;
        liftT += dt;
      },
      done: (ctx) => !shiftOk || (liftT > 1.10 && fi(ctx).fz < 0.05 * W(ctx) && fi(ctx).y > groundY + 0.02 && si(ctx).fz > 0.75 * W(ctx)),   // ★ §2.98：加支撑载荷门（挺腰期不许跌破 75%）
      // 离地 = 持续卸载 0.55s（+2cm 保障；浅架峰值只有 3-4cm，用高度判据必超时）
      onTimeout: () => { /* 保持转移状态，交 C/D/E 兜底 */ },
    },
    {
      name: 'C保持',
      timeout: holdSeconds,
      enter: (ctx) => {
        cT = 0;
        setLiftDone(true);   // ★ §2.337 抬腿完成（B→C）——修正正式持续接棒
        // ★ §2.445 C 进入清摆腿 setAngle 目标（审计：原每帧重放摆腿四轴）。
        ctx.bal.manual.clearAngle(hip, 0);
        ctx.bal.manual.clearAngle(hip, 2);
        ctx.bal.manual.clearAngle(knee, 2);
        ctx.bal.manual.clearAngle(foot, 2);
        // ★ §2.449 用户定调：抬腿时大腿小腿略绷紧+发点力直着落地+腿一直抬着——
        //   一根通道全包：摆腿四轴转**轻肌肉对**（C=0.25），λ=抬腿末姿态：
        //   绷着=保持抬着 + 阻尼刹钟摆 + 直着落。
        {
          const stx = ensureSeek(ctx).state;
          const CW = 0.6;   // ★ §2.450 用户：腿要一直发力抬着（0.25太轻→持续用力保持抬姿）
          for (const [nm, ax, rf] of [[hip, 0, stx.ab], [hip, 2, stx.l2], [knee, 2, stx.k], [foot, 2, stx.f]] as Array<[string, number, number]>) {
            const di = ctx.body.dofByName(nm, ax);
            if (di >= 0) ctx.bal.drive.commandMusclePair(di, CW, rf);
          }
        }
        ctx.bal.setTrunkRef(0);   // ★ 弪腰参考归零（C 相起 sagittalStab 接管）
        // ★ §2.426 用户：写手干净——A 相弯腰的 setAngle(sn,2,bend)是 stale 目标（manual 每帧重放，
        //   审计实锤）。C 进入即 clear：该轴交还 sagittal 的 pair。
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          ctx.bal.manual.clearAngle(sn, 2);
        }
        {
          // ★ 交叉淡化 v2（2026-10-11）：残余项初值=**交接时刻实际脊柱角**（非标称 bendPeak，
          //   两者的差就是阶跃残差——HF 217 的来源）。
          let spSum = 0, spN = 0;
          for (const sn of ['spine1', 'spine2', 'spine3']) {
            const di = ctx.body.dofByName(sn, 2);
            if (di >= 0) { spSum += ctx.body.dofs[di]!.angle; spN++; }
          }
          setSagOffset(0);   // ★ 隔离 sagOffset
        }
        {
          // ★ 摆腿冻结（2026-10-11）：C 相 enter 捕获摆腿实际姿态，保持段恒定——
          //   此前保持段摆髋从 42° 掉到 27°=第二大小加速源（v=+1.04）。
          const g = (n: string, ax: number) => { const di = ctx.body.dofByName(n, ax); return di >= 0 ? ctx.body.dofs[di]!.angle : 0; };
          cKnee = g(knee, 2);
          sHip = -0.12;   // 【重置】行程 4.6°→6.9°
        }
        ctx.bal.setSuspendedFold(true);   // ★ 挂起旧 fold（防两写手打架）
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          ctx.bal.manual.pin(sn, 2, false);   // ★ 撤矢状声明（交 sagittalStab）
          ctx.bal.manual.pin(sn, 0, false);   // ★ 撤侧向声明（交 lateralStab——此前漏撤=腰部律被自己屏掉）
        }
        // ★ 落脚段：手臂交伺服层（用户定调）——清动作层写戳，momReg 自动接管
        ctx.bal.manual.clearAngle('shoulder_l', 2);
        ctx.bal.manual.clearAngle('shoulder_r', 2);
      },
      update: (ctx, dt) => {
        cT += dt;
        sag.step(ctx, 1.0, dt);   // ★ §2.506 前移:shiftOk门不能挡矢状缆绳(断线真身)
        if (!shiftOk) return;
        ctx.bal.setComTarget(0, cbTargetZ(ctx));   // ★ X 冻结=0（回读：comX 0→1.27m 指数跑，cbTargetX 正反馈自激）
        //    C 相 = **纯保持**——摆动腿锁在抬起姿态（B 末的关节角），powered hold：
        //    不 seek（它欠阻尼过冲→趾尖戮地 1000N 脉冲）、不落点外推、不增刚、不悬停。
        //    （释放的：defaultFootfall / 着地增刚 / seek 悬停三层——落地工艺推迟到 D 相再说）
        const st = ensureSeek(ctx).state;
        // ★ §2.443 用户：抬腿后不需要伺服系统——C 相 powered hold 四连写（hip/knee/foot 锁 B 末姿态 + hip 侧向）
        //   全部撤除，摆腿自由悬垂（重力自然摆）。姿态保持交给物理。
        void st; void swingWrite; void FOOT_SERVO; void footModeOf;
        void supHip   // ★ §2.392 用户：保位弹簧没有存在的必要！hip/2 单写手=挺腰 pitchHold   // ★ §2.391b 用户：发力完全不到位！需求~300 vs 给 100 → kp 80→500/kd25→40   // ★ §2.391 统一：sHip -6.9°屈→0直立（用户：腰要挺着！旧保位弹簧在命令髇屈=折腰真身）   // ★ §2.185 kp600→150（交还裁决权给 th/posTq 链）;   // ★ §2.148 kd30→8（阻尼饱和bang-bang根治）   // ★ §2.129 kd8→30（骨盆折页阻尼）   // ★ kd20→8（阻尼税 90Nm→36；§2.87 定律）   // ★ kp600/kd20=硬上界（800 两组都退）   // ★ kp100→250（臀部只牵拉不位移；重力负载 ~100Nm+）   // ★ kd 10→20（中间值）   // ★ 1.3s 版：kd 40（阻尼必要）
        // （骨盆 yaw 锁实验：L.y 零变化 + 抬腿掉半——回滚；L_y 源=摆动腿轨迹自身）
        // reactionComp(ctx, support, /* 【审计】OFF */ 0 * 0,  ctx.bal.supportState.phase === 'hold' ? 0.8 : 0.5);
        void trunkSupport;   // ★ §2.416 一轴一律：trunk tonic 让位（spine/2 归 sag pair）
        supportColumn(ctx, support);
        // （pelvisBearing 挪到整帧最后——防被后续写手覆盖 tonic）
        // ★ 2026-10-11 停用：实测横向正反馈（vz 预测加力顺着逃逸方向推，隔离实验 +25% 恶性）
        //   纵向（Fz 承重）用途待重做——它的目标轴与横向漂移的物理不兼容。
        // loadBearing(ctx, support, dt);
        // ★ §2.244 实测判决：参考向支撑脚外越20%→危险动量0.0447 vs 无偏0.0341（纪录）——无益撕销，回归进相快照参考
        // ★ §2.245 预期侧倾偏移（用户：脊柱需提前多偏移一点）：往支撑侧预倾等效误差±0.02（≈+3.4°预倾）
        // ★ §2.248 判决：脊柱回运动学+3.4°预倾（CoP驱动实测发散，天平留作感知层）
        lateralStab(ctx, ctx.sensors.com[2]! - comZ0 + 0.02 * -Math.sign(ctx.sensors.feet[support === 'l' ? 0 : 1]!.z), dt, ctx.bal.drive.legReflex.latResidS);
        // ★ 前庭反射 v1（2026-10-11 深夜，§2.85 编舞第一刀）：头不随躯干转——
        //   颈反旋躯干的 roll/yaw（回读：head+spine4 占 L.x 的 65%、L.y 全节段同号无抵消）。
        {
          const ti = (ctx.body as any).indexByKey.get('torso') ?? (ctx.body as any).indexByKey.get('spine4');
          if (ti != null && ti >= 0) {
            const q = ctx.body.bodies[ti]!.rotation();
            const roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
            const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
            if (false) ctx.bal.manual.setAngle('neck', 0, Math.max(-0.12, Math.min(0.12, -0.8 * roll)), 80, 12);   // 【审计】颈roll OFF
            if (false) ctx.bal.manual.setAngle('neck', 1, Math.max(-0.15, Math.min(0.15, -0.8 * yaw)), 80, 12);   // 【审计】颈yaw OFF
          }
        }
        pelvisBearing(ctx);   // ★ 最后写（tonic 底线防被吃；2026-10-11）
      },
      // ★ §2.451 用户：什么D相我也不需要——C=末相位，抬着的腿一直抬着。
      done: () => false,
    },
  ];
}

function app(cur: number, tgt: number, rate: number, dt: number): number {
  const d = tgt - cur;
  const stp = rate * dt;
  return Math.abs(d) <= stp ? tgt : cur + Math.sign(d) * stp;
}

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
import { supportColumn, reactionComp, trunkSupport, pelvisForward, captureSupportPose, releaseSupportPose, captureComY, footLateral, resetFootLateral } from '../servo/supportReg';
import { loadBearing } from '../servo/loadBearing';

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
  let cHip = 0, cKnee = 0, cAb = 0;   // ★ C 相摆腿冻结姿态（enter 捕获、全程恒定——Stokes 2017：肢间耦合是变异源）
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
  const pelvisBearing = (ctx: PhaseCtx): void => {
    const di = ctx.body.dofByName(`hip_${support}`, 0);
    if (di < 0) return;
    const roll = ctx.sensors.torsoTilt[1]!;           // 骨盆滚转（rad）
    // ★ 减弱 + 阻尼（用户定调 2026-10："抬脚时支撑腿侧向力必须减弱"）：
    //   回读实证：1400×roll、±90 满舵 → 每 0.3s 翻号 → 侧向 GRF ±1000~4800N 振荡。
    //   改为 P 减半 + D（滚转速度）破相位滞后的极限环。
    const rollVel = ctx.sensors.torsoAngVel[1] ?? 0;
    let extra = Math.max(-20, Math.min(45, 300 * roll + 260 * rollVel));   // ★ 夹逼中间档
    // ★ tonic 基底（2026-10-11；Basmajian 经典 EMG：臀中肌单腿支撑全程有持续张力，非脉冲）：
    //   回读实证支撑髋 ab 在"点射"（107↔4），脉冲间隙=骨盆自由滚=侧翻窗。
    //   保底 ≥35 N·m 让外展永不断电（支撑侧恒正）。
    const TONIC_AB = 35;   // ★ 35=滞空最佳（0.75s）；45→0.67 勿动
    const sgn = support === 'r' ? 1 : -1;
    if (sgn * extra < TONIC_AB) extra = sgn * TONIC_AB;
    ctx.bal.drive.setTorque(di, extra);
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
    const loadPull = -Math.sign(supportZ0 || -1) * 0.06 * under;   // 最多 6cm 的额外压向支撑
    return supportZ0 + CB_MASS.k * dz + loadPull;
  };
  /** ★ 前向配重（2026-10 末，用户："抬腿后瞬间失衡"复盘）：摆腿折起→质心前移（vx→0.81）
   *  却只配了横向。x 补偿同构：目标 = −K×(摆腿质量 CoM 前移量)。 */
  const cbTargetX = (ctx: PhaseCtx): number => {
    const c = swingLegCoM(legGetter(ctx), lift);
    const dx = c ? c.x - legRestX : 0;
    return CB_MASS.kx * dx;   // 【试反号】腿折向后→反作用推身体向前，目标跟着腿走
  };
  let shiftOk = false;
  let liftT = 0, lowerT = 0, settleT = 0, recenterT = 0, cT = 0, recZ = 0;
  let relL2 = 0, relK = 0, relF = 0;

  return [
    {
      name: 'A重心转移',
      timeout: 7.0,
      enter: (ctx) => { shiftOk = false; shiftT = 0; inited = false; ctx.bal.drive.opt.itbStiffness = 12; },   // ★ A 相 ITB 放松（转移需外展自由）
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
        {
          const leanZ = Math.sign(supportZ0) * Math.min(0.10, 0.10 * shiftT / 1.0);   // 【修】朝支撑侧（sensZ: lean0正→comZ正）
          for (const sn of ['spine1', 'spine2', 'spine3']) {
            ctx.bal.manual.setAngle(sn, 0, leanZ, 50, 16);   // ★ 用户定调 2026-10-11："预先侧倾过时了，50 好"——大幅削弱、配重纯质量化
          }
        }
        // ★ 用户定调（2026-10）：**抬腿之前先弯腰**（主动、直接写动作层）——脊柱前弯，
        //   上身弯、CoM 不平移（comTarget 前移实测把转移搞崩 1.1cm）；伺服照常工作=双保险。
        // ★ 弯腰=直接写动作层（用户定调）：**向前弯=负**（spine 轴2 正=向后，实测）
        const bend = -Math.min(0.15, 0.15 * shiftT / 1.2);   // ★ 0.15 三档实测最优（0.10→comX 0.176/抬腿9.4；0.05→失控；勿减）
        ctx.bal.setTrunkRef(bend);   // 标记：伺服暂停写脊柱前后
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          ctx.bal.manual.setAngle(sn, 2, bend, 180, 20);
        }
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
        shiftOk = si(ctx).fz > 0.75 * W(ctx)
          && fi(ctx).fz < 0.08 * W(ctx)
          && Math.abs(ctx.sensors.com[2]! - supportZ0) < 0.035
          && Math.abs(ctx.sensors.comVel[2]!) < 0.08;
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
        ctx.bal.drive.opt.itbStiffness = 30;   // ★ B 相起 ITB 主动张紧（Gmax+TFL：OLB 一半外展矩）
        captureSupportPose(ctx, support);   // ★ 冻结支撑腿进相姿态（刚度弹簧的锚）
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
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          // ★ 轴0 归 lateralStab、轴2 归 sagittalStab（唯一伺服的两条律，一轴一律 §2.15）
          ctx.bal.manual.pin(sn, 0);
          ctx.bal.manual.pin(sn, 2);
        }
        releaseSupportPose(support);
        ctx.bal.manual.clearAngle(`knee_${support}`, 2);   // ★ 清消力滞留屈膝目标（否则残留 PD 吃掉主动伸展）
        ctx.bal.manual.pin(`knee_${support}`, 2);   // ★ 承重膝绷直归动作（消力让位）
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
        const s = ensureSeek(ctx).state;
        // （摆腿冻结实验：0.77s 锁死→抬腿只剩 10.4cm（轨迹未走完）——回退；冻结窗口须晚于轨迹完成时刻）
        s.l2 = app(s.l2, 0.55, 1.2, dt);   // 【试】0.55（Bechet：踏步=少前摆、多折小腿——原 1.05 是走路式摆腿=前向动量源）
        s.k = app(s.k, -1.45, 1.2, dt);   // ★ 小腿折深（用户：折不够像被自己绊倒）
        s.f = app(s.f, -0.35, 3.0, dt);   // ★ 趾先离地（用户定调"先让脚上去"）：强背屈+快
        // ★ 摆腿**保持轻**（用户定调：轻是对的——落后的那点不算病）；反作用走 APA
        ctx.bal.manual.setAngle(hip, 2, s.l2, 180, 6);   // 【试】kd 18→6（周期-2 振荡）
        ctx.bal.manual.setAngle(knee, 2, s.k, 180, 6);   // 【试】kd 18→6
        ctx.bal.manual.setAngle(foot, 2, s.f, 80, 8);   // ★
        // ★ Rankin 2014 调制（文献：摆动期 GM 活动=f(CoM−对侧支撑脚 ML 位移)）：
        //   CoM 越偏支撑内侧 → 摆动外展越大 → 落点越偏外（动作层主导的侧向机制）。
        const mlDisp = ctx.sensors.com[2]! - supportZ0;                 // CoM 相对支撑脚（正=偏内）
        // ★ 文献口径（2026-10-11）：B 相摆动腿 ab 只自然位（Rankin 落点筹备推迟到 C）；
        //   hip hitch 实验双向都无净收益（杠杆非骨盆滚转主轴）——回退，留档 §2.72。
        const abMod = fiRestAb;
        ctx.bal.manual.setAngle(hip, 0, abMod, 220, 22);   // （+2°/kp400 两实验均伤主指标→回滚；内收反作用问题另行诊断）
        // （摆髋 yaw 锁实验：同样反效果→回滚。结论：L_y=抬腿动作物理本性，单轴锁=挤到别处）
        // ★ 自主计算前弯（用户定调 2026-10：鞠躬后抬腿居然平衡了——固定 −0.15 不够）：
        //   文献：单腿的预防策略=**CoM 前移**（支撑面小防向后倒）。闭环：目标 comX=+0.025，
        //   按实测灵敏度 ~0.3 m/rad 反推所需弯腰角（负=前弯），限幅 0.40。
        const COM_FWD_TGT = 0.06;   // （0.045 滞空 0.63<0.69——0.06 胜）
        // ★ 用户定调（硬要求）：**抬脚时要持续弯腰**——闭环会随 CoM 前移变浅（违背），
        //   改为**单调棘轮**：弯腰只深不浅（bendPeak 记录历史最深），并随抬腿进程持续加深。
        const ramp = 0.03 * Math.min(1, liftT / 0.55);                    // 进程持续加深项（温和）
        const loopRaw = (COM_FWD_TGT - ctx.sensors.com[0]!) / 0.3;        // comX 闭环项
        bendLoopF += (loopRaw - bendLoopF) * (1 - Math.exp(-dt / 0.1));   // ★ 低通（噪声→目标微颤→kp180 追出 HF 217）
        const loop = bendLoopF;
        bendPeak = Math.max(bendPeak, Math.max(0.08, Math.min(0.45, loop + ramp)));
        // ★ 抬脚后早伸直+后移（用户 2026-10-11：防向前摔）：抬脚 0.45s 起、0.55s 内
        //   从弯腰(−bendPeak)过零到轻微后仰(+0.15×bendPeak)——姿态从"前倾支点"变"后仰锚"。
        // ★ 力沿脊柱上行（用户 2026-10-11："后挺无力，且是从腰沿着脊柱往上传力"）：
        //   阶梯时序——腰(spine1)先动，脊2 迟 0.05s、脊3 再迟 0.05s（近端领先=鞭状传力链）。
        const rel1 = Math.min(1, Math.max(0, (liftT - 0.00) / 0.50));   // 【试】0.15→0.00（用户：抬腿立马挺腰）
        const rel2 = Math.min(1, Math.max(0, (liftT - 0.05) / 0.50));
        const rel3 = Math.min(1, Math.max(0, (liftT - 0.10) / 0.50));
        const bendAuto = -(1 - 1.15 * rel1) * bendPeak;   // ★ 回 1.3s 版（≤0 钳位实验：滞空 0.79 代价大→回退）
        const bend2 = -(1 - 1.15 * rel2) * bendPeak;
        const bend3 = -(1 - 1.15 * rel3) * bendPeak;   // ★ 1.45→滞空 0.71 更差=回滚；「后挺无力」不在脊柱幅度（另找发力路径）
        // ★ (a) 动作层：弯腰同步把骨盆推前（−0.05 温和；−0.10 实测 0.162 过强）
        ctx.bal.manual.setAngle(supHip, 2, -0.05, 150, 15);
        // ★ (b) 伺服 L1-Future：骨盆前移前馈（随弯深联动）
        // ★ 删（Bechet 2025：骨盆前移=走的启动机制；踏步/单腿终态=姿势，CoM 不该前进）
        // pelvisForward(ctx, support, bendPeak);

        ctx.bal.setTrunkRef(bendAuto);
        ctx.bal.manual.setAngle('spine1', 2, bendAuto, 180, 20);
        ctx.bal.manual.setAngle('spine2', 2, bend2, 180, 20);
        ctx.bal.manual.setAngle('spine3', 2, bend3, 180, 20);
        // ★ 向前甩臂（A 相末已启动；B 相保持/微调——−=前屈）
        if (armT < 0) armT = 0;
        armT += dt;
        // ★ 最小急动（Flash & Hogan 1985）：线性斜坡→smootherstep（两端一阶二阶导为零，
        //   消除起停冲击的惯性力尖峰——力链的惯性主导问题从源头压）
        const armU = Math.max(0, Math.min(1, (armT - 0.08) / 0.12));
        const armSw = 0.55 * armU * armU * (3 - 2 * armU);
        // ★ 横断编舞（2026-10-11 深夜，§2.85）：对侧差动——支撑右腿/抬左腿 → 右臂前多、左臂后少
        //   （Hof M2 的横断版：摆腿的 yaw 反账由对侧臂的前后差动搭档；非对称才是反旋）
        const yawSw = 0.18 * armU;
        ctx.bal.manual.setAngle('shoulder_l', 2, armSw - yawSw, 30, 6);
        ctx.bal.manual.setAngle('shoulder_r', 2, armSw + yawSw, 30, 6);
        // ★ 额状编舞：A 相弯腰同步由 pre 阶段已给（此处仅 B 相保持差动）
        supportColumn(ctx, support);   // ★ 主动任务发力（Winter 标准值 + 卸载并入，单写手）
        // （B 窗前庭反射实验：L.y 反涨 1.78→2.02 + 滞空 0.60 + 卡死→回滚；只在 C 相有益）
        {
          // ★ 承重伺服·直控版（用户架构 2026-10-11：comTarget 是死通道，改直加力矩）：
          //   支撑欠载 → 直接给支撑髋外展加力，把骨盆/CoM 压回支撑脚上（+ = 朝支撑侧）。
          const frL = ctx.sensors.feet[support === 'l' ? 0 : 1]!.fz;
          const Wl = ctx.body.sk.massTotal * 9.81;
          const underL = Math.max(0, Math.min(1, (0.95 * Wl - frL) / Wl));
          if (underL > 0.02) {
            const diAb = ctx.body.dofByName(`hip_${support}`, 0);
            if (diAb >= 0) ctx.bal.drive.setTorque(diAb, 120 * underL);
          }
          footLateral(ctx, support, supportZ0, dt);   // ★ 脚部侧向对抗（伺服层；原内联迁出）
        }
        pelvisBearing(ctx);   // ★ 承重盆骨（单支撑段加力锁紧）
        lateralStab(ctx, (ctx.sensors.com[2]! - supportZ0) * 1.0, dt);   // ★ 腰部主动对抗（B 相=抖动源头，此前漏接）
        liftT += dt;
      },
      done: (ctx) => !shiftOk || (liftT > 1.10 && fi(ctx).fz < 0.05 * W(ctx) && fi(ctx).y > groundY + 0.02),   // ★ 慢抬腿：0.55→1.10（0.9 rad/s 折满需 1.17s）
      // 离地 = 持续卸载 0.55s（+2cm 保障；浅架峰值只有 3-4cm，用高度判据必超时）
      onTimeout: () => { /* 保持转移状态，交 C/D/E 兜底 */ },
    },
    {
      name: 'C保持',
      timeout: holdSeconds,
      enter: (ctx) => {
        cT = 0;
        ctx.bal.setTrunkRef(0);   // ★ 弯腰参考归零（C 相起 sagittalStab 接管）
        {
          // ★ 交叉淡化 v2（2026-10-11）：残余项初值=**交接时刻实际脊柱角**（非标称 bendPeak，
          //   两者的差就是阶跃残差——HF 217 的来源）。
          let spSum = 0, spN = 0;
          for (const sn of ['spine1', 'spine2', 'spine3']) {
            const di = ctx.body.dofByName(sn, 2);
            if (di >= 0) { spSum += ctx.body.dofs[di]!.angle; spN++; }
          }
          setSagOffset(0);   // 【试】隔离 sagOffset
        }
        {
          // ★ 摆腿冻结（2026-10-11）：C 相 enter 捕获摆腿实际姿态，保持段恒定——
          //   此前保持段摆髋从 42° 掉到 27°=第二大小加速源（v=+1.04）。
          const g = (n: string, ax: number) => { const di = ctx.body.dofByName(n, ax); return di >= 0 ? ctx.body.dofs[di]!.angle : 0; };
          void g;   // （冻结实验微降 0.212→0.193→回滚）
          cHip = g(hip, 2); cKnee = g(knee, 2); cAb = g(hip, 0);   // 摆膝/摆髋冻结用
          sHip = g(supHip, 2);   // 支撑髋矢状保持位
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
        if (!shiftOk) return;
        ctx.bal.setComTarget(cbTargetX(ctx), cbTargetZ(ctx));
        // ★★ 简化（用户定调 2026-10："抬腿堆了一堆画蛇添足的机制，却从没真正抬起过腿"）：
        //    C 相 = **纯保持**——摆动腿锁在抬起姿态（B 末的关节角），powered hold：
        //    不 seek（它欠阻尼过冲→趾尖戮地 1000N 脉冲）、不落点外推、不增刚、不悬停。
        //    （释放的：defaultFootfall / 着地增刚 / seek 悬停三层——落地工艺推迟到 D 相再说）
        const st = ensureSeek(ctx).state;
        ctx.bal.manual.setAngle(hip, 2, st.l2, 120, 14);    // 保持姿态（比抬腿期硬一点，才"抬得住"）
        ctx.bal.manual.setAngle(knee, 2, Math.max(st.k, cKnee), 120, 14);   // ★ 摆膝冻 v2：以进 C 值为下限的 max（此前 min 方向反了没生效）
        ctx.bal.manual.setAngle(foot, 2, 0.0, 60, 8);       // 踝放平（不戳地）
        ctx.bal.manual.setAngle(hip, 0, st.ab, 120, 12);
        ctx.bal.manual.setAngle(supHip, 2, sHip, 100, 40);   // ★ 1.3s 版：kd 40（阻尼必要）
        // （骨盆 yaw 锁实验：L.y 零变化 + 抬腿掉半——回滚；L_y 源=摆动腿轨迹自身）
        reactionComp(ctx, support, ctx.bal.supportState.phase === 'hold' ? 0.8 : 0.5);
        trunkSupport(ctx, support);
        supportColumn(ctx, support);
        // （pelvisBearing 挪到整帧最后——防被后续写手覆盖 tonic）
        // ★ 2026-10-11 停用：实测横向正反馈（vz 预测加力顺着逃逸方向推，隔离实验 +25% 恶性）
        //   纵向（Fz 承重）用途待重做——它的目标轴与横向漂移的物理不兼容。
        // loadBearing(ctx, support, dt);
        sag.step(ctx, 1.0, dt);
        lateralStab(ctx, ctx.sensors.com[2]! - comZ0, dt);   // ★ 参考系=comZ0（进 C 位；此前用 supportZ0 导致腰侧弯随保持时长线性增长 −2→−8°=右倾源）
        // ★ 前庭反射 v1（2026-10-11 深夜，§2.85 编舞第一刀）：头不随躯干转——
        //   颈反旋躯干的 roll/yaw（回读：head+spine4 占 L.x 的 65%、L.y 全节段同号无抵消）。
        {
          const ti = (ctx.body as any).indexByKey.get('torso') ?? (ctx.body as any).indexByKey.get('spine4');
          if (ti != null && ti >= 0) {
            const q = ctx.body.bodies[ti]!.rotation();
            const roll = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
            const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
            if (!ctx.bal.manual.isPinned('neck', 0)) ctx.bal.manual.setAngle('neck', 0, Math.max(-0.12, Math.min(0.12, -0.8 * roll)), 80, 12);
            if (!ctx.bal.manual.isPinned('neck', 1)) ctx.bal.manual.setAngle('neck', 1, Math.max(-0.15, Math.min(0.15, -0.8 * yaw)), 80, 12);
          }
        }
        pelvisBearing(ctx);   // ★ 最后写（tonic 底线防被吃；2026-10-11）
      },
      done: (ctx) => Math.abs(ctx.sensors.com[2]! - comZ0) > 0.08,   // 【试】5→8cm（延后落脚）   // ★ CoM 盒子（修正参照系 2026-10-11：基准=comZ0（A 相完成位），非脚心——CoM 到脚心含解剖 offset=误报提前落）
    },
    {
      name: 'D落腿',
      timeout: 2.5,
      enter: (ctx) => {
        lowerT = 0;
        ctx.bal.manual.pin(hip, 2, false);
        ctx.bal.manual.pin(knee, 2, false);
        ctx.bal.manual.pin(foot, 2, false);
        ctx.bal.manual.pin(hip, 0, false);
      },
      update: (ctx, dt) => {
        lowerT += dt;
        if (!shiftOk) return;
        const ff = defaultFootfall({
          comX: ctx.sensors.com[0]!, vx: ctx.sensors.comVel[0]!,
          comZ: ctx.sensors.com[2]!, vz: ctx.sensors.comVel[2]!,
          supportZ0, restZ: fiRestZ,
        });
        ensureSeek(ctx).seek(dt, ff.x, ff.z, 0.0, fi(ctx));   // 强制：目标高度→0（放脚触地）


        ctx.bal.manual.setAngle(supHip, 2, sHip, 100, 40);   // ★ 1.3s 版：kd 40（阻尼必要）
        // （骨盆 yaw 锁实验：L.y 零变化 + 抬腿掉半——回滚；L_y 源=摆动腿轨迹自身）
        reactionComp(ctx, support, ctx.bal.supportState.phase === 'hold' ? 0.8 : 0.5);
        trunkSupport(ctx, support);
        ctx.bal.setComTarget(cbTargetX(ctx), cbTargetZ(ctx));
        supportColumn(ctx, support);
        pelvisBearing(ctx);   // ★ 承重盆骨（单支撑段加力锁紧）
        sag.step(ctx, 0.5, dt);
        lateralStab(ctx, (ctx.sensors.com[2]! - supportZ0) * 0.5, dt);
      },
      done: (ctx) => !shiftOk || fi(ctx).fz >= 0.06 * W(ctx),
      // 触地 = 轻触 6%W（单脚落腿本就轻；负重交给 E）
      onTimeout: (ctx) => {
        ctx.bal.manual.setAngle(hip, 2, 0);
        ctx.bal.manual.setAngle(knee, 2, 0);
        ctx.bal.manual.setAngle(foot, 2, 0);
      },
    },
    {
      name: 'E站稳',
      timeout: 3.0,
      enter: (ctx) => {
        settleT = 0; recenterT = 0;
        relL2 = angOf(ctx, hip, 2); relK = angOf(ctx, knee, 2); relF = angOf(ctx, foot, 2);
        recZ = ctx.sensors.com[2]!;
        // ★ 立即释放摆动腿的髋外展（脚已落地）：寻找器遗留的 ab 目标（kp80）会持续出
        //   实测 −62 N·m 的髋外展力矩顶骨盆——与 E 相失控加速时间点完全重合。
        ctx.bal.manual.clearAngle(hip, 0);
        ctx.bal.manual.pin(hip, 0, false);
      },
      update: (ctx, dt) => {
        settleT += dt;
        recenterT += dt;
        // 回中到**双脚中点**（落稳的支撑多边形；旧"回中线 0"会把重心送出支撑区）
        const midZ = (ctx.sensors.feet[0]!.z + ctx.sensors.feet[1]!.z) / 2;
        const dir = Math.sign(midZ - recZ) || 1;
        const step = Math.min(0.05 * recenterT, Math.abs(midZ - recZ));
        ctx.bal.setComTarget(0, recZ + dir * step);
        // 抬腿侧角限速回零；支撑髋外摆交还（解钉后姿势基线接管）
        const k = Math.min(1, settleT / 2.0);   // 放腿缓释（1.2→2.0s：释放反冲把躯干向后推）
        ctx.bal.manual.setAngle(hip, 2, relL2 * (1 - k));
        ctx.bal.manual.setAngle(knee, 2, relK * (1 - k));
        ctx.bal.manual.setAngle(foot, 2, relF * (1 - k));
        ctx.bal.manual.setAngle(supHip, 2, sHip, 100, 40);   // ★ 1.3s 版：kd 40（阻尼必要）
        // （骨盆 yaw 锁实验：L.y 零变化 + 抬腿掉半——回滚；L_y 源=摆动腿轨迹自身）
        reactionComp(ctx, support, ctx.bal.supportState.phase === 'hold' ? 0.8 : 0.5);
        trunkSupport(ctx, support);
        supportColumn(ctx, support);
        pelvisBearing(ctx);   // ★ 承重盆骨（单支撑段加力锁紧）
        sag.step(ctx, 0.5, dt);   // E 相（0.8 实测反而更差 18.3/0.142——回 0.5）
        lateralStab(ctx, ctx.sensors.com[2]! - (ctx.sensors.feet[0]!.z + ctx.sensors.feet[1]!.z) / 2);
        if (k >= 1) {   // 释放完成即解钉交还（程序 pin 不在 ActionSystem 记账里）
          ctx.bal.manual.pin(hip, 0, false);
          ctx.bal.manual.clearAngle(hip, 0);
          ctx.bal.manual.clearAngle(hip, 2);
          ctx.bal.manual.clearAngle(knee, 2);
          ctx.bal.manual.clearAngle(foot, 2);
          ctx.bal.manual.clearAngle(supHip, 0);
          ctx.bal.manual.pin(supHip, 0, false);
          releaseSupportPose(support);
        ctx.bal.manual.clearAngle(`knee_${support}`, 2);
          ctx.bal.manual.pin(`knee_${support}`, 2, false);
          ctx.bal.manual.clearAngle(supHip, 2);   // 骨盆前移交还
          for (const sn of ['spine1', 'spine2', 'spine3']) {
            ctx.bal.manual.pin(sn, 0, false);
            ctx.bal.manual.pin(sn, 2, false);
            ctx.bal.manual.clearAngle(sn, 0);
            ctx.bal.manual.clearAngle(sn, 2);
          }
        }
        void dt;
      },
      done: (ctx) => {
        const l = fi(ctx), s2 = si(ctx);
        const w = W(ctx);
        // ★ 完成 = 负载窗口 + 位置 + **速度已静**（旧判据在身体还带 0.33 m/s 滑行时就判成功 →
        //   动作结束后继续滑倒；"站稳"必须真的停下来）
        return l.fz > 0.3 * w && l.fz < 0.7 * w
          && s2.fz > 0.3 * w && s2.fz < 0.7 * w
          && Math.abs(ctx.sensors.com[2]!) < 0.03
          && Math.abs(ctx.sensors.comVel[2]!) < 0.08
          && Math.abs(ctx.sensors.comVel[0]!) < 0.08;
      },
      onTimeout: (ctx) => {
        ctx.bal.setComTarget(0, 0);
        ctx.bal.manual.pin(hip, 0, false);
        ctx.bal.manual.clearAngle(hip, 0);
      },
    },
  ];
}

function app(cur: number, tgt: number, rate: number, dt: number): number {
  const d = tgt - cur;
  const stp = rate * dt;
  return Math.abs(d) <= stp ? tgt : cur + Math.sign(d) * stp;
}

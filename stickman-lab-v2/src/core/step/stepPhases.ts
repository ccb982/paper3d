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
import { transferTarget, counterbalanceZ } from './stanceBalance';
import { lateralStab } from '../servo/lateralStab';
import { SagittalStab } from '../servo/sagittalStab';
import { stanceLock, unloadComp, reactionComp, trunkSupport, pelvisForward } from '../servo/supportReg';

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
  let shiftOk = false;
  let liftT = 0, lowerT = 0, settleT = 0, recenterT = 0, cT = 0, recZ = 0;
  let relL2 = 0, relK = 0, relF = 0;

  return [
    {
      name: 'A重心转移',
      timeout: 7.0,
      enter: () => { shiftOk = false; shiftT = 0; inited = false; },
      update: (ctx, dt) => {
        if (!inited) {
          supportZ0 = si(ctx).z;
          groundY = fi(ctx).y;
          fiRestZ = fi(ctx).z;                 // 摆腿静止位置（配重耦合的基准）
          fiRestAb = angOf(ctx, hip, 0);       // ★ 摆髋自然外展位（防抬腿内收）
          inited = true;
        }
        shiftT += dt;
        // ★ 用户定调：重心预先往支撑侧**多偏一点**（目标越过支撑脚 2.5cm）——
        //   起始就更靠支撑侧，抬腿后往抬起侧的漂移有更多余量。
        const pre = supportZ0 + Math.sign(supportZ0) * 0.025;
        // ★ 用户定调（2026-10）：**抬腿之前先弯腰**（主动、直接写动作层）——脊柱前弯，
        //   上身弯、CoM 不平移（comTarget 前移实测把转移搞崩 1.1cm）；伺服照常工作=双保险。
        // ★ 弯腰=直接写动作层（用户定调）：**向前弯=负**（spine 轴2 正=向后，实测）
        const bend = -Math.min(0.15, 0.15 * shiftT / 1.2);
        ctx.bal.setTrunkRef(bend);   // 标记：伺服暂停写脊柱前后
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          ctx.bal.manual.setAngle(sn, 2, bend, 180, 20);
        }
        ctx.bal.setComTarget(0, transferTarget(shiftT, pre));

      },
      done: (ctx) => {
        // ★ 闸门（人类同款：重心到支撑脚上方才允许抬；余量放宽——达成完美精度不容易）
        // ★ 用户定调（回读实证）：**抬脚那一刻支撑脚必须已经压住全部体重**——
        //   旧判据支撑>0.6W、抬脚<0.25W → 实测抬起时支撑只有 ~85%（抬脚还吃 15-25%）。
        //   收紧：支撑>0.75W 且抬脚<8%W；位置/速度同前；超时兜底保留。
        shiftOk = si(ctx).fz > 0.75 * W(ctx)
          && fi(ctx).fz < 0.08 * W(ctx)
          && Math.abs(ctx.sensors.com[2]! - supportZ0) < 0.035
          && Math.abs(ctx.sensors.comVel[2]!) < 0.10;
        return shiftOk;
      },
      onTimeout: (ctx) => {
        // ★ 无条件抬（用户定调：抬腿优先——"抬不起来"不可接受；安全由 C 相早落/落腿兜底）。
        //   人类策略同样是"重心转移完成才抬"，但我们是仿真，宁可抬了再落，也不要干站着。
        shiftOk = true;
        void ctx;
      },
    },
    {
      name: 'B抬腿',
      timeout: 2.0,
      enter: (ctx) => {
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
        ctx.bal.manual.pin(`knee_${support}`, 2);   // ★ 承重膝绷直归动作（消力让位）
      },
      update: (ctx, dt) => {
        if (!shiftOk) return;
        // ★ 用户定调"边抬边调整"：目标 = 支撑脚**外越 1.5cm**（把实际重心拉满压上）+
        //   抬腿质量变化的实时配重（counterbalanceZ，边抬边算）
        const pull = 0;   // 【试：原 0.025 越支撑 2.5cm → CoP 够不到，收回支撑正上方】
        ctx.bal.setComTarget(0, supportZ0 + pull + counterbalanceZ(fi(ctx).z, fiRestZ));
        // ★ B 抬腿 = 强制命令（唯一写死关节角的段）：抬过事件线即交寻找器
        const s = ensureSeek(ctx).state;
        s.l2 = app(s.l2, 0.60, 1.5, dt);
        s.k = app(s.k, -0.90, 1.5, dt);
        s.f = app(s.f, 0.08, 1.5, dt);
        // ★ 摆腿**保持轻**（用户定调：轻是对的——落后的那点不算病）；反作用走 APA
        ctx.bal.manual.setAngle(hip, 2, s.l2, 40, 4);
        ctx.bal.manual.setAngle(knee, 2, s.k, 40, 4);
        ctx.bal.manual.setAngle(foot, 2, s.f, 25, 3);
        ctx.bal.manual.setAngle(hip, 0, fiRestAb, 80, 10);   // ★ 保持自然外展（原 0=中线→内收）
        // ★ 自主计算前弯（用户定调 2026-10：鞠躬后抬腿居然平衡了——固定 −0.15 不够）：
        //   文献：单腿的预防策略=**CoM 前移**（支撑面小防向后倒）。闭环：目标 comX=+0.025，
        //   按实测灵敏度 ~0.3 m/rad 反推所需弯腰角（负=前弯），限幅 0.40。
        const COM_FWD_TGT = 0.06;   // 自主前弯目标（0.06 综合最优）
        // ★ 用户定调（硬要求）：**抬脚时要持续弯腰**——闭环会随 CoM 前移变浅（违背），
        //   改为**单调棘轮**：弯腰只深不浅（bendPeak 记录历史最深），并随抬腿进程持续加深。
        const ramp = 0.03 * Math.min(1, liftT / 0.55);                    // 进程持续加深项（温和）
        const loop = (COM_FWD_TGT - ctx.sensors.com[0]!) / 0.3;          // comX 闭环项
        bendPeak = Math.max(bendPeak, Math.max(0.08, Math.min(0.45, loop + ramp)));
        const bendAuto = -bendPeak;
        // ★ (a) 动作层：弯腰同步把骨盆推前（−0.05 温和；−0.10 实测 0.162 过强）
        ctx.bal.manual.setAngle(supHip, 2, -0.05, 150, 15);
        // ★ (b) 伺服 L1-Future：骨盆前移前馈（随弯深联动）
        pelvisForward(ctx, support, bendPeak);

        ctx.bal.setTrunkRef(bendAuto);
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          ctx.bal.manual.setAngle(sn, 2, bendAuto, 180, 20);
        }
        // ★ 向前甩臂（A 相末已启动；B 相保持/微调——−=前屈）
        if (armT < 0) armT = 0;
        armT += dt;
        const armSw = Math.min(0.55, Math.max(0, 0.55 * (armT - 0.08) / 0.12));   // 向前甩（推迟 0.15s）
        ctx.bal.manual.setAngle('shoulder_l', 2, armSw, 120, 15);
        ctx.bal.manual.setAngle('shoulder_r', 2, armSw, 120, 15);
        stanceLock(ctx, support);
        unloadComp(ctx, support);   // ★ 支撑腿向下发力：摆动腿卸载的力同步补上
        liftT += dt;
      },
      done: (ctx) => !shiftOk || (liftT > 0.55 && fi(ctx).fz < 0.05 * W(ctx) && fi(ctx).y > groundY + 0.02),
      // 离地 = 持续卸载 0.55s（+2cm 保障；浅架峰值只有 3-4cm，用高度判据必超时）
      onTimeout: () => { /* 保持转移状态，交 C/D/E 兜底 */ },
    },
    {
      name: 'C保持',
      timeout: holdSeconds,
      enter: (ctx) => {
        cT = 0;
        ctx.bal.setTrunkRef(0);   // ★ 弯腰参考归零（C 相起 sagittalStab 接管）
        // ★ 落脚段：手臂交伺服层（用户定调）——清动作层写戳，momReg 自动接管
        ctx.bal.manual.clearAngle('shoulder_l', 2);
        ctx.bal.manual.clearAngle('shoulder_r', 2);
      },
      update: (ctx, dt) => {
        cT += dt;
        if (!shiftOk) return;
        const pull = 0;   // 【试：同 B】
        ctx.bal.setComTarget(0, supportZ0 + pull + counterbalanceZ(fi(ctx).z, fiRestZ));
        // 落点 = footfall 策略（CoM 外推 + 防撞带）；寻找器全权驱动腿；悬停 2cm
        const ff = defaultFootfall({
          comX: ctx.sensors.com[0]!, vx: ctx.sensors.comVel[0]!,
          comZ: ctx.sensors.com[2]!, vz: ctx.sensors.comVel[2]!,
          supportZ0, restZ: fiRestZ,
        });
        // ★ C 保持 = **轻触保持**（0.5cm，而非悬停 2cm）：摆动脚的 CoP 在轻触时即可用——
        //   漂移需要的 CoP 在摆动脚那侧，悬空时物理上够不到（实测 D 里支撑卸载 Rfz 48% 的根因）；
        //   人类单腿站立也正是"另一只脚轻触"。
        ensureSeek(ctx).seek(dt, ff.x, ff.z, 0.005, fi(ctx));
        // ★ 着地增刚（文献：接触时拮抗肌共收缩增刚度——Latash；"抓地"的力学本质）：
        //   轻触脚一旦吃到负载（fz>3%W），其腿**变硬接住**——否则轻腿接不住负载，
        //   有效 CoP 卡在支撑脚外侧 → CoM 内加速度 0.3-0.5（实测回读的倒下直接原因）。
        if (fi(ctx).fz > 0.03 * W(ctx)) {
          const st = ensureSeek(ctx).state;
          ctx.bal.manual.setAngle(hip, 2, st.l2, 200, 8);
          ctx.bal.manual.setAngle(knee, 2, st.k, 200, 8);
          ctx.bal.manual.setAngle(hip, 0, st.ab, 120, 8);
        }
        reactionComp(ctx, support, ctx.bal.supportState.phase === 'hold' ? 0.8 : 0.5);
        trunkSupport(ctx, support);
        stanceLock(ctx, support);
        sag.step(ctx, 1.0, dt);
        lateralStab(ctx, ctx.sensors.com[2]! - supportZ0);
      },
      done: (ctx) => {
        // 安全早落（倒了也要向内侧、放下腿来）
        return Math.abs(ctx.sensors.com[2]! - supportZ0) > 0.06
          || Math.abs(ctx.sensors.comVel[2]!) > 0.15
          || Math.abs(ctx.sensors.com[0]!) > 0.09
          || (cT > 0.2 && ctx.bal.supportState.marginZ < -0.02);
      },
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


        reactionComp(ctx, support, ctx.bal.supportState.phase === 'hold' ? 0.8 : 0.5);
        trunkSupport(ctx, support);
        ctx.bal.setComTarget(0, supportZ0 + counterbalanceZ(fi(ctx).z, fiRestZ));
        stanceLock(ctx, support);
        sag.step(ctx, 0.5, dt);
        lateralStab(ctx, (ctx.sensors.com[2]! - supportZ0) * 0.5);
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
        reactionComp(ctx, support, ctx.bal.supportState.phase === 'hold' ? 0.8 : 0.5);
        trunkSupport(ctx, support);
        stanceLock(ctx, support);
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

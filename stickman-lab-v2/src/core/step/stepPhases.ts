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
import { transferTarget, counterbalanceZ, leanRegulator, stanceTuning } from './stanceBalance';

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
  const ensureSeek = (ctx: PhaseCtx): LandingSeek =>
    (seek ??= new LandingSeek(ctx.bal.manual, hip, knee, foot));
  const angOf = (ctx: PhaseCtx, name: string, ax: number): number => {
    const i = ctx.body.dofByName(name, ax);
    return i >= 0 ? ctx.body.dofs[i]!.angle : 0;
  };

  /** ★ 稳定模式执行：把调节器的输出写到脊柱（分 3 节） */
  /** ★ 承重膝**绷直上锁**（用户定调：腿绷直=骨骼轴向承重无上限；弯/斜=靠肌肉顶力矩必饱和）。
   *  强刚度写 0；消力反射对 pin 轴让位（isActive 查 pin）。 */
  const writeStanceKnee = (ctx: PhaseCtx): void => {
    // ★ 力链实测：膝角本来≈0（不是位置问题）；85 N·m 来自别的扭矩/激活通道（kp 无效）——
    //   下一轮追写手（load-brace / 基线激活 / ff），这里保持原增益。
    ctx.bal.manual.setAngle(`knee_${support}`, 2, 0, 400, 4);   // ★ kd 按铁律 0.02·τmax（40 诱发阻尼极限环：实测阻尼 −75 封顶）
  };
  const writeStab = (ctx: PhaseCtx, errZ: number, errX: number): void => {
    if (stanceTuning.stabKz === 0 && stanceTuning.stabKx === 0) return;
    const lr = leanRegulator(errZ, errX);
    for (const sn of ['spine1', 'spine2', 'spine3']) {
      ctx.bal.manual.setAngle(sn, 0, lr.lean0, 500, 40);   // ★ 腰的力：全量写到每节（原 /3 = 只剩 1/3 权限）
      ctx.bal.manual.setAngle(sn, 2, lr.lean2, 500, 40);
    }
  };
  let groundY = 0, supportZ0 = 0, fiRestZ = 0, shiftT = 0, inited = false;
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
          inited = true;
        }
        shiftT += dt;
        // ★ 用户定调：重心预先往支撑侧**多偏一点**（目标越过支撑脚 2.5cm）——
        //   起始就更靠支撑侧，抬腿后往抬起侧的漂移有更多余量。
        const pre = supportZ0 + Math.sign(supportZ0) * 0.025;
        ctx.bal.setComTarget(0, transferTarget(shiftT, pre));
      },
      done: (ctx) => {
        // ★ 闸门（人类同款：重心到支撑脚上方才允许抬；余量放宽——达成完美精度不容易）
        // ★ 用户定调：重心要**全压在单腿**上再抬（回读证据：旧 6cm 余量=抬腿全程重心没到位）；
        //   收紧到 3.5cm；兜底（超时无条件抬）仍保留 → 抬腿概率不受影响。
        shiftOk = si(ctx).fz > 0.6 * W(ctx)
          && fi(ctx).fz < 0.25 * W(ctx)
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
        for (const sn of ['spine1', 'spine2', 'spine3']) {   // ★ 稳定模式的执行器归动作
          ctx.bal.manual.pin(sn, 0);
          ctx.bal.manual.pin(sn, 2);
        }
        ctx.bal.manual.pin(`knee_${support}`, 2);   // ★ 承重膝绷直归动作（消力让位）
      },
      update: (ctx, dt) => {
        if (!shiftOk) return;
        // ★ 用户定调"边抬边调整"：目标 = 支撑脚**外越 1.5cm**（把实际重心拉满压上）+
        //   抬腿质量变化的实时配重（counterbalanceZ，边抬边算）
        const pull = Math.sign(supportZ0) * 0.025;
        ctx.bal.setComTarget(0, supportZ0 + pull + counterbalanceZ(fi(ctx).z, fiRestZ));
        // ★ B 抬腿 = 强制命令（唯一写死关节角的段）：抬过事件线即交寻找器
        const s = ensureSeek(ctx).state;
        s.l2 = app(s.l2, 0.60, 1.5, dt);
        s.k = app(s.k, -0.90, 1.5, dt);
        s.f = app(s.f, 0.08, 1.5, dt);
        ctx.bal.manual.setAngle(hip, 2, s.l2, 40, 4);    // ★ 摆腿轻 + kd 铁律 0.02·τmax
        ctx.bal.manual.setAngle(knee, 2, s.k, 40, 4);
        ctx.bal.manual.setAngle(foot, 2, s.f, 25, 3);
        ctx.bal.manual.setAngle(hip, 0, 0, 30, 3);   // 外摆软中性
        writeStanceKnee(ctx);
        liftT += dt;
      },
      done: (ctx) => !shiftOk || (liftT > 0.55 && fi(ctx).fz < 0.05 * W(ctx) && fi(ctx).y > groundY + 0.02),
      // 离地 = 持续卸载 0.55s（+2cm 保障；浅架峰值只有 3-4cm，用高度判据必超时）
      onTimeout: () => { /* 保持转移状态，交 C/D/E 兜底 */ },
    },
    {
      name: 'C保持',
      timeout: holdSeconds,
      enter: () => { cT = 0; },
      update: (ctx, dt) => {
        cT += dt;
        if (!shiftOk) return;
        const pull = Math.sign(supportZ0) * 0.025;   // 保持期继续"全压"（若早落前挤出）
        ctx.bal.setComTarget(0, supportZ0 + pull + counterbalanceZ(fi(ctx).z, fiRestZ));
        // 落点 = footfall 策略（CoM 外推 + 防撞带）；寻找器全权驱动腿；悬停 2cm
        const ff = defaultFootfall({
          comX: ctx.sensors.com[0]!, vx: ctx.sensors.comVel[0]!,
          comZ: ctx.sensors.com[2]!, vz: ctx.sensors.comVel[2]!,
          supportZ0,
        });
        // ★ C 保持 = **轻触保持**（0.5cm，而非悬停 2cm）：摆动脚的 CoP 在轻触时即可用——
        //   漂移需要的 CoP 在摆动脚那侧，悬空时物理上够不到（实测 D 里支撑卸载 Rfz 48% 的根因）；
        //   人类单腿站立也正是"另一只脚轻触"。
        ensureSeek(ctx).seek(dt, ff.x, ff.z, 0.005, fi(ctx));
        writeStanceKnee(ctx);
        writeStab(ctx, ctx.sensors.com[2]! - supportZ0, ctx.sensors.com[0]!);
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
          supportZ0,
        });
        ensureSeek(ctx).seek(dt, ff.x, ff.z, 0.0, fi(ctx));   // 强制：目标高度→0（放脚触地）
        ctx.bal.setComTarget(0, supportZ0 + counterbalanceZ(fi(ctx).z, fiRestZ));
        writeStanceKnee(ctx);
        writeStab(ctx, (ctx.sensors.com[2]! - supportZ0) * 0.5, ctx.sensors.com[0]! * 0.5);
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
        writeStanceKnee(ctx);
        writeStab(ctx, ctx.sensors.com[2]! - (ctx.sensors.feet[0]!.z + ctx.sensors.feet[1]!.z) / 2, ctx.sensors.com[0]! * 0.5);
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
          ctx.bal.manual.clearAngle(`knee_${support}`, 2);
          ctx.bal.manual.pin(`knee_${support}`, 2, false);
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

/** holdPhases.ts —— 单腿保持（用户设计：把腿移到固定位置 → 持续注入基础力+张力 → 回正往基础力姿态回）
 *
 *  替代旧 A/B/C/D 相位机（stepPhases 已删）：不做转移/抬腿/落腿编排，只有两段：
 *   ① 摆腿：动作层把摆动腿摆到固定位置（髋 0.45 / 膝 −0.75 / 踝 0.08）＋ CoM 目标滑向自然单腿站姿
 *          （支撑踝 前1.5cm / 内3.3cm——法庭③标定）
 *   ② 保持：支撑柱＋摆腿柱（基础力）每帧注入；回正目标=基础力姿态（进相捕获＋交接跳变）
 *
 *  摆动腿基础力由 isLiftDone 门控（抬腿完成后才上岗——防基础力与摆腿伺服对打）。
 */
import { propose, PRI } from '../proposalBus';
import { supportColumn, swingColumn, cleanModeOn, setLiftDone } from '../servo/supportReg';
import { supportCleanReset } from '../servo/supportClean';
import type { Phase, PhaseCtx } from '../program';

export interface HoldOptions {
  support: 'l' | 'r';
  hold: number;
}

export function holdPhases(opts: HoldOptions = { support: 'r', hold: 30.0 }): Phase[] {
  const support = opts.support;
  const lift: 'l' | 'r' = support === 'l' ? 'r' : 'l';
  let moveT = 0;
  let liftT0: number | null = null;
  let cCom0: { x: number; z: number } | null = null;
  const tgt = { x: 0, z: 0, init: false };   // ★ 目标轨迹（缓移：只允许 5cm/s 逼近自然站姿——防大误差点燃 kCom 猛甩）
  /** 自然单腿站姿 CoM = 支撑踝 +（前 1.5cm、内 3.3cm）——法庭③标定的"基础力姿态" */
  const naturalCom = (ctx: PhaseCtx): { x: number; z: number } => {
    const di = ctx.body.dofByName(`foot_${support}`, 2);
    const a = di >= 0 ? ctx.body.dofs[di]!.anchorWorld : [0, 0, 0];
    return { x: a[0]! + 0.015, z: a[2]! - Math.sign(a[2]!) * 0.033 };
  };
  return [
    {
      name: '摆腿',
      timeout: 3.0,
      enter: () => { moveT = 0; liftT0 = null; tgt.init = false; setLiftDone(false); },
      update: (ctx, dt) => {
        moveT += dt;
        // ① 目标轨迹缓移：从当前 com 以 5cm/s 逼近自然站姿（误差始终小；双脚都在=转移权限足）
        const nc = naturalCom(ctx);
        if (!tgt.init) { tgt.x = ctx.sensors.com[0]!; tgt.z = ctx.sensors.com[2]!; tgt.init = true; }
        const step = 0.05 * dt;
        const dx = nc.x - tgt.x, dz = nc.z - tgt.z;
        tgt.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
        tgt.z += Math.abs(dz) <= step ? dz : Math.sign(dz) * step;
        ctx.bal.setComTarget(tgt.x, tgt.z);
        // ② 转移到位（com 到自然位 ±5cm——必须双脚承重期间完成；单脚 CoP 权限不够，会内飞）后才摆腿
        const near = Math.abs(ctx.sensors.com[2]! - nc.z) < 0.05;
        if (liftT0 === null && moveT > 0.3 && near) liftT0 = moveT;
        if (liftT0 !== null) {
          const s = Math.min(1, (moveT - liftT0) / 0.7);
          const e = s * s * (3 - 2 * s);   // smoothstep
          for (const [jn, tgt] of [['hip', 0.45], ['knee', -0.75], ['foot', 0.08]] as Array<[string, number]>) {
            const di = ctx.body.dofByName(`${jn}_${lift}`, 2);
            if (di >= 0) propose({ dof: di, kind: 'angle', pri: PRI.action, rad: tgt * e, kp: 140, kd: 14, src: 'holdPhases' });
          }
        }
        // ★ 基础力/回正随行注入（kCom 髋份额=转移的侧倾机制；增益用 SC_KCOM 控制，防大误差猛甩）
        supportColumn(ctx, support);
        if (cleanModeOn()) swingColumn(ctx, lift);
      },
      done: () => moveT >= 4.0 || (liftT0 !== null && moveT >= liftT0 + 0.9),
    },
    {
      name: '保持',
      timeout: opts.hold,
      enter: (ctx) => {
        setLiftDone(true);   // ★ 抬腿完成 → 摆动腿基础力上岗（用户："抬腿结束后摆动腿也受基础力控制"）
        if (cleanModeOn()) supportCleanReset();
        cCom0 = naturalCom(ctx);   // ★ 回正目标=基础力姿态（用户："回正力都是往基础力的姿态回正"）
        ctx.bal.setComTarget(cCom0.x, cCom0.z);   // 交接跳变：立即生效（防守护慢爬期间外推）
      },
      update: (ctx) => {
        if (cCom0) ctx.bal.setComTarget(cCom0.x, cCom0.z);
        supportColumn(ctx, support);
        if (cleanModeOn()) swingColumn(ctx, lift);
      },
      done: () => false,
    },
  ];
}

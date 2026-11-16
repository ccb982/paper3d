/** _tmp-disp.ts —— 关节世界完整位移回读（单腿 R 支撑；基准=liftDone 时刻）
 *  表1：水平位移 dx,dz（cm）；表2：竖直位移 dy（cm）——逐点×逐时刻（+0.5~+3.0s）
 *  点：踝R/膝R/髋R/盆/腰骶/胸/头/踝L/CoM（关节锚点世界坐标/刚体世界坐标）
 *  用法：node tools/run.mjs _tmp-disp
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const idx = body.indexByKey;

const anchorOf = (n: string, ax: number): (() => [number, number, number]) => {
  const i = body.dofByName(n, ax);
  return () => {
    const a = body.dofs[i]!.anchorWorld;
    return [a[0]!, a[1]!, a[2]!];
  };
};
const transOf = (k: string): (() => [number, number, number]) => {
  const i = idx.get(k)!;
  return () => { const t = body.bodies[i]!.translation(); return [t.x, t.y, t.z]; };
};
const PTS: Array<[string, () => [number, number, number]]> = [
  ['踝R', anchorOf('foot_r', 2)],
  ['膝R', anchorOf('knee_r', 2)],
  ['髋R', anchorOf('hip_r', 2)],
  ['盆', transOf('torso')],
  ['腰骶', anchorOf('spine1', 2)],
  ['胸', transOf('spine4')],
  ['头', transOf('head')],
  ['踝L', anchorOf('foot_l', 2)],
  ['CoM', () => [ctl.sensors.com[0]!, ctl.sensors.com[1]!, ctl.sensors.com[2]!]],
];

const TIMES = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
let base: number[][] | null = null;
let tLift = -1;
const disp: Array<Array<[number, number, number] | null>> = PTS.map(() => TIMES.map(() => null));
let tiltAt: string[] = [];
const yawAt: string[] = [];
const DEG = 180 / Math.PI;
const yawOf = (k: string): number => {
  const q = body.bodies[idx.get(k)!]!.rotation();
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * DEG;
};
const copAt: string[] = [];
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) {
    if (!isLiftDone()) continue;
    tLift = t;
    base = PTS.map(([, f]) => f());
    console.log(`liftDone t=${t.toFixed(2)}s 基准已捕获（世界坐标）`);
    for (const [nm, f] of PTS) { const p = f(); console.log(`  ${nm}: x=${p[0].toFixed(3)} y=${p[1].toFixed(3)} z=${p[2].toFixed(3)}`); }
    continue;
  }
  const dt = t - tLift;
  for (let k = 0; k < TIMES.length; k++) {
    if (dt >= TIMES[k]! && disp[0]![k] === null) {
      for (let p = 0; p < PTS.length; p++) {
        const now = PTS[p]![1]();
        disp[p]![k] = [now[0] - base![p]![0]!, now[1] - base![p]![1]!, now[2] - base![p]![2]!];
      }
      tiltAt[k] = `${ctl.sensors.torsoTilt[1]! * 57.3 >= 0 ? '+' : ''}${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)}`;
      yawAt[k] = `足R ${yawOf('foot_r').toFixed(1)} / 盆 ${yawOf('torso').toFixed(1)} / 胸 ${yawOf('spine4').toFixed(1)}`;
      const fr = ctl.sensors.feet[1]!;
      const fl = ctl.sensors.feet[0]!;
      copAt[k] = `足R CoP(${fr.copX.toFixed(2)},${fr.copZ.toFixed(2)}) fz=${fr.fz.toFixed(0)} | 足L fz=${fl.fz.toFixed(0)}`;
    }
  }
}
const cell = (d: [number, number, number] | null): string => d ? `${(d[0] * 100).toFixed(1)},${(d[2] * 100).toFixed(1)}`.padStart(12) : '-'.padStart(12);
const cellY = (d: [number, number, number] | null): string => d ? `${(d[1] * 100).toFixed(1)}`.padStart(7) : '-'.padStart(7);
console.log('\n── 表1 水平位移 dx,dz (cm) ──');
console.log('点'.padEnd(6) + TIMES.map((x) => `+${x.toFixed(1)}`.padStart(12)).join(''));
for (let p = 0; p < PTS.length; p++) console.log(PTS[p]![0].padEnd(6) + TIMES.map((_, k) => cell(disp[p]![k]!)).join(''));
console.log('\n── 表2 竖直位移 dy (cm) ──');
console.log('点'.padEnd(6) + TIMES.map((x) => `+${x.toFixed(1)}`.padStart(7)).join(''));
for (let p = 0; p < PTS.length; p++) console.log(PTS[p]![0].padEnd(6) + TIMES.map((_, k) => cellY(disp[p]![k]!)).join(''));
console.log(`\n躯干 roll 在各时刻(°): ${TIMES.map((x, k) => `+${x}:${tiltAt[k] ?? '-'}`).join('  ')}`);
console.log('\n── 表3 世界偏航（°）与接触 ──');
for (let k = 0; k < TIMES.length; k++) console.log(`+${TIMES[k]!.toFixed(1)}s  ${yawAt[k] ?? '-'}  |  ${copAt[k] ?? '-'}`);

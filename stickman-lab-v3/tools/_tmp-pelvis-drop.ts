/** _tmp-pelvis-drop.ts —— 盆骨"抬腿侧下沉"回读（用户：盆骨抬腿侧力矩不够，容易掉下去）
 *  用法：node tools/run.mjs _tmp-pelvis-drop [seed?]   seed=复刻随机预历史起点；缺省=干净起点
 *  输出：保持期每 0.1s —— 髋连线横滚（盆线下沉直读）、支撑髋角、主动力矩、伺服、躯干滚
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SEED = ARGS[0] ? Number(ARGS[0]) : 0;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
ctl.actions.idleEnabled = true;
if (SEED) {
  const m32 = (sd: number): (() => number) => {
    let a = sd >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  (Math as { random: () => number }).random = m32(SEED);
  const tPre = 0.5 + Math.random() * 8;
  for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
}
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
const drive = (ctl.warner as unknown as {
  drive: { lastBreakdown: Array<{ act: number; servo: number; stiff: number; itb: number; damp: number; ff: number; lum: number }> };
}).drive;
const dhL = w.body.dofByName('hip_l', 0), dhR = w.body.dofByName('hip_r', 0);
let tLift = -1, nextMark = 0;
for (let s = 0; s < Math.round(14.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const liftNow = tLift < 0 && isLiftDone();
  if (liftNow) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
  if (tLift >= 0 && t >= nextMark) {
    const aL = w.body.dofs[dhL]!.anchorWorld, aR = w.body.dofs[dhR]!.anchorWorld;
    const dz = (aR[2]! - aL[2]!) * 100, dy = (aR[1]! - aL[1]!) * 100;
    const pelvRoll = Math.atan2(dy, dz) * DEG;   // 髋连线相对水平（正负=哪侧沉）
    const act = drive.lastBreakdown[dhR]?.act ?? 0;
    const servo = drive.lastBreakdown[dhR]?.servo ?? 0;
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    console.log(`+${(t - tLift).toFixed(1)}s 盆线滚=${pelvRoll.toFixed(1).padStart(6)}°(Δy=${dy.toFixed(1)} Δz=${dz.toFixed(1)}cm) 髋R角=${(w.body.dofs[dhR]!.angle * DEG).toFixed(1).padStart(6)}° 髋R主动=${act.toFixed(1).padStart(6)} 伺服=${servo.toFixed(1).padStart(6)} 躯滚=${roll.toFixed(1).padStart(5)}°`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 4.0) break;
}

/** _tmp-upper-rigid.ts —— 上身受力解剖（用户："关闭上身所有力；强制固定上身；回读各部分拉力来自哪"）
 *  用法：UPPER_OFF=1 node tools/run.mjs _tmp-upper-rigid [seed=4] [Tmax=8]
 *  流程：种子预历史 → play → 单腿成立瞬间：脊柱 6 轴高刚 setAngle（θ₀, kp2500/kd80）+ pin；
 *        随后每 0.1s 回读：脊柱 6 轴的服伺负载（伺）/净 + 腿链（髋2/膝2/踝电机）+ CoM。
 *  读法：脊柱伺=躯干负载的真实需求（"来自哪部分"=髋/膝/踝链承担多少 vs 脊柱内部多少）。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SEED = Number(ARGS[0] ?? 4);
const TMAX = Number(ARGS[1] ?? 8);
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
(Math as { random: () => number }).random = mulberry32(SEED * 100 + 1);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = true;
resetFootLateral();
const tPre = 0.5 + Math.random() * TMAX;
for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
const manual = (ctl.warner as unknown as { manual: { setAngle(j: string, a: number, r: number, kp?: number, kd?: number): void; pin(j: string, a: number, v: boolean): void } }).manual;
const dr = (ctl.warner as unknown as { drive: { legReflex?: { side: string | null }; lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number }> } }).drive;
const legSide = (): string | null => dr.legReflex?.side ?? null;
const spineAxes: Array<[string, number]> = [];
for (const sn of ['spine1', 'spine2', 'spine3']) for (const ax of [0, 2]) spineAxes.push([sn, ax]);
const spIdx = spineAxes.map(([n, a]) => w.body.dofByName(n, a));
const legAxes: Array<[string, number]> = [['hip_r', 2], ['knee_r', 2], ['foot_r', 2], ['foot_r', 0], ['hip_r', 0]];
const legIdx = legAxes.map(([n, a]) => w.body.dofByName(n, a));
const FREEZE = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.FREEZE ?? '0') === '1';   // 默认关：脚正常撑地，锁=真实受力读数
let captured = false, tLift = -1, nextMark = 0;
const frozenBodies: Array<{ idx: number; p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }> = [];
for (let s = 0; s < Math.round(12.0 / w.dt); s++) {
  // 单腿成立瞬间：强制固定上身（超高刚伺服锁；FREEZE=1 时才加世界冻结）
  if (!captured && legSide() !== null) {
    captured = true;
    spineAxes.forEach(([n, a], k) => {
      const i = spIdx[k]!;
      if (i < 0) return;
      manual.setAngle(n, a, w.body.dofs[i]!.angle, 20000, 300);
      manual.pin(n, a, true);
    });
    if (FREEZE) {
      for (const key of ['spine1', 'spine2', 'spine3', 'torso']) {
        const idx = w.body.indexByKey.get(key);
        if (idx === undefined) continue;
        const rb = w.body.bodies[idx]!;
        frozenBodies.push({ idx, p: { ...rb.translation() }, q: { ...rb.rotation() } });
      }
    }
    console.log(`★上身锁死(超刚伺服锁${FREEZE ? '+世界冻结' : ''}) @side=${legSide()}`);
  }
  // 世界冻结（FREEZE=1 时每帧回置；默认关=脚正常撑地）
  for (const f of frozenBodies) {
    const rb = w.body.bodies[f.idx]! as unknown as {
      setTranslation(t: { x: number; y: number; z: number }, wake: boolean): void;
      setRotation(q: { x: number; y: number; z: number; w: number }, wake: boolean): void;
      setLinvel(v: { x: number; y: number; z: number }, wake: boolean): void;
      setAngvel(v: { x: number; y: number; z: number }, wake: boolean): void;
    };
    rb.setTranslation(f.p, true);
    rb.setRotation(f.q, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0 && isLiftDone()) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
  if (tLift >= 0 && t >= nextMark) {
    let sum0 = 0, sum2 = 0;
    const cells = spineAxes.map(([n, a], k) => {
      const i = spIdx[k]!;
      if (i < 0) return `${n}/${a}:-`;
      const d0 = w.body.dofs[i]!;
      if (d0.engineMotor) {
        const mt = (d0 as unknown as { motorTqEst?: number }).motorTqEst ?? 0;
        if (a === 0) sum0 += mt; else sum2 += mt;
        return `${n}/${a}:${mt.toFixed(0).padStart(4)}`;
      }
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      const f = b.act + b.servo + b.stiff + b.damp;
      if (a === 0) sum0 += f; else sum2 += f;
      return `${n}/${a}:${f.toFixed(0).padStart(4)}`;
    });
    const legs = legAxes.map(([n, a], k) => {
      const i = legIdx[k]!;
      if (i < 0) return `${n}/${a}:-`;
      const d0 = w.body.dofs[i]!;
      if (d0.engineMotor) return `${n}/${a}:电${(((d0 as unknown as { motorTqEst?: number }).motorTqEst ?? 0)).toFixed(0).padStart(4)}`;
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      return `${n}/${a}:净${(b.act + b.servo + b.stiff + b.damp).toFixed(0).padStart(4)}`;
    });
    const dHL = w.body.dofByName('hip_l', 0), dHR = w.body.dofByName('hip_r', 0);
    const aL = dHL >= 0 ? w.body.dofs[dHL]!.anchorWorld : [0, 0, 0, 0];
    const aR = dHR >= 0 ? w.body.dofs[dHR]!.anchorWorld : [0, 0, 0, 0];
    const pelvY = (aL[1]! + aR[1]!) / 2 * 100;
    const pelvZ = (aL[2]! + aR[2]!) / 2 * 100;
    const pelvRoll = Math.atan2(aR[1]! - aL[1]!, aR[2]! - aL[2]!) * DEG;
    console.log(`+${(t - tLift).toFixed(1)}s 前=${(ctl.sensors.torsoTilt[0]! * DEG).toFixed(1).padStart(5)} 左=${(ctl.sensors.torsoTilt[1]! * DEG).toFixed(1).padStart(5)} 侧=${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} [吊车力: 左右Σ=${sum0.toFixed(0).padStart(4)} 前后Σ=${sum2.toFixed(0).padStart(4)}] [下方: 盆高=${pelvY.toFixed(0)} 盆侧=${pelvZ.toFixed(0)} 盆滚=${pelvRoll.toFixed(0)}°] | ${cells.join(' ')} || ${legs.join(' ')}`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 2.5) break;
}

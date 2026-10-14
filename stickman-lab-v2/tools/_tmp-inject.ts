/** _tmp-inject.ts —— 上身防御重写的前置对照（用户："手动注入上身版本对照的是冻结上身的版本，因为要抛弃现在的上身防御模块"）
 *  MODE=frozen：上身力全关 + 刚体上身（世界冻结+脊柱锁）——对照基线
 *  MODE=inj   ：上身力全关 + 手动注入（腰 spine1 轴0/轴2 ← 上身子树绕支撑髋的活体重力矩）——新防御原型
 *  MODE=ctrl  ：现行模块（参考）。腿链（承重+摆动）三种模式都保持系统正常控制。
 *  INJ_SGN=±1 注入符号。观察：com dx/dz、倾角、支撑 fz、注入值。
 */
import './_boot';
import fs from 'node:fs';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';
import { setUpperOff, setRigidUpper, freezeUpperStep } from '../src/core/servo/rescue';

const ENV = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
const MODE = ENV.MODE ?? 'inj';
const SGN = Number(ENV.INJ_SGN ?? 1);
const REC_FILE = '.tmp/tq-rec.json';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
ctl.actions.play('singleLegR');
const gY = w.world.gravity.y;
const DEG = 180 / Math.PI;

  if (MODE === 'frozen' || MODE === 'inj' || MODE === 'recf') setUpperOff(true);
  if (MODE === 'frozen' || MODE === 'recf') setRigidUpper(true);
let modeApplied = false;
const applyMode = (): void => {
  modeApplied = true;
  if (MODE === 'frozen' || MODE === 'inj' || MODE === 'recf' || MODE === 'reco' || MODE === 'replay') setUpperOff(true);
  if (MODE === 'frozen' || MODE === 'recf') setRigidUpper(true);
  if (MODE === 'soft') {
    setUpperOff(true);
    for (let k = 0; k < upDofs.length; k++) soft0[k] = w.body.dofs[upDofs[k]!]!.angle;
    console.log(`软冻结目标角: ${[...soft0].map((v) => ((v * 180) / Math.PI).toFixed(1)).join(',')}`);
  }
};

// ★ 三组关节清单（上身 spine 全段 0/2 轴 + 承重腿 + 摆动腿）
const upDofs: number[] = [];
for (let i = 0; i < w.body.dofs.length; i++) {
  const d = w.body.dofs[i]!;
  if (/^spine/.test(d.name) && (d.axis === 0 || d.axis === 2)) upDofs.push(i);
}
const supDofs = [['hip_r', 0], ['hip_r', 2], ['knee_r', 2], ['foot_r', 2]].map(([n, ax]) => w.body.dofByName(n as string, ax as number));
const swDofs = [['hip_l', 0], ['hip_l', 2], ['knee_l', 2], ['foot_l', 2]].map(([n, ax]) => w.body.dofByName(n as string, ax as number));
const recDofs = [...upDofs, ...supDofs, ...swDofs];
const recNames = [...upDofs.map((di) => `${w.body.dofs[di]!.name}/${w.body.dofs[di]!.axis}`), 'hip_r/0', 'hip_r/2', 'knee_r/2', 'foot_r/2', 'hip_l/0', 'hip_l/2', 'knee_l/2', 'foot_l/2'];
type Rec = { frozen?: number[][]; off?: number[][] };
let recData: Rec = {};
if (MODE === 'replay') recData = JSON.parse(fs.readFileSync(REC_FILE, 'utf8')) as Rec;
const recFrames: number[][] = [];   // 本进程录制
const recVel: number[][] = [];      // 同录关节速度（查锁伪迹用）
const drOf = (): { lastBreakdown: Array<{ act: number }> } => (ctl.warner as unknown as { drive: { lastBreakdown: Array<{ act: number }> } }).drive;
// ★ MODE=soft：闭环软冻结（直接力矩 PD，拉向抬腿时刻姿态）
const SOFT_KP = Number(ENV.SOFT_KP ?? 600);
const SOFT_KD = Number(ENV.SOFT_KD ?? 30);
const WORLD = ENV.WORLD === '1';
const W_SGN = Number(ENV.W_SGN ?? 1);
const soft0 = new Float64Array(upDofs.length);
let softRoll0 = 0, softPitch0 = 0;

const injDofs: Array<[string, number]> = [['spine1', 0], ['spine1', 2]];
const injIdx = injDofs.map(([n, ax]) => w.body.dofByName(n, ax));
const hipR0 = w.body.dofByName('hip_r', 0);

/** 上身子树绕支撑髋的重力矩（轴投影；竖直重力矩与轴高度无关） */
const upperTau = (di: number): number => {
  if (di < 0 || hipR0 < 0) return 0;
  const d = w.body.dofs[di]!;
  const u = d.axisWorld;
  const a = w.body.dofs[hipR0]!.anchorWorld;
  let tau = 0;
  for (const [k, bi] of w.body.indexByKey.entries()) {
    if (!/^(torso|spine|head|neck|arm|hand)/.test(k)) continue;
    const rb = w.body.bodies[bi]!;
    const c = rb.worldCom();
    const m = rb.mass();
    const Fy = m * gY;
    tau += u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
  }
  return -tau;
};

let tLift = -1, nextMark = 0, recIdx = 0;
for (let s = 0; s < Math.round(10.0 / w.dt); s++) {
  if (modeApplied && (MODE === 'frozen' || MODE === 'recf')) {
    freezeUpperStep(
      w.body as unknown as { indexByKey: Map<string, number>; bodies: Array<unknown>; dofByName(j: string, a: number): number },
      (ctl.warner as unknown as { manual: unknown }).manual as never,
    );
  }
  w.advance(1, () => {
    if (tLift < 0) return;
    if (MODE === 'inj') {
      for (const di of injIdx) {
        const t = upperTau(di) * SGN;
        if (t !== 0) w.executor.addTorque(di, t);
      }
    }
    if (MODE === 'soft') {
      for (let k = 0; k < upDofs.length; k++) {
        const d = w.body.dofs[upDofs[k]!]!;
        const t = -SOFT_KP * (d.angle - soft0[k]!) - SOFT_KD * d.vel;
        if (t !== 0) w.executor.addTorque(upDofs[k]!, t);
      }
    }
    if (MODE === 'replay') {
      const fz = recData.frozen?.[recIdx], off = recData.off?.[recIdx];
      if (fz) {
        for (let k = 0; k < upDofs.length; k++) {
          const v = ((fz[k] ?? 0) - (off?.[k] ?? 0)) * SGN;
          if (v !== 0) w.executor.addTorque(upDofs[k]!, v);
        }
      }
    }
  });
  const t = s * w.dt;
  if (tLift < 0 && isLiftDone()) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s MODE=${MODE} SGN=${SGN}`); applyMode(); }
  if (tLift >= 0 && t > tLift + 1e-9) {
    if (MODE === 'recf' || MODE === 'reco') {
      recFrames.push(recDofs.map((di) => (di >= 0 ? w.executor.ledger[di]?.applied ?? 0 : 0)));   // ★ 总账（含 warner 重力补偿通道）
      recVel.push(recDofs.map((di) => (di >= 0 ? w.body.dofs[di]!.vel : 0)));
    }
    else if (MODE === 'replay') recIdx++;
  }
  if (tLift >= 0 && t >= nextMark) {
    const com = ctl.sensors.com;
    const pitch = ctl.sensors.torsoTilt[0]! * DEG;
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    const fz = ctl.sensors.feet[1]!.fz;
    const inj = injIdx.map((di) => upperTau(di).toFixed(0).padStart(4)).join('/');
    console.log(`+${(t - tLift).toFixed(1)}s com=(dx=${(com[0]! * 100).toFixed(0)},dz=${(com[2]! * 100).toFixed(0)}) 前=${pitch.toFixed(0)}° 侧=${roll.toFixed(0)}° 支撑fz=${fz.toFixed(0).padStart(4)} | 腰注入 轴0/轴2=${inj}`);
    nextMark = Math.round((t + 0.5) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 5.0) break;
}
if (MODE === 'recf' || MODE === 'reco') {
  fs.mkdirSync('.tmp', { recursive: true });
  const cur: Rec = fs.existsSync(REC_FILE) ? JSON.parse(fs.readFileSync(REC_FILE, 'utf8')) as Rec : {};
  if (MODE === 'recf') cur.frozen = recFrames; else cur.off = recFrames;
  fs.writeFileSync(REC_FILE, JSON.stringify(cur));
  console.log(`录制完成 ${MODE}: ${recFrames.length} 帧 × ${recDofs.length} 轴 → ${REC_FILE}`);
  if (MODE === 'recf') {
    const s0 = Math.round(0.5 / w.dt);
    console.log(`【冻结版力矩回读】窗口 +0.5s~末（均值±标准差，N·m；vel=关节速度 RMS rad/s）`);
    for (let k = 0; k < recDofs.length; k++) {
      let s = 0, s2 = 0, n = 0;
      for (let f = s0; f < recFrames.length; f++) { const v = recFrames[f]![k]!; s += v; s2 += v * v; n++; }
      const m = s / Math.max(1, n);
      const sd = Math.sqrt(Math.max(0, s2 / Math.max(1, n) - m * m));
      let vs = 0;
      for (let f = s0; f < recVel.length; f++) vs += recVel[f]![k]! * recVel[f]![k]!;
      const vrms = Math.sqrt(vs / Math.max(1, recVel.length - s0));
      console.log(`  ${recNames[k]!.padEnd(10)} ${m.toFixed(1).padStart(7)} ± ${sd.toFixed(1).padStart(5)}  vel=${vrms.toFixed(2)}`);
    }
  }
}

/** _tmp-freeze-pose2: 膝盖「内收」的定量（只读刚体世界变换）
 *
 *  用户：「我让你测一下为什么法庭冻结期间膝盖内收」「内收了多少」
 *       「你回读关节世界位置可不可以」
 *
 *  ⚠ 上一版 _tmp-frozen.ts 的「脚尖角/膝面角」公式错了（把四元数 worldY 当水平分量）⇒ 作废。
 *
 *  世界系约定：+X 前 / +Y 上 / +Z 侧向。左腿在 +Z 侧（实测 hip_l.z=+12.5cm）。
 *
 *  每侧量六个量（正负已统一）：
 *   ① kneeVsAnkle  = (knee.z − ankle.z)·sgn   cm  ★★ 内收的第一手量
 *                    正 = 膝比踝靠外（外八）；负 = 膝比踝靠内（内扣/内收）
 *   ② kneeVsHip    = (knee.z − hip.z)·sgn     cm  大腿额向张开量
 *   ③ kneeOffLine  = 膝到「髋—踝直线」的额状面法向距离 cm
 *                    正 = 膝在中线外侧；负 = 膝塌向中线（内收）
 *   ④ thighLat     = 大腿额状面倾角 deg（正 = 往外倒）
 *   ⑤ yawThigh/yawShin/yawFoot = 大腿/小腿/脚 正面(局部+X) 的水平偏航 deg
 *                    yaw = atan2(x, z)，0=+z，90=+x
 *   ⑥ kneeTwist    = yawThigh − yawShin  deg  ★ 大腿相对小腿的纵向拧转
 *
 *  路径 A：squatCourtSetup（蹲下法庭＝运动学摆姿 + 2s 冻结）
 *  路径 B：动作层 squatDown → captureSquatCourt（网页「蹲下过程」）
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { captureSquatCourt } from '../src/core/court';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;

const D = 180 / Math.PI;
type P = { x: number; y: number; z: number };

interface Leg {
  hip: P; knee: P; ankle: P;
  kneeVsAnkle: number; kneeVsHip: number; kneeOffLine: number;
  thighLat: number; shinLat: number;
  yawThigh: number; yawShin: number; yawFoot: number;
  kneeTwist: number;
  hip0: number; knee0: number; knee1: number; hip2: number; knee2: number;
}

const mk = (w: World): ((side: 'l' | 'r') => Leg) => {
  const body = w.body;
  const anchor = (nm: string, ax: number): P => {
    const a = body.dofs[body.dofByName(nm, ax)]!.anchorWorld;
    return { x: a[0]!, y: a[1]!, z: a[2]! };
  };
  const bodyPos = (key: string): P => {
    const t = body.bodies[body.indexByKey.get(key)!]!.translation();
    return { x: t.x, y: t.y, z: t.z };
  };
  const localX = (key: string): P => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return {
      x: 1 - 2 * (q.y * q.y + q.z * q.z),
      y: 2 * (q.x * q.y + q.w * q.z),
      z: 2 * (q.x * q.z - q.w * q.y),
    };
  };
  const yaw = (v: P): number => Math.atan2(v.x, v.z) * D;
  const ang = (nm: string, ax: number): number => {
    const i = body.dofByName(nm, ax);
    return i < 0 ? NaN : body.dofs[i]!.angle * D;
  };
  return (side: 'l' | 'r'): Leg => {
    const sgn = side === 'l' ? 1 : -1;
    const hip = anchor(`hip_${side}`, 2);
    const knee = anchor(`knee_${side}`, 2);
    const ankle = anchor(`foot_${side}`, 2);
    // 膝到「髋—踝直线」的额状面法向偏移（法向取朝外侧）
    const lz = ankle.z - hip.z, ly = ankle.y - hip.y;
    const L = Math.hypot(lz, ly) || 1e-9;
    const uz = lz / L, uy = ly / L;
    let nz = -uy, ny = uz;
    if (nz * sgn < 0) { nz = -nz; ny = -ny; }
    const d = (knee.z - hip.z) * uz + (knee.y - hip.y) * uy;
    const pz = hip.z + uz * d, py = hip.y + uy * d;
    const kneeOffLine = ((knee.z - pz) * nz + (knee.y - py) * ny) * 100;
    const yawThigh = yaw(localX(`thigh_${side}`));
    const yawShin = yaw(localX(`shin_${side}`));
    const yawFoot = yaw(localX(`foot_${side}`));
    let tw = yawThigh - yawShin;
    while (tw > 180) tw -= 360;
    while (tw < -180) tw += 360;
    return {
      hip, knee, ankle,
      kneeVsAnkle: (knee.z - ankle.z) * sgn * 100,
      kneeVsHip: (knee.z - hip.z) * sgn * 100,
      kneeOffLine,
      thighLat: Math.atan2((knee.z - hip.z) * sgn, hip.y - knee.y) * D,
      shinLat: Math.atan2((ankle.z - knee.z) * sgn, knee.y - ankle.y) * D,
      yawThigh, yawShin, yawFoot,
      kneeTwist: tw * sgn,   // 正 = 膝盖相对脚尖更朝外
      hip0: ang(`hip_${side}`, 0), knee0: ang(`knee_${side}`, 0),
      knee1: ang(`knee_${side}`, 1), hip2: ang(`hip_${side}`, 2), knee2: ang(`knee_${side}`, 2),
    };
  };
};

const row = (t: number, L: Leg, R: Leg): string => {
  const f = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n).padStart(6) : '   n/a');
  return (
    ` ${t.toFixed(2)} |` +
    ` 膝vs踝 L${f(L.kneeVsAnkle)} R${f(R.kneeVsAnkle)}` +
    ` | 膝vs髋 L${f(L.kneeVsHip)} R${f(R.kneeVsHip)}` +
    ` | 偏连线 L${f(L.kneeOffLine)} R${f(R.kneeOffLine)}` +
    ` | 大腿倾 L${f(L.thighLat)} R${f(R.thighLat)}` +
    ` | 小腿倾 L${f(L.shinLat)} R${f(R.shinLat)}` +
    ` | 膝拧 L${f(L.kneeTwist)} R${f(R.kneeTwist)}` +
    ` | yaw 大腿${f(L.yawThigh, 0)} 小腿${f(L.yawShin, 0)} 脚${f(L.yawFoot, 0)}` +
    ` | hip0 ${f(L.hip0)}/${f(R.hip0)} knee0 ${f(L.knee0)}/${f(R.knee0)} knee1 ${f(L.knee1)}/${f(R.knee1)}`
  );
};

// ══════════════════════ 路径 A：蹲下法庭（运动学摆姿 + 2s 冻结）══════════════════════
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const m = mk(w);
  console.log(`\n════ 路径A：蹲下法庭 冻结期（KEEP=${E.SQC_KEEP_ANG_TABLE ?? '2'}）════`);
  console.log('  t   | 膝vs踝(cm)      | 膝vs髋(cm)      | 膝偏连线(cm)     | 大腿额倾(deg)    | 小腿额倾(deg)    | 膝拧(deg)       | yaw(L)             | 关节读数(deg)');
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    const t = s * w.dt;
    if (t > 2.0) break;
    if (Math.round(t * 10) % 2 !== 0) continue;
    console.log(row(t, m('l'), m('r')));
  }
  console.log('  --- 释放后再看 1.5s ---');
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    const t = 2.0 + s * w.dt;
    if (Math.round(t * 10) % 5 !== 0) continue;
    console.log(row(t, m('l'), m('r')));
  }
}

// ══════════════════════ 路径 B：动作层 squatDown → captureSquatCourt ═══════════════════════
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
  w.controller = ctl;
  w.reset();
  w.switchPoseState('stand');
  const m = mk(w);
  console.log('\n════ 路径B：动作层 squatDown → 交接（网页「蹲下过程」）════');
  console.log('  t   | 膝vs踝(cm)      | 膝vs髋(cm)      | 膝偏连线(cm)     | 大腿额倾(deg)    | 小腿额倾(deg)    | 膝拧(deg)       | yaw(L)             | 关节读数(deg)');
  let court: CourtState | null = null;
  for (let s = 0; s < Math.round(9.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    const t = s * w.dt;
    if (!court && t > 2.0) {
      const L0 = m('l'), R0 = m('r');
      console.log(row(t, L0, R0));
      if (Math.abs(L0.knee2) > 80) { court = captureSquatCourt(w, ctl); console.log('  >>> 交接 captureSquatCourt @', t.toFixed(2), 's'); }
    } else if (court) {
      squatFrame(w, ctl, court);
      if (Math.round(t * 10) % 5 === 0) console.log(row(t, m('l'), m('r')));
    } else {
      if (Math.round(t * 10) % 5 === 0) console.log(row(t, m('l'), m('r')));
    }
  }
}

console.log('\n★ 膝vs踝：正 = 膝比踝靠外（外八）；负 = 膝比踝靠内（内扣＝用户说的「膝盖内收」）');
console.log('★ 膝偏连线：正 = 膝在髋—踝连线外侧；负 = 膝塌向中线');
console.log('★ 膝拧 = 大腿正面相对小腿正面的偏航（正 = 膝盖比脚尖更朝外）');

/** _tmp-frozen: 冻结期的完整腿链几何（物理量，不用读数）
 *
 *  用户：「法庭冻结期间就在膝内收」
 *
 *  之前只测了「膝间距 vs 踝间距」（锚点位置）——那测的是**腿的开合**。
 *  但视觉上的"膝盖朝内"= **大腿绕自身纵轴的扭转**（膝盖正面转向中线）。
 *  ⇒ 这才是用户前面说的「膝盖还需要限位别让大腿拧」。
 *
 *  度量（全部用 axisWorld / anchorWorld = 物理量，绕开 mirrorSymmetric 的读数镜像）：
 *    膝间距/踝间距/髋间距      → 腿的开合
 *    大腿角 = atan2(膝x−髋x, 膝z−髋z)   水平面内大腿指向
 *    小腿角 = atan2(踝x−膝x, 踝z−膝z)
 *    脚尖角 = 脚刚体 +X 轴在水平面的角
 *    大腿扭转 = 髋矢状轴 与 膝矢状轴 在水平面的夹角  ★纵向拧转
 *    膝面角 = 膝正面方向 与 脚尖方向 的夹角          ★膝盖朝哪
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { sagittalAxis } from '../src/core/servo/jointPlane';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

const A = (nm: string, ax: number): Float64Array => body.dofs[body.dofByName(nm, ax)]!.anchorWorld;
const AX = (nm: string, ax: number): Float64Array => body.dofs[body.dofByName(nm, ax)]!.axisWorld;
const D = 180 / Math.PI;

/** 水平面内的方向角（度）：atan2(dx, dz)，0 = +z */
const hAngle = (dx: number, dz: number): number => Math.atan2(dx, dz) * D;

/** 水平面内两向量夹角（度，带符号） */
const hDiff = (a: Float64Array, b: Float64Array): number => hAngle(a[0]!, a[2]!) - hAngle(b[0]!, b[2]!);

console.log(`\n════ 冻结期腿链几何（KEEP=${E.SQC_KEEP_ANG_TABLE ?? '2'}）════`);
console.log('  t    | 膝间距 踝间距 | 大腿角L  小腿角L  脚尖角L | 大腿扭转L | 膝面角L | 大腿角R | 大腿扭转R');
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (t > 0.06 && t < 1.9 && Math.round(t * 20) % 4 !== 0) continue;
  if (t > 1.94) break;

  const hl = A('hip_l', 2), kl = A('knee_l', 2), al = A('foot_l', 2);
  const hr = A('hip_r', 2), kr = A('knee_r', 2), ar = A('foot_r', 2);
  const kneeSpan = (kl[2]! - kr[2]!) * 100;
  const ankleSpan = (al[2]! - ar[2]!) * 100;

  // 脚尖方向：脚刚体 +X 轴在水平面
  const fi = body.indexByKey.get('foot_l');
  let toeL = NaN, toeR = NaN;
  if (fi !== undefined) {
    const q = body.bodies[fi]!.rotation();
    toeL = hAngle(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  }
  const fir = body.indexByKey.get('foot_r');
  if (fir !== undefined) {
    const q = body.bodies[fir]!.rotation();
    toeR = hAngle(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
  }

  // 大腿扭转：髋矢状轴 vs 膝矢状轴（水平面夹角）
  const hsAx = sagittalAxis(body, 'hip_l'), ksAx = sagittalAxis(body, 'knee_l');
  const twistL = hDiff(AX('hip_l', hsAx!), AX('knee_l', ksAx!));
  const hsAxR = sagittalAxis(body, 'hip_r'), ksAxR = sagittalAxis(body, 'knee_r');
  const twistR = hDiff(AX('hip_r', hsAxR!), AX('knee_r', ksAxR!));

  // 膝面角：膝正面（矢状轴的水平法向）vs 脚尖
  const ksH = AX('knee_l', ksAx!);
  const kneeFace = hAngle(ksH[2]!, -ksH[0]!);   // 矢状轴的水平法向
  const faceVsToe = kneeFace - toeL;

  const thighL = hAngle(kl[0]! - hl[0]!, kl[2]! - hl[2]!);
  const shinL = hAngle(al[0]! - kl[0]!, al[2]! - kl[2]!);
  const thighR = hAngle(kr[0]! - hr[0]!, kr[2]! - hr[2]!);

  console.log(
    ` ${t.toFixed(2)} | ${kneeSpan.toFixed(1).padStart(6)} ${ankleSpan.toFixed(1).padStart(6)} |` +
    ` ${thighL.toFixed(1).padStart(7)} ${shinL.toFixed(1).padStart(8)} ${toeL.toFixed(1).padStart(7)} |` +
    ` ${twistL.toFixed(1).padStart(9)} | ${faceVsToe.toFixed(1).padStart(7)} | ${thighR.toFixed(1).padStart(7)} | ${twistR.toFixed(1).padStart(9)}`,
  );
}
console.log(`\n★ 大腿扭转 = 髋矢状轴 vs 膝矢状轴水平夹角（非 0 ⇒ 大腿绕纵轴拧了）`);
console.log(`★ 膝面角 = 膝正面 vs 脚尖（负 = 膝盖朝内/内扣）`);

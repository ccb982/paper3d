/** _tmp-freeze-pose: 法庭冻结期的腿链几何（只读刚体世界变换，不读镜像读数）
 *
 *  用户：「你回读关节世界位置可不可以」「内收了多少」
 *
 *  上一次 _tmp-frozen.ts 的「脚尖角/膝面角」两列公式写错了
 *  （把刚体四元数的 worldY 当成水平分量）⇒ 结论不可信，本探针重做。
 *
 *  全部量（世界系，+X 前 / +Y 上 / +Z 侧向）：
 *   ① 关节世界位置：hip / knee / ankle（锚点）+ 大腿/小腿/脚刚体世界位置
 *   ② 跨度：髋间距 / 膝间距 / 踝间距（cm）
 *   ③ 膝相对「髋—踝连线」的侧向偏移（cm）：★ 内收的标准量
 *      正 = 膝在中线外侧（外撇）；负 = 膝塌向中线（内收）
 *   ④ 大腿/小腿在额状面（Z-Y）的倾角（deg）：正 = 往外倒
 *   ⑤ 大腿轴向扭转（deg）：髋侧向轴 vs 膝侧向轴的水平夹角
 *   ⑥ 膝盖朝向 vs 脚尖朝向（deg）：★ 肉眼看「膝盖朝内/朝外」
 *      正 = 膝盖比脚尖更朝外；负 = 膝盖比脚尖更朝内（内扣）
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

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

const D = 180 / Math.PI;
/** 水平角：atan2(dx, dz)，0 = +z，90 = +x */
const hAng = (dx: number, dz: number): number => Math.atan2(dx, dz) * D;
/** 世界系点 */
type P = { x: number; y: number; z: number };
const anchor = (nm: string, ax: number): P => {
  const i = body.dofByName(nm, ax);
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};
/** 刚体世界位置 */
const bodyPos = (key: string): P => {
  const t = body.bodies[body.indexByKey.get(key)!]!.translation();
  return { x: t.x, y: t.y, z: t.z };
};
/** 刚体局部 +X 轴在世界系的方向（脚/大腿的「正面」＝局部 X，rest 时朝 +X） */
const bodyAxisX = (key: string): P => {
  const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
  return {
    x: 1 - 2 * (q.y * q.y + q.z * q.z),
    y: 2 * (q.x * q.y + q.w * q.z),
    z: 2 * (q.x * q.z - q.w * q.y),
  };
};

interface LegM {
  hip: P; knee: P; ankle: P;
  out: number;             // 该侧「朝外」的方向（+1 = +z 外，-1 = -z 外）
  kneeSpan: number; ankleSpan: number; hipSpan: number;
  kneeOffLine: number;     // 膝相对髋—踝连线的侧向偏移 cm（正=外撇）
  thighLat: number; shinLat: number;
  twist: number;           // 大腿轴向扭转 deg
  faceVsToe: number;       // 膝盖朝向 - 脚尖朝向（正=膝盖更朝外）
}
const measure = (side: 'l' | 'r'): LegM => {
  const hip = anchor(`hip_${side}`, 2);
  const knee = anchor(`knee_${side}`, 2);
  const ankle = anchor(`foot_${side}`, 2);
  const hl = anchor('hip_l', 2), hr = anchor('hip_r', 2);
  const midZ = (hl.z + hr.z) / 2;
  const out = side === 'l' ? (hl.z >= midZ ? 1 : -1) : (hr.z >= midZ ? 1 : -1);

  // 膝相对髋—踝连线的侧向偏移（额状面 Z-Y 平面内的有符号距离）
  const dy = hip.y - ankle.y, dz = hip.z - ankle.z;
  const len2 = dy * dy + dz * dz;
  const t = len2 > 1e-9 ? ((hip.y - knee.y) * dy + (hip.z - knee.z) * dz) / len2 : 0;
  const projZ = hip.z + t * dz, projY = hip.y - t * dy;
  const nZ = -(hip.y - projY), nY = hip.z - projZ;   // 连线的左法向（额状面内）
  const nLen = Math.hypot(nZ, nY) || 1;
  const kneeOffLine = ((knee.z - projZ) * nZ + (knee.y - projY) * nY) / nLen * out * 100;

  // 额状面倾角（正 = 往外倒）
  const thighLat = Math.atan2((knee.z - hip.z) * out, hip.y - knee.y) * D;
  const shinLat = Math.atan2((ankle.z - knee.z) * out, knee.y - ankle.y) * D;

  // 大腿轴向扭转：髋侧向轴 vs 膝侧向轴（水平夹角）
  const hipAx = body.dofs[body.dofByName(`hip_${side}`, 2)]!.axisWorld;
  const kneeAx = body.dofs[body.dofByName(`knee_${side}`, 2)]!.axisWorld;
  const twist = hAng(hipAx[0]!, hipAx[2]!) - hAng(kneeAx[0]!, kneeAx[2]!);

  // 膝盖朝向（大腿刚体局部 +X 的水平角）vs 脚尖朝向（脚刚体局部 +X 的水平角）
  const thX = bodyAxisX(`thigh_${side}`);
  const ftX = bodyAxisX(`foot_${side}`);
  const face = hAng(thX.x, thX.z);
  const toe = hAng(ftX.x, ftX.z);
  let d = face - toe;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;

  return {
    hip, knee, ankle, out,
    kneeSpan: 0, ankleSpan: 0, hipSpan: 0,
    kneeOffLine, thighLat, shinLat, twist,
    faceVsToe: d * out,   // 统一成「正 = 更朝外」
  };
};

console.log(`\n════ 蹲下法庭 冻结期腿链（回读刚体世界变换）════`);
console.log(`环境：KEEP=${E.SQC_KEEP_ANG_TABLE ?? '2'}  COURT_GROUND=${E.SQC_COURT_GROUND ?? '0'}  LIVE=${E.SQC_LIVE ?? '0'}  GONS=${E.SQC_GONS ?? '0'}`);
console.log('  t   | 髋z   膝z   踝z (L)   | 膝z   踝z (R)  | 髋距 膝距 踝距 | 膝偏连线L 膝偏连线R | 大腿角L 小腿角L | 大腿角R 小腿角R | 扭转L  扭转R | 膝面-脚尖L 膝面-脚尖R');
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (t > 2.0) break;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;   // 每 0.05s 打一次
  if (t > 0.3 && Math.round(t * 20) % 4 !== 0) continue;

  const L = measure('l'), R = measure('r');
  const hipSpan = (L.hip.z - R.hip.z) * 100;
  const kneeSpan = (L.knee.z - R.knee.z) * 100;
  const ankleSpan = (L.ankle.z - R.ankle.z) * 100;
  const cm = (v: number): string => (v * 100).toFixed(1).padStart(6);
  console.log(
    ` ${t.toFixed(2)} |${cm(L.hip.z)}${cm(L.knee.z)}${cm(L.ankle.z)} |${cm(R.hip.z)}${cm(R.knee.z)}${cm(R.ankle.z)} |` +
    ` ${hipSpan.toFixed(1).padStart(5)}${kneeSpan.toFixed(1).padStart(5)}${ankleSpan.toFixed(1).padStart(5)} |` +
    ` ${L.kneeOffLine.toFixed(2).padStart(8)}${R.kneeOffLine.toFixed(2).padStart(8)} |` +
    ` ${L.thighLat.toFixed(1).padStart(7)}${L.shinLat.toFixed(1).padStart(8)} | ${R.thighLat.toFixed(1).padStart(7)}${R.shinLat.toFixed(1).padStart(8)} |` +
    ` ${L.twist.toFixed(1).padStart(5)}${R.twist.toFixed(1).padStart(6)} |` +
    ` ${L.faceVsToe.toFixed(1).padStart(9)}${R.faceVsToe.toFixed(1).padStart(10)}`,
  );
}
console.log('\n★ 膝偏连线 = 膝到「髋—踝连线」的额状面侧向距离（cm）：正 = 膝在中线外（外撇），负 = 膝塌向中线（内收）');
console.log('★ 膝面-脚尖 = 膝盖朝向相对脚尖朝向（deg）：正 = 膝盖比脚尖更朝外，负 = 更朝内（内扣）');
console.log('★ 扭转 = 髋侧向轴 vs 膝侧向轴水平夹角（deg）：大腿绕自身纵轴的拧转');

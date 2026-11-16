/** _probe-apply.ts —— 「申请制」标定：差动力矩 → 载荷比 → **净 CoP 偏移**（一次量完）
 *
 *  回答三个问题（用户："回正力是需要脚多发力申请的"）：
 *   ① 几何：双脚 z 间距 / 单脚鞋底半宽 ⇒ 等载荷下净 CoP 能走多远
 *   ② 授权：膝/髋矢状差动 τ → (fzL−fzR)/W 的真实增益（含符号）
 *   ③ 合成：差动 τ → 净 CoP 相对「两脚中点」的偏移 ⇒ 这才是回正权限
 *
 *  用法：KNEE=15 HIP=-15 node tools/run.mjs _probe-apply
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const KNEE = Number(process.env.KNEE ?? 0);
const HIP = Number(process.env.HIP ?? 0);
const T_FROM = Number(process.env.T_FROM ?? 2.2);
const T_TO = Number(process.env.T_TO ?? 2.6);
const SHOW_GEO = process.env.SHOW_GEO !== '0';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const body = w.body;
const W = body.sk.massTotal * 9.81;
const court = squatCourtSetup(w, ctl, 2.0) as CourtState | null;

if (SHOW_GEO) {
  const f0l = body.dofByName('foot_l', 0);
  const f0r = body.dofByName('foot_r', 0);
  const p2l = body.dofByName('foot_l', 2);
  const kl = body.dofByName('knee_l', 2);
  const hr = body.dofByName('hip_r', 2);
  const zl = f0l >= 0 ? body.dofs[f0l]!.anchorWorld[2]! : NaN;
  const zr = f0r >= 0 ? body.dofs[f0r]!.anchorWorld[2]! : NaN;
  console.log(`GEO W=${W.toFixed(1)}N footZ L=${(zl * 1000).toFixed(1)}mm R=${(zr * 1000).toFixed(1)}mm sep/2=${(Math.abs(zl - zr) / 2 * 1000).toFixed(1)}mm`);
  for (const [nm, i] of [['foot/0', f0l], ['foot/2', p2l], ['knee/2', kl], ['hip/2', hr]] as const) {
    if (i < 0) continue;
    const d = body.dofs[i]!;
    console.log(`  ${nm.padEnd(7)} tauMax=${d.tauMax.toFixed(1)} angle=${(d.angle * 57.3).toFixed(1)}° lim=[${(d.lo * 57.3).toFixed(1)},${(d.hi * 57.3).toFixed(1)}] len=${(d.len * 1000).toFixed(1)}mm`);
  }
}

const dl = body.dofByName('knee_l', 2);
const dr = body.dofByName('knee_r', 2);
const hl = body.dofByName('hip_l', 2);
const hr2 = body.dofByName('hip_r', 2);

let sW = 0, sCop = 0, sFzL = 0, sFzR = 0, sCopL = 0, sCopR = 0, n = 0;
let sCopX = 0, sComX = 0;
const cop = new Float64Array(3);
const cop2 = new Float64Array(3);

for (let s = 0; s < Math.round(Number(process.env.T_END ?? 5.6) / w.dt); s++) {
  w.advance(1, () => {
    if (court === null || court.fall >= 0) return;
    if (court.t < T_FROM) return;
    if (dl >= 0 && KNEE !== 0) w.executor.addTorque(dl, KNEE);
    if (dr >= 0 && KNEE !== 0) w.executor.addTorque(dr, -KNEE);
    if (hl >= 0 && HIP !== 0) w.executor.addTorque(hl, HIP);
    if (hr2 >= 0 && HIP !== 0) w.executor.addTorque(hr2, -HIP);
  });
  if (court) squatFrame(w, ctl, court);
  const fzL = body.footNormalForce('l', w.dt);
  const fzR = body.footNormalForce('r', w.dt);
  const t = court ? court.t : w.clock;
  if (t >= T_FROM + 0.2 && t <= T_TO) {
    const okL = body.footCoP('l', w.dt, cop);
    const okR = body.footCoP('r', w.dt, cop2);
    const summ = Math.max(1e-6, fzL + fzR);
    if (okL && okR && summ > 0.5 * W) {
      const net = (fzL * cop[1]! + fzR * cop2[1]!) / summ;
      sCop += net;
      sCopL += cop[1]!; sCopR += cop2[1]!;
      sFzL += fzL / W; sFzR += fzR / W;
      sCopX += (fzL * cop[0]! + fzR * cop2[0]!) / summ;
      sComX += ctl.sensors.com[0]!;
      sW += (fzL - fzR) / summ;
      n++;
    }
  }
  if (court && court.fall >= 0 && t >= court.fall + 0.2) break;
}
// ★ 参考点用「两脚 CoP 的中点」而不是踝锚点：等载荷时 offMid 恒等于 0（与漂移无关），
//   且 offMid = (Δw/2)·(copL − copR) 精确成立 —— 这样增益读数不受"跑到第几秒"影响。
const dw = n > 0 ? sW / n : NaN;
const netCop = n > 0 ? sCop / n : NaN;
const midCop = n > 0 ? (sCopL + sCopR) / 2 / n : NaN;
console.log(`RESULT KNEE=${KNEE} HIP=${HIP} n=${n} dW=${dw.toFixed(3)} fzL=${(sFzL / Math.max(1, n) * 100).toFixed(1)}% fzR=${(sFzR / Math.max(1, n) * 100).toFixed(1)}% netCop=${(netCop * 1000).toFixed(1)}mm mid=${(midCop * 1000).toFixed(1)}mm offMid=${((netCop - midCop) * 1000).toFixed(2)}mm copL=${(sCopL / Math.max(1, n) * 1000).toFixed(1)} copR=${(sCopR / Math.max(1, n) * 1000).toFixed(1)} netCopX=${(sCopX / Math.max(1, n) * 1000).toFixed(1)} comX=${(sComX / Math.max(1, n) * 1000).toFixed(1)}`);

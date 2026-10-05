// src/core/systems/wantedForce.ts
var DEFAULT_WANTED_FORCE = {
  kXRatio: 0.4,
  zeta: 0.9,
  maxLateral: 500,
  maxSagittal: 400,
  weight: 70 * 9.81,
  kTrunkLean: 0.35,
  maxTrunkLean: 250
};

// src/core/systems/wholeBodyQp.ts
function solveWholeBodyQp(inp) {
  const n = inp.axes.length;
  const tau = new Float64Array(n);
  if (n === 0) {
    return { tau, feasible: false, residual: 0, iters: 0 };
  }
  const iters = inp.iters ?? 40;
  const cx3 = new Float64Array(n);
  const cz3 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = inp.axes[i];
    cx3[i] = a.wy * a.rz - a.wz * a.ry;
    cz3[i] = a.wx * a.ry - a.wy * a.rx;
  }
  const Aw = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    Aw[i * 2] = cx3[i];
    Aw[i * 2 + 1] = cz3[i];
  }
  const iw = new Float64Array(n);
  for (let i = 0; i < n; i++) iw[i] = 1 / Math.max(1e-9, inp.axes[i].w);
  let m00 = 0, m01 = 0, m11 = 0;
  for (let i = 0; i < n; i++) {
    m00 += Aw[i * 2] * iw[i] * Aw[i * 2];
    m01 += Aw[i * 2] * iw[i] * Aw[i * 2 + 1];
    m11 += Aw[i * 2 + 1] * iw[i] * Aw[i * 2 + 1];
  }
  const det = m00 * m11 - m01 * m01;
  let tau0;
  if (Math.abs(det) < 1e-12) {
    let best = 0, bestR = 1e-9;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(Aw[i * 2], Aw[i * 2 + 1]);
      if (r > bestR) {
        bestR = r;
        best = i;
      }
    }
    tau0 = new Float64Array(n);
    if (bestR > 1e-9) {
      const mag = Math.hypot(inp.fDesX, inp.fDesZ);
      tau0[best] = mag / bestR * Math.sign(
        Aw[best * 2] * inp.fDesX + Aw[best * 2 + 1] * inp.fDesZ || 1
      );
    }
  } else {
    const l0 = (m11 * inp.fDesX - m01 * inp.fDesZ) / det;
    const l1 = (m00 * inp.fDesZ - m01 * inp.fDesX) / det;
    tau0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      tau0[i] = iw[i] * (Aw[i * 2] * l0 + Aw[i * 2 + 1] * l1);
    }
  }
  tau.set(tau0);
  const FIXED = new Int8Array(n);
  for (let iter = 0; iter < 8 * n; iter++) {
    tau.set(tau0);
    for (let i = 0; i < n; i++) {
      if (FIXED[i] === 1) tau[i] = inp.axes[i].tauMax;
      else if (FIXED[i] === -1) tau[i] = -inp.axes[i].tauMax;
    }
    let g0 = 0, g1 = 0, nf = 0;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      g0 += Aw[i * 2] * tau[i];
      g1 += Aw[i * 2 + 1] * tau[i];
      nf++;
    }
    let n00 = 0, n01 = 0, n11 = 0;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      n00 += Aw[i * 2] * iw[i] * Aw[i * 2];
      n01 += Aw[i * 2] * iw[i] * Aw[i * 2 + 1];
      n11 += Aw[i * 2 + 1] * iw[i] * Aw[i * 2 + 1];
    }
    const nd = n00 * n11 - n01 * n01;
    if (nf === 0 || Math.abs(nd) < 1e-12) break;
    const r0 = inp.fDesX - g0, r1 = inp.fDesZ - g1;
    const id = 1 / nd;
    const l0 = (n11 * r0 - n01 * r1) * id, l1 = (n00 * r1 - n01 * r0) * id;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      tau[i] = tau[i] + iw[i] * (Aw[i * 2] * l0 + Aw[i * 2 + 1] * l1);
    }
    let changed = false;
    for (let i = 0; i < n; i++) {
      const m = inp.axes[i].tauMax;
      if (FIXED[i] === 0) {
        if (tau[i] > m) {
          FIXED[i] = 1;
          changed = true;
        } else if (tau[i] < -m) {
          FIXED[i] = -1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  let s0 = 0, s1 = 0;
  let allInBox = true;
  for (let i = 0; i < n; i++) {
    s0 += tau[i] * cx3[i];
    s1 += tau[i] * cz3[i];
    if (Math.abs(tau[i]) > inp.axes[i].tauMax * 1.001) allInBox = false;
  }
  const residual = Math.hypot(s0 - inp.fDesX, s1 - inp.fDesZ);
  const copOk = (() => {
    const F = Math.hypot(s0, s1);
    if (F < 1e-9) return true;
    const [x0, x1] = inp.copXRange, [z0, z1] = inp.copZRange;
    const ang = (x, z) => Math.atan2(z, x);
    const a = [ang(x0, z0), ang(x1, z0), ang(x1, z1), ang(x0, z1)];
    const target = ang(s0, s1);
    for (let k = 0; k < 4; k++) {
      let a0 = a[k], a1 = a[(k + 1) % 4];
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      let t = target - a0;
      while (t > Math.PI) t -= 2 * Math.PI;
      while (t < -Math.PI) t += 2 * Math.PI;
      if (t >= -1e-9 && t <= d + 1e-9) return true;
    }
    return false;
  })();
  const tolEq = 0.01 * Math.max(1, Math.hypot(inp.fDesX, inp.fDesZ));
  return { tau, feasible: allInBox && copOk && residual <= tolEq, residual, iters };
}

// tools/probe-qp.ts
var log = console.log;
var D2R = Math.PI / 180;
function mkAx(nm, joint, axis, ax, ay, az, jx, jy, jz, tauMax, mul = 1) {
  return {
    joint,
    axis,
    wx: ax,
    wy: ay,
    wz: az,
    rx: jx,
    ry: jy,
    rz: jz,
    tauMax,
    w: mul / tauMax
  };
}
var AXES = [
  // 踝绕 X（额状旋转轴）→ c_z = ax·ry = 1·0.05 = 0.05（侧向，臂弱）
  mkAx("\u8E1D\u65CB\u524D", 0, 0, 1, 0, 0, 0.02, 0.05, 0.06, 120, 4),
  // 踝绕 Z（矢状旋转轴）→ c_x = −az·ry = −0.05（前后，臂同样 5cm）
  mkAx("\u8E1D\u77E2\u72B6", 0, 2, 0, 0, 1, 0, 0.05, 0, 120, 4),
  mkAx("\u8E1D\u5916\u7FFB", 0, 1, 0, 1, 0, 0.02, 0.05, 0.06, 42, 4),
  // 膝：臂 42cm ⇒ 同样力矩能出 8 倍力
  mkAx("\u819D\u4FA7", 1, 0, 1, 0, 0, 0.02, 0.42, 0.06, 90),
  mkAx("\u819D\u77E2\u72B6", 1, 2, 0, 0, 1, 0, 0.42, 0, 150),
  // 髋：臂 90cm ⇒ 主力
  mkAx("\u9ACB\u4FA7", 2, 0, 1, 0, 0, 0.02, 0.9, 0.06, 120),
  mkAx("\u9ACB\u77E2\u72B6", 2, 2, 0, 0, 1, 0, 0.9, 0, 200),
  // 腰
  mkAx("\u8170\u4FA7\u503E", 3, 0, 1, 0, 0, 0.02, 0.6, 0.06, 72),
  mkAx("\u8170\u5C48\u4F38", 3, 2, 0, 0, 1, 0, 0.6, 0, 120)
];
var axes = AXES;
log("\u2550\u2550 \u5168\u94FE QP \u79BB\u7EBF\u9A8C\u6536 \u2550\u2550");
log("");
log("  \u2460 \u552F\u4E00\u6027 + \u2461 \u7B49\u5F0F\u6B8B\u5DEE\uFF08\u540C\u4E00\u8F93\u5165\u591A\u6B21\u6C42\u89E3\u5E94\u9010\u4F4D\u76F8\u540C\uFF09");
for (const [fx, fz] of [[0, 0], [20, 0], [0, 30], [-50, -50], [200, 200]]) {
  const runs = [];
  for (let k = 0; k < 3; k++) {
    const o = solveWholeBodyQp({
      axes,
      fDesX: fx,
      fDesZ: fz,
      copXRange: [-0.14, 0.14],
      copZRange: [-0.05, 0.09]
    });
    runs.push({ t: [...o.tau], f: o.feasible, r: o.residual });
  }
  const same = runs.every((r) => r.t.every((v, i) => v === runs[0].t[i]));
  let s0 = 0, s1 = 0, over = 0;
  runs[0].t.forEach((v, i) => {
    const a = axes[i];
    s0 += v * (a.wy * a.rz - a.wz * a.ry);
    s1 += v * (a.wx * a.ry - a.wy * a.rx);
    if (Math.abs(v) > a.tauMax * 1.0001) over++;
  });
  log(`     F_des=(${String(fx).padStart(4)},${String(fz).padStart(4)})N  \u6B8B\u5DEE=${runs[0].r.toFixed(2)}N  \u5408\u6210=(${s0.toFixed(1)},${s1.toFixed(1)})  \u8D85\u9650\u8F74=${over}  \u53EF\u884C=${runs[0].f ? "\u2713" : "\u2717"}  \u4E09\u6B21\u9010\u4F4D\u76F8\u540C=${same ? "\u2713" : "\u2717"}`);
}
log("");
log("  \u2462 \u529B\u77E9\u5206\u914D\uFF1A\u77E2\u72B6(\u524D\u540E) vs \u989D\u72B6(\u4FA7\u5411) \u5404\u51FA\u4E00\u4EFD\uFF0C\u5BF9\u6BD4\u8E1D\u6743\u91CD\u7684\u4F5C\u7528");
{
  const o = solveWholeBodyQp({ axes, fDesX: 40, fDesZ: 30, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  const nm = ["\u8E1D\u65CB\u524D", "\u8E1D\u77E2\u72B6", "\u8E1D\u5916\u7FFB", "\u819D\u4FA7", "\u819D\u77E2\u72B6", "\u9ACB\u4FA7", "\u9ACB\u77E2\u72B6", "\u8170\u4FA7\u503E", "\u8170\u5C48\u4F38"];
  o.tau.forEach((v, i) => log(`     ${nm[i].padEnd(6)} ${v.toFixed(1).padStart(8)} N\xB7m  (\u03C4max ${axes[i].tauMax})`));
}
log("");
log("  \u2463 \u8E1D\u6743\u91CD\u7684\u4F5C\u7528\uFF1A\u628A ankleMul \u4ECE 4 \u964D\u5230 0\uFF0C\u770B\u5206\u914D\u600E\u4E48\u53D8");
for (const mul of [4, 1, 0]) {
  const ax2 = axes.map((a, i) => i < 3 ? { ...a, w: mul / a.tauMax } : a);
  const o = solveWholeBodyQp({ axes: ax2, fDesX: 40, fDesZ: 30, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  const g = (i0) => (o.tau[i0] ?? 0).toFixed(1).padStart(7);
  log(`     ankleMul=${mul}  \u8E1D[\u65CB\u524D ${g(0)} \u77E2\u72B6 ${g(1)} \u5916\u7FFB ${g(2)}]  \u819D[\u4FA7 ${g(3)} \u77E2 ${g(4)}]  \u9ACB[\u4FA7 ${g(5)} \u77E2 ${g(6)}]  \u8170[\u4FA7 ${g(7)} \u77E2 ${g(8)}]`);
}
log("");
log("  \u2464 \u6B20\u5B9A\uFF1AF_des \u5927\u5230\u529B\u77E9\u4E0A\u9650\u4E5F\u505A\u4E0D\u5230\uFF08feasible \u5FC5\u987B\u4E3A \u2717\uFF09");
for (const f of [300, 1e3, 3e3]) {
  const o = solveWholeBodyQp({ axes, fDesX: f, fDesZ: 0, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  let s0 = 0;
  o.tau.forEach((v, i) => {
    const a = axes[i];
    s0 += v * (a.wy * a.rz - a.wz * a.ry);
  });
  log(`     F_des=${String(f).padStart(4)}N \u2192 \u5B9E\u9645 ${s0.toFixed(0)}N  \u6B8B\u5DEE ${o.residual.toFixed(0)}N  feasible=${o.feasible ? "\u2713" : "\u2717\uFF08\u5DF2\u5982\u5B9E\u62A5\u51FA\uFF09"}`);
}

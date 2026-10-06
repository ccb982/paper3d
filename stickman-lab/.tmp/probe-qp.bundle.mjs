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
  const mu = inp.mu ?? 0.8;
  if (n === 0) {
    return {
      tau,
      feasible: false,
      residual: 0,
      residualXYZ: [0, 0, 0],
      fActual: [0, 0, 0],
      checks: { box: false, equality: false, cop: false, friction: false },
      iters: 0
    };
  }
  const iters = inp.iters ?? 40;
  const C = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = inp.axes[i];
    C[i * 3] = a.wy * a.rz - a.wz * a.ry;
    C[i * 3 + 1] = a.wz * a.rx - a.wx * a.rz;
    C[i * 3 + 2] = a.wx * a.ry - a.wy * a.rx;
  }
  const iw = new Float64Array(n);
  for (let i = 0; i < n; i++) iw[i] = 1 / Math.max(1e-9, inp.axes[i].w);
  const b0 = inp.fDesX, b1 = inp.fDesY, b2 = inp.fDesZ;
  const solve3 = (N, fix, r0, r1, r2) => {
    N[0] = 0;
    N[1] = 0;
    N[2] = 0;
    N[3] = 0;
    N[4] = 0;
    N[5] = 0;
    N[6] = 0;
    N[7] = 0;
    N[8] = 0;
    for (let i = 0; i < n; i++) {
      if (fix !== null && fix[i] !== 0) continue;
      const w = iw[i];
      const a0 = C[i * 3], a1 = C[i * 3 + 1], a2 = C[i * 3 + 2];
      N[0] += a0 * w * a0;
      N[1] += a0 * w * a1;
      N[2] += a0 * w * a2;
      N[4] += a1 * w * a1;
      N[5] += a1 * w * a2;
      N[8] += a2 * w * a2;
    }
    N[3] = N[1];
    N[6] = N[2];
    N[7] = N[5];
    const m00 = N[0], m01 = N[1], m02 = N[2];
    const m11 = N[4], m12 = N[5], m22 = N[8];
    const a00 = m11 * m22 - m12 * m12;
    const a01 = m12 * m02 - m01 * m22;
    const a02 = m01 * m12 - m11 * m02;
    const a11 = m00 * m22 - m02 * m02;
    const a12 = m02 * m01 - m00 * m12;
    const a22 = m00 * m11 - m01 * m01;
    const det = a00 * m00 + a01 * m01 + a02 * m02;
    const scale = Math.abs(m00) + Math.abs(m11) + Math.abs(m22);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12 * Math.max(1e-30, scale ** 3)) {
      return { ok: false, l0: 0, l1: 0, l2: 0 };
    }
    const id = 1 / det;
    return {
      ok: true,
      l0: (a00 * r0 + a01 * r1 + a02 * r2) * id,
      l1: (a01 * r0 + a11 * r1 + a12 * r2) * id,
      l2: (a02 * r0 + a12 * r1 + a22 * r2) * id
    };
  };
  const Nfull = new Float64Array(9);
  const l0f = solve3(Nfull, null, b0, b1, b2);
  let tau0;
  let degenerate = false;
  if (l0f.ok) {
    tau0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      tau0[i] = iw[i] * (C[i * 3] * l0f.l0 + C[i * 3 + 1] * l0f.l1 + C[i * 3 + 2] * l0f.l2);
    }
  } else {
    degenerate = true;
    let best = -1, bestR = 1e-9;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      if (r > bestR) {
        bestR = r;
        best = i;
      }
    }
    tau0 = new Float64Array(n);
    if (best >= 0) {
      const mag = Math.hypot(b0, b1, b2);
      const dot = C[best * 3] * b0 + C[best * 3 + 1] * b1 + C[best * 3 + 2] * b2;
      tau0[best] = mag / bestR * Math.sign(dot || 1);
    }
  }
  tau.set(tau0);
  const FIXED = new Int8Array(n);
  const Nsub = new Float64Array(9);
  let used = 0;
  for (let iter = 0; iter < 8 * n; iter++) {
    used = iter + 1;
    tau.set(tau0);
    for (let i = 0; i < n; i++) {
      if (FIXED[i] === 1) tau[i] = inp.axes[i].tauMax;
      else if (FIXED[i] === -1) tau[i] = -inp.axes[i].tauMax;
    }
    let g0 = 0, g1 = 0, g2 = 0, nf = 0;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      const t = tau[i];
      g0 += C[i * 3] * t;
      g1 += C[i * 3 + 1] * t;
      g2 += C[i * 3 + 2] * t;
      nf++;
    }
    if (nf === 0) break;
    const lam = solve3(Nsub, FIXED, b0 - g0, b1 - g1, b2 - g2);
    if (!lam.ok) break;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      tau[i] = tau[i] + iw[i] * (C[i * 3] * lam.l0 + C[i * 3 + 1] * lam.l1 + C[i * 3 + 2] * lam.l2);
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
  let s0 = 0, s1 = 0, s2 = 0;
  let boxOk = true;
  for (let i = 0; i < n; i++) {
    s0 += tau[i] * C[i * 3];
    s1 += tau[i] * C[i * 3 + 1];
    s2 += tau[i] * C[i * 3 + 2];
    if (Math.abs(tau[i]) > inp.axes[i].tauMax * 1.001) boxOk = false;
  }
  const rx = s0 - b0, ry = s1 - b1, rz = s2 - b2;
  const residualXYZ = [rx, ry, rz];
  const residual = Math.hypot(rx, ry, rz);
  const copOk = (() => {
    const F = Math.hypot(s0, s2);
    if (F < 1e-9) return true;
    const [x0, x1] = inp.copXRange, [z0, z1] = inp.copZRange;
    const ang = (x, z) => Math.atan2(z, x);
    const a = [ang(x0, z0), ang(x1, z0), ang(x1, z1), ang(x0, z1)];
    const target = ang(s0, s2);
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
  const Fh = Math.hypot(s0, s2);
  const frictionOk = s1 >= 0 && Fh <= mu * s1 + 1e-6;
  const tolEqX = 0.01 * Math.max(1, Math.abs(b0));
  const tolEqY = 0.01 * Math.max(1, Math.abs(b1));
  const tolEqZ = 0.01 * Math.max(1, Math.abs(b2));
  const equalityOk = !degenerate && Math.abs(rx) <= tolEqX && Math.abs(ry) <= tolEqY && Math.abs(rz) <= tolEqZ;
  return {
    tau,
    feasible: boxOk && equalityOk && copOk && frictionOk,
    residual,
    residualXYZ,
    fActual: [s0, s1, s2],
    checks: { box: boxOk, equality: equalityOk, cop: copOk, friction: frictionOk },
    iters: used
  };
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
      fDesY: 0,
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
log("  \u2465\u2605 \u7AD6\u5411\u6743\u9650\u4F53\u68C0\uFF1A`\u03C4=J\u1D40F` \u8FD9\u5957\u5F62\u5F0F**\u80FD\u4E0D\u80FD\u6491\u8D77\u4F53\u91CD**");
{
  const maxFy = axes.reduce((s, a) => s + a.tauMax * Math.hypot(a.wz * a.rx - a.wx * a.rz), 0);
  const MG = 70 * 9.81;
  log(`     \u7AD6\u5411\u4E0A\u9650\uFF08\u6240\u6709\u8F74\u9876\u6EE1 \u03C4max\uFF09  = ${maxFy.toFixed(1)} N`);
  log(`     \u4F53\u91CD m\xB7g\uFF08m=70kg\uFF09           = ${MG.toFixed(1)} N`);
  log(`     \u7F3A\u53E3                         = ${(MG - maxFy).toFixed(1)} N  \u21D2 \u7AD6\u5411\u6743\u9650\u53EA\u6709\u4F53\u91CD\u7684 ${(100 * maxFy / MG).toFixed(1)}%`);
  const o = solveWholeBodyQp({
    axes,
    fDesX: 0,
    fDesY: MG,
    fDesZ: 0,
    copXRange: [-0.14, 0.14],
    copZRange: [-0.05, 0.09]
  });
  log(`     \u7ED9 F_des=(0, ${MG.toFixed(0)}, 0) \u2192 \u5B9E\u9645 F_y=${o.fActual[1].toFixed(1)} N  \u6B8B\u5DEE_y=${o.residualXYZ[1].toFixed(1)} N  equality=${o.checks.equality ? "\u2713" : "\u2717"}  friction=${o.checks.friction ? "\u2713" : "\u2717"}  feasible=${o.feasible ? "\u2713" : "\u2717"}`);
  log(`     \u21D2 \u7B49\u5F0F\u7167\u5B9E\u62A5 infeasible\uFF0C\u8FD9\u662F**\u6B63\u786E\u884C\u4E3A**\uFF0C\u4E0D\u662F\u6C42\u89E3\u5668\u574F\u4E86\u3002`);
}
log("");
log("  \u2465b \u6469\u64E6\u9525\uFF1A\u7AD6\u5411\u6709\u4E86\u624D\u5224\u5F97\u4E86 |F_h| \u2264 \u03BC\xB7F_y");
{
  for (const [fx, fy] of [[40, 0], [40, 20], [40, 100], [600, 700]]) {
    const o = solveWholeBodyQp({
      axes,
      fDesX: fx,
      fDesY: fy,
      fDesZ: 0,
      copXRange: [-0.14, 0.14],
      copZRange: [-0.05, 0.09]
    });
    const fh = Math.hypot(o.fActual[0], o.fActual[2]);
    log(`     F_des=(${String(fx).padStart(3)},${String(fy).padStart(3)},0) \u2192 |F_h|=${fh.toFixed(0).padStart(4)}  \u6469\u64E6\u9525 ${fh <= 0.8 * o.fActual[1] ? "\u5185" : "\u5916"}  friction=${o.checks.friction ? "\u2713" : "\u2717"}`);
  }
  log(`     \u21D2 \u7AD6\u5411\u4E3A 0 \u65F6\u6469\u64E6\u9525\u6052\u5224\u300C\u5916\u300D\uFF1A\u6CA1\u6709 F_y \u5C31\u65E0\u4ECE\u8C08\u6469\u64E6\u3002`);
}
log("");
log("  \u2462 \u529B\u77E9\u5206\u914D\uFF1A\u77E2\u72B6(\u524D\u540E) vs \u989D\u72B6(\u4FA7\u5411) \u5404\u51FA\u4E00\u4EFD\uFF0C\u5BF9\u6BD4\u8E1D\u6743\u91CD\u7684\u4F5C\u7528");
{
  const o = solveWholeBodyQp({ axes, fDesX: 40, fDesY: 0, fDesZ: 30, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  const nm = ["\u8E1D\u65CB\u524D", "\u8E1D\u77E2\u72B6", "\u8E1D\u5916\u7FFB", "\u819D\u4FA7", "\u819D\u77E2\u72B6", "\u9ACB\u4FA7", "\u9ACB\u77E2\u72B6", "\u8170\u4FA7\u503E", "\u8170\u5C48\u4F38"];
  o.tau.forEach((v, i) => log(`     ${nm[i].padEnd(6)} ${v.toFixed(1).padStart(8)} N\xB7m  (\u03C4max ${axes[i].tauMax})`));
}
log("");
log("  \u2463 \u8E1D\u6743\u91CD\u7684\u4F5C\u7528\uFF1A\u628A ankleMul \u4ECE 4 \u964D\u5230 0\uFF0C\u770B\u5206\u914D\u600E\u4E48\u53D8");
for (const mul of [4, 1, 0]) {
  const ax2 = axes.map((a, i) => i < 3 ? { ...a, w: mul / a.tauMax } : a);
  const o = solveWholeBodyQp({ axes: ax2, fDesX: 40, fDesY: 0, fDesZ: 30, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  const g = (i0) => (o.tau[i0] ?? 0).toFixed(1).padStart(7);
  log(`     ankleMul=${mul}  \u8E1D[\u65CB\u524D ${g(0)} \u77E2\u72B6 ${g(1)} \u5916\u7FFB ${g(2)}]  \u819D[\u4FA7 ${g(3)} \u77E2 ${g(4)}]  \u9ACB[\u4FA7 ${g(5)} \u77E2 ${g(6)}]  \u8170[\u4FA7 ${g(7)} \u77E2 ${g(8)}]`);
}
log("");
log("  \u2464 \u6B20\u5B9A\uFF1AF_des \u5927\u5230\u529B\u77E9\u4E0A\u9650\u4E5F\u505A\u4E0D\u5230\uFF08feasible \u5FC5\u987B\u4E3A \u2717\uFF09");
for (const f of [300, 1e3, 3e3]) {
  const o = solveWholeBodyQp({ axes, fDesX: f, fDesY: 0, fDesZ: 0, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  let s0 = 0;
  o.tau.forEach((v, i) => {
    const a = axes[i];
    s0 += v * (a.wy * a.rz - a.wz * a.ry);
  });
  log(`     F_des=${String(f).padStart(4)}N \u2192 \u5B9E\u9645 ${s0.toFixed(0)}N  \u6B8B\u5DEE ${o.residual.toFixed(0)}N  feasible=${o.feasible ? "\u2713" : "\u2717\uFF08\u5DF2\u5982\u5B9E\u62A5\u51FA\uFF09"}`);
}

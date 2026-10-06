// src/core/centroidal.ts
var H_MOM_WIN = 5;
function newCentroidalState() {
  return {
    m: 0,
    cx: 0,
    cy: 0,
    cz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ax: 0,
    ay: 0,
    az: 0,
    Ic: new Float64Array(9),
    hx: 0,
    hy: 0,
    hz: 0,
    dhx: 0,
    dhy: 0,
    dhz: 0,
    dhReady: false,
    _hHist: new Float64Array(H_MOM_WIN * 3),
    _pHist: new Float64Array(H_MOM_WIN * 3),
    _filled: 0,
    _ptr: 0
  };
}
var TMP_R = new Float64Array(3);
var TMP_I = new Float64Array(9);
var TMP_Q0 = new Float64Array(3);
var TMP_Q1 = new Float64Array(3);
var TMP_Q2 = new Float64Array(3);
var TMP_Q = new Float64Array(4);

// src/core/systems/grfQp.ts
var VARS_PER_CONTACT = 5;
var G = 9.81;
function solveGrfQp(inp) {
  const all = inp.contacts;
  const mu = inp.mu ?? 0.8;
  const iters = inp.iters ?? 200;
  const nc = all.length;
  const nAll = nc * VARS_PER_CONTACT;
  const lambda = new Float64Array(nAll);
  if (nc === 0) {
    return {
      lambda,
      feasible: false,
      residual: [0, 0],
      checks: { unilateral: false, friction: false, cop: false, equality: false },
      fTotal: [0, 0, 0],
      zmp: [NaN, NaN],
      nActive: 0,
      iters: 0
    };
  }
  const act = [];
  for (let k = 0; k < nc; k++) if (all[k].active) act.push(k);
  const na = act.length;
  if (na === 0) {
    return {
      lambda,
      feasible: false,
      residual: [0, 0],
      checks: { unilateral: true, friction: true, cop: false, equality: false },
      fTotal: [0, 0, 0],
      zmp: [NaN, NaN],
      nActive: 0,
      iters: 0
    };
  }
  const cs2 = inp.cs;
  const m = Math.max(1e-6, cs2.m);
  const bLin = [m * inp.aDesX, m * (inp.aDesY + G), m * inp.aDesZ];
  const alpha = inp.alphaDes ?? [0, 0, 0];
  const bAng = [
    cs2.Ic[0] * alpha[0] + cs2.Ic[1] * alpha[1] + cs2.Ic[2] * alpha[2],
    cs2.Ic[3] * alpha[0] + cs2.Ic[4] * alpha[1] + cs2.Ic[5] * alpha[2],
    cs2.Ic[6] * alpha[0] + cs2.Ic[7] * alpha[1] + cs2.Ic[8] * alpha[2]
  ];
  return solveLinear(inp, all, act, m, bLin, bAng, mu, iters, lambda, nAll);
}
function solveLinear(inp, all, act, m, bLin, bAng, mu, iters, lambda, nAll) {
  const na = act.length;
  const n = na * 5;
  const cs2 = inp.cs;
  const Phi = new Float64Array(6 * n);
  for (let a = 0; a < na; a++) {
    const C2 = all[act[a]];
    const rx = C2.x - cs2.cx, ry = C2.y - cs2.cy, rz = C2.z - cs2.cz;
    const o = a * 5;
    Phi[0 * n + o + 0] = 1;
    Phi[1 * n + o + 1] = 1;
    Phi[2 * n + o + 2] = 1;
    Phi[3 * n + o + 1] = -rz;
    Phi[3 * n + o + 2] = ry;
    Phi[4 * n + o + 0] = rz;
    Phi[4 * n + o + 2] = -rx;
    Phi[5 * n + o + 1] = rx;
    Phi[5 * n + o + 0] = -ry;
    Phi[3 * n + o + 3] = 1;
    Phi[5 * n + o + 4] = 1;
  }
  const iw = new Float64Array(n);
  const SC_H = 100;
  const SC_V = 700;
  const SC_T = 100;
  for (let a = 0; a < na; a++) {
    const o = a * 5;
    iw[o + 0] = SC_H * SC_H;
    iw[o + 1] = SC_V * SC_V;
    iw[o + 2] = SC_H * SC_H;
    iw[o + 3] = SC_T * SC_T;
    iw[o + 4] = SC_T * SC_T;
  }
  const fyMax = (inp.fyMaxMul ?? 4) * m * G;
  let it = 0;
  for (; it < iters; it++) {
    const N = new Float64Array(36);
    for (let r = 0; r < 6; r++) {
      for (let c = r; c < 6; c++) {
        let acc = 0;
        for (let j = 0; j < n; j++) acc += Phi[r * n + j] * iw[j] * Phi[c * n + j];
        N[r * 6 + c] = acc;
        N[c * 6 + r] = acc;
      }
    }
    const tr = N[0] + N[7] + N[14] + N[21] + N[28] + N[35];
    const eps = 1e-10 * Math.max(1, Math.abs(tr));
    for (let d = 0; d < 6; d++) N[d * 6 + d] += eps;
    const y = solveSym6(N, bLin.concat(bAng));
    if (!y) break;
    const sol = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let r = 0; r < 6; r++) acc += Phi[r * n + j] * y[r];
      sol[j] = iw[j] * acc;
    }
    for (let a = 0; a < na; a++) {
      const C2 = all[act[a]];
      const o = a * 5;
      const halfX = Math.max(1e-4, (C2.copX[1] - C2.copX[0]) / 2);
      const halfZ = Math.max(1e-4, (C2.copZ[1] - C2.copZ[0]) / 2);
      if (sol[o + 1] < 0) sol[o + 1] = 0;
      if (sol[o + 1] > fyMax) sol[o + 1] = fyMax;
      const fy = sol[o + 1];
      const capZ = fy * halfZ, capX = fy * halfX;
      if (Math.abs(sol[o + 3]) > capZ) sol[o + 3] = Math.sign(sol[o + 3]) * capZ;
      if (Math.abs(sol[o + 4]) > capX) sol[o + 4] = Math.sign(sol[o + 4]) * capX;
      const fh = Math.hypot(sol[o + 0], sol[o + 2]);
      const cap = mu * fy;
      if (fh > cap) {
        if (cap <= 1e-9) {
          sol[o + 0] = 0;
          sol[o + 2] = 0;
        } else {
          const s = cap / fh;
          sol[o + 0] = sol[o + 0] * s;
          sol[o + 2] = sol[o + 2] * s;
        }
      }
    }
    for (let j = 0; j < n; j++) lambda[act[Math.floor(j / 5)] * 5 + j % 5] = sol[j];
  }
  const actv = new Float64Array(6);
  for (let r = 0; r < 6; r++) {
    let acc = 0;
    for (let j = 0; j < n; j++) acc += Phi[r * n + j] * lambda[act[Math.floor(j / 5)] * 5 + j % 5];
    actv[r] = acc;
  }
  const resLin = Math.hypot(actv[0] - bLin[0], actv[1] - bLin[1], actv[2] - bLin[2]);
  const resAng = Math.hypot(actv[3] - bAng[0], actv[4] - bAng[1], actv[5] - bAng[2]);
  const tolLin = 0.01 * m * G;
  const tolAng = 0.01 * Math.max(1, Math.hypot(bAng[0], bAng[1], bAng[2]));
  const equalityOk = resLin <= tolLin && resAng <= tolAng;
  let unilateralOk = true, frictionOk = true, copOk = true;
  let fxT = 0, fyT = 0, fzT = 0, zmpW = 0, zmpX = 0, zmpZ = 0;
  for (let k = 0; k < all.length; k++) {
    if (!all[k].active) continue;
    const o = k * 5;
    const fx = lambda[o], fy = lambda[o + 1], fz = lambda[o + 2];
    const Mzx = lambda[o + 3], Mzz = lambda[o + 4];
    fxT += fx;
    fyT += fy;
    fzT += fz;
    if (fy < -1e-6) unilateralOk = false;
    if (Math.hypot(fx, fz) > mu * fy + 1e-3) frictionOk = false;
    const halfX = (all[k].copX[1] - all[k].copX[0]) / 2;
    const halfZ = (all[k].copZ[1] - all[k].copZ[0]) / 2;
    if (Math.abs(Mzz) > fy * halfX + 1e-3) copOk = false;
    if (Math.abs(Mzx) > fy * halfZ + 1e-3) copOk = false;
    if (fy > 1e-6) {
      zmpW += fy;
      zmpX += all[k].x + Mzz / fy;
      zmpZ += all[k].z - Mzx / fy;
    }
  }
  const zmp = zmpW > 1e-9 ? [zmpX / zmpW, zmpZ / zmpW] : [NaN, NaN];
  return {
    lambda,
    feasible: equalityOk && unilateralOk && frictionOk && copOk,
    residual: [resLin, resAng],
    checks: { unilateral: unilateralOk, friction: frictionOk, cop: copOk, equality: equalityOk },
    fTotal: [fxT, fyT, fzT],
    zmp,
    nActive: na,
    iters: it
  };
}
function solveSym6(N, b) {
  const A = new Float64Array(36);
  A.set(N);
  const x = new Float64Array(6);
  for (let i = 0; i < 6; i++) x[i] = b[i];
  for (let c = 0; c < 6; c++) {
    let piv = c, best = Math.abs(A[c * 6 + c]);
    for (let r = c + 1; r < 6; r++) {
      const v = Math.abs(A[r * 6 + c]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-300) return null;
    if (piv !== c) {
      for (let c3 = 0; c3 < 6; c3++) {
        const t2 = A[c * 6 + c3];
        A[c * 6 + c3] = A[piv * 6 + c3];
        A[piv * 6 + c3] = t2;
      }
      const t = x[c];
      x[c] = x[piv];
      x[piv] = t;
    }
    const d = A[c * 6 + c];
    for (let r = c + 1; r < 6; r++) {
      const f = A[r * 6 + c] / d;
      if (f === 0) continue;
      for (let c3 = c; c3 < 6; c3++) A[r * 6 + c3] -= f * A[c * 6 + c3];
      x[r] -= f * x[c];
    }
  }
  for (let r = 5; r >= 0; r--) {
    let acc = x[r];
    for (let c = r + 1; c < 6; c++) acc -= A[r * 6 + c] * x[c];
    const d = A[r * 6 + r];
    if (Math.abs(d) < 1e-300) return null;
    x[r] = acc / d;
  }
  const out = [];
  for (let i = 0; i < 6; i++) {
    if (!Number.isFinite(x[i])) return null;
    out.push(x[i]);
  }
  return out;
}

// .tmp/dbg-grf.mjs
var G2 = 9.81;
var M = 70;
var cs = newCentroidalState();
cs.m = M;
cs.cx = 0;
cs.cy = 0.95;
cs.cz = 0;
cs.Ic.fill(0);
cs.Ic[0] = 4;
cs.Ic[4] = 6;
cs.Ic[8] = 4;
cs.dhReady = true;
var foot = (x, z, active = true) => ({ x, y: 0, z, copX: [x - 0.14, x + 0.14], copZ: [z - 0.09, z + 0.09], active });
var C = [foot(0, 0.167), foot(0, -0.167)];
for (const ax of [0, 1, 4]) {
  const o = solveGrfQp({ contacts: C, cs, aDesX: ax, aDesY: 0, aDesZ: 0 });
  console.log(`a_des_x=${ax}`);
  for (let k = 0; k < 2; k++) {
    const b = 5 * k;
    console.log(`  \u811A${k}: fx=${o.lambda[b].toFixed(2).padStart(8)} fy=${o.lambda[b + 1].toFixed(2).padStart(8)} fz=${o.lambda[b + 2].toFixed(2).padStart(8)} Mzx=${o.lambda[b + 3].toFixed(2).padStart(8)} Mzz=${o.lambda[b + 4].toFixed(2).padStart(8)}`);
  }
  console.log(`  F=(${o.fTotal.map((v) => v.toFixed(1))})  resLin=${o.residual[0].toFixed(3)} resAng=${o.residual[1].toFixed(3)}  ZMP=(${o.zmp[0].toFixed(4)},${o.zmp[1].toFixed(4)}) iters=${o.iters} checks=${JSON.stringify(o.checks)}`);
  console.log(`  LIPM \u671F\u671B ZMP_x = -(a*z/g) = ${(-(ax * 0.95 / G2)).toFixed(4)} m`);
}

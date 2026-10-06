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
  const cs = inp.cs;
  const m = Math.max(1e-6, cs.m);
  const bLin = [m * inp.aDesX, m * (inp.aDesY + G), m * inp.aDesZ];
  const alpha = inp.alphaDes ?? [0, 0, 0];
  const bAng = [
    cs.Ic[0] * alpha[0] + cs.Ic[1] * alpha[1] + cs.Ic[2] * alpha[2],
    cs.Ic[3] * alpha[0] + cs.Ic[4] * alpha[1] + cs.Ic[5] * alpha[2],
    cs.Ic[6] * alpha[0] + cs.Ic[7] * alpha[1] + cs.Ic[8] * alpha[2]
  ];
  return solveLinear(inp, all, act, m, bLin, bAng, mu, iters, lambda, nAll);
}
function solveLinear(inp, all, act, m, bLin, bAng, mu, iters, lambda, nAll) {
  const na = act.length;
  const n = na * 5;
  const cs = inp.cs;
  const Phi = new Float64Array(6 * n);
  for (let a = 0; a < na; a++) {
    const C = all[act[a]];
    const rx = C.x - cs.cx, ry = C.y - cs.cy, rz = C.z - cs.cz;
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
      const C = all[act[a]];
      const o = a * 5;
      const halfX = Math.max(1e-4, (C.copX[1] - C.copX[0]) / 2);
      const halfZ = Math.max(1e-4, (C.copZ[1] - C.copZ[0]) / 2);
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
    let rel = 0;
    for (let j = 0; j < n; j++) {
      const scale = Math.sqrt(iw[j]);
      rel = Math.max(rel, Math.abs(sol[j] - lambda[act[Math.floor(j / 5)] * 5 + j % 5]) / scale);
    }
    for (let j = 0; j < n; j++) lambda[act[Math.floor(j / 5)] * 5 + j % 5] = sol[j];
    if (rel < 1e-9) {
      it++;
      break;
    }
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
      const zx = all[k].x + Mzz / fy;
      const zz = all[k].z - Mzx / fy;
      zmpW += fy;
      zmpX += fy * zx;
      zmpZ += fy * zz;
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

// tools/probe-grf.ts
var log = console.log;
var G2 = 9.81;
var M = 70;
var fails = 0;
var bad = (m) => {
  fails++;
  log(`  \u2717 ${m}`);
};
var ok = (m) => log(`  \u2713 ${m}`);
function mkCs(m = M, comY = 0.95) {
  const s = newCentroidalState();
  s.m = m;
  s.cx = 0;
  s.cy = comY;
  s.cz = 0;
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.Ic.fill(0);
  s.Ic[0] = 4;
  s.Ic[4] = 6;
  s.Ic[8] = 4;
  s.hx = 0;
  s.hy = 0;
  s.hz = 0;
  s.dhx = 0;
  s.dhy = 0;
  s.dhz = 0;
  s.dhReady = true;
  return s;
}
function foot(x, z, active = true) {
  return {
    x,
    y: 0,
    z,
    copX: [x - 0.14, x + 0.14],
    copZ: [z - 0.09, z + 0.09],
    active
  };
}
var bothFeet = () => [foot(0, 0.167), foot(0, -0.167)];
log("\u2550\u2550 \u03BB-QP\uFF08\u63A5\u89E6\u529B\uFF09\u79BB\u7EBF\u9A8C\u6536 \u2550\u2550");
log("   \u53C2\u8003\uFF1A\u6D6E\u52A8\u57FA\u5EA7\u90A3 6 \u884C\u662F\u7B49\u5F0F\uFF1B\u03BB \u662F\u51B3\u7B56\u53D8\u91CF\uFF1B\u03C4 \u4E4B\u540E\u7531\u9A71\u52A8\u884C\u5B9A\u6B7B");
log("");
log('\u2550\u2550 A. \u9759\u6001\u7AD9\u7ACB\uFF1AF_y \u5FC5\u987B \u2248 m\xB7g\uFF0C\u4E14\u4E0D\u662F"\u6CA1\u4EBA\u7BA1\u5B83"\u2550\u2550');
{
  const cs = mkCs();
  const o = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 0, aDesY: 0, aDesZ: 0, dhDes: null });
  const fy = o.fTotal[1];
  const want = M * G2;
  log(`   \u671F\u671B F_y = m\xB7g = ${want.toFixed(1)} N`);
  log(`   \u5B9E\u5F97 F_y = ${fy.toFixed(1)} N   (\u8BEF\u5DEE ${(100 * (fy - want) / want).toFixed(2)}%)`);
  log(`   \u7B49\u5F0F\u6B8B\u5DEE\uFF1A\u7EBF\u6027 ${o.residual[0].toFixed(3)} N   \u89D2\u52A8\u91CF ${o.residual[1].toFixed(3)} N\xB7m/s`);
  log(`   ZMP = (${o.zmp[0].toFixed(4)}, ${o.zmp[1].toFixed(4)})   \u5408\u6210 F = (${o.fTotal[0].toFixed(2)}, ${fy.toFixed(1)}, ${o.fTotal[2].toFixed(2)})`);
  if (Math.abs(fy - want) / want > 0.02) bad(`\u9759\u6001\u7AD9\u7ACB F_y \u504F\u5DEE >2%`);
  else ok(`\u9759\u6001\u7AD9\u7ACB F_y \u81EA\u52A8\u843D\u5230 m\xB7g\uFF08\u504F\u5DEE ${(100 * (fy - want) / want).toFixed(2)}%\uFF09`);
  if (!o.checks.friction) bad("\u6709 f_y \u4E4B\u540E\u6469\u64E6\u9525\u4ECD\u5224\u4E0D\u8FC7 \u2014\u2014 \u7EA6\u675F\u63A5\u7EBF\u6709\u95EE\u9898");
  else ok(`\u6469\u64E6\u9525\u53EF\u5224\u4E14\u901A\u8FC7\uFF08|F_h|=${Math.hypot(o.fTotal[0], o.fTotal[2]).toFixed(2)} N \u2264 \u03BC\xB7${fy.toFixed(0)}\uFF09`);
  if (!o.checks.cop) bad("\u6709 f_y \u4E4B\u540E CoP \u4ECD\u5224\u4E0D\u8FC7");
  else ok(`CoP \u53EF\u5224\u4E14\u5728\u652F\u6491\u591A\u8FB9\u5F62\u5185`);
  if (!o.checks.unilateral) bad("\u5355\u8FB9\u7EA6\u675F\u672A\u8FC7");
  else ok("\u5355\u8FB9\u7EA6\u675F fy \u2265 0 \u901A\u8FC7");
  const l = o.lambda;
  const fyL = l[1], fyR = l[6];
  log(`   \u8F7D\u8377\u5206\u914D\uFF1A\u5DE6 ${fyL.toFixed(1)} N (${(100 * fyL / fy).toFixed(1)}%)   \u53F3 ${fyR.toFixed(1)} N (${(100 * fyR / fy).toFixed(1)}%)`);
  if (fy > 1 && Math.abs(fyL - fyR) / fy < 0.02) ok("\u5BF9\u79F0\u7AD9\u59FF\u4E0B\u4E24\u811A\u5404\u534A\uFF08\u5197\u4F59\u81EA\u7531\u5EA6\u88AB\u6B63\u786E\u7528\u6765\u5206\u914D\uFF09");
  else bad(`\u4E24\u811A\u8F7D\u8377\u4E0D\u5747\uFF1A${fyL.toFixed(1)} vs ${fyR.toFixed(1)}\uFF08\u5BF9\u79F0\u8F93\u5165\u5E94\u5404\u534A\uFF09`);
}
log("");
log("\u2550\u2550 B. \u6C34\u5E73\u529B\u7684\u4EE3\u4EF7\uFF1ACoP \u5FC5\u987B\u642C\u8FDB\u652F\u6491\u591A\u8FB9\u5F62\u5185 \u2550\u2550");
{
  const cs = mkCs();
  const inpAx1 = 1;
  const o = solveGrfQp({ contacts: bothFeet(), cs, aDesX: inpAx1, aDesY: 0, aDesZ: 0 });
  log(`   a_des = (+1.0, 0, 0) m/s\xB2  \u21D2  F_x = ${o.fTotal[0].toFixed(1)} N\uFF08\u671F\u671B ${(M * 1).toFixed(1)}\uFF09  F_y = ${o.fTotal[1].toFixed(1)} N  ZMP_x = ${o.zmp[0].toFixed(4)} m`);
  if (Math.abs(o.fTotal[0] - M) / M > 0.03) bad(`F_x \u6CA1\u8DDF\u4E0A\u671F\u671B\uFF08${o.fTotal[0].toFixed(1)} vs ${M}\uFF09`);
  else ok("F_x \u8DDF\u4E0A\u4E86 m\xB7a_des");
  const zmpLipp = -(inpAx1 * 0.95) / G2;
  const zmpGot = o.zmp[0];
  log(`   LIPM \u671F\u671B ZMP_x = \u2212a\xB7z_c/g = ${(zmpLipp * 1e3).toFixed(1)} mm   \u5B9E\u5F97 ${(zmpGot * 1e3).toFixed(1)} mm`);
  if (zmpGot < -0.05 && Math.abs(zmpGot - zmpLipp) / Math.abs(zmpLipp) < 0.1) {
    ok(`CoP \u540E\u79FB\u5230 ${(zmpGot * 1e3).toFixed(1)} mm\uFF0C\u4E0E LIPM \u4E00\u81F4\uFF0810% \u5185\uFF09\u2014\u2014 \u6C34\u5E73\u529B\u7684\u7269\u7406\u4EE3\u4EF7\u6210\u7ACB`);
  } else {
    bad(`CoP \u672A\u6309 LIPM \u540E\u79FB\uFF1A\u5B9E\u5F97 ${(zmpGot * 1e3).toFixed(1)} mm\uFF0C\u671F\u671B ${(zmpLipp * 1e3).toFixed(1)} mm`);
  }
  const big = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 30, aDesY: 0, aDesZ: 0, dhDes: null });
  log(`   a_des = (+30, 0, 0) m/s\xB2 \u21D2  F_x = ${big.fTotal[0].toFixed(0)} N  ZMP_x = ${big.zmp[0].toFixed(3)} m  feasible=${big.feasible ? "\u2713" : "\u2717"}  checks=${JSON.stringify(big.checks)}`);
  if (!big.feasible) ok("\u9700\u6C42\u8D85\u51FA\u652F\u6491\u9762\u65F6\u5982\u5B9E\u62A5 infeasible\uFF08CoP \u7EA6\u675F\u751F\u6548\uFF09");
  else bad(`F_x \u9700\u6C42 2100N \u7ADF\u5224\u53EF\u884C \u2014\u2014 CoP \u7EA6\u675F\u6CA1\u751F\u6548`);
}
log("");
log('\u2550\u2550 C. \u5355\u652F\u6491\uFF1A\u6446\u52A8\u811A\u5FC5\u987B f_y \u2261 0\uFF0C\u4E0D\u80FD"\u5206\u5230\u4E00\u70B9\u8F7D\u8377"\u2550\u2550');
{
  const cs = mkCs();
  const c = bothFeet();
  c[1].active = false;
  const o = solveGrfQp({ contacts: c, cs, aDesX: 0, aDesY: 0, aDesZ: 0, dhDes: null });
  const fySwing = o.lambda[6];
  log(`   \u6446\u52A8\u811A f_y = ${fySwing.toFixed(6)} N   \u652F\u6491\u811A f_y = ${o.lambda[1].toFixed(1)} N`);
  if (Math.abs(fySwing) < 1e-6) ok("\u6446\u52A8\u811A f_y \u2261 0\uFF08\u5355\u8FB9\u7EA6\u675F\u786C\u751F\u6548\uFF09");
  else bad(`\u6446\u52A8\u811A\u62FF\u5230\u4E86 ${fySwing.toFixed(2)} N \u8F7D\u8377 \u2014\u2014 \u5355\u8FB9\u6CA1\u751F\u6548`);
  if (o.lambda[1] > M * G2 * 0.99) ok(`\u652F\u6491\u811A\u72EC\u81EA\u6491\u4F4F\u5168\u90E8\u4F53\u91CD\uFF08${o.lambda[1].toFixed(1)} N\uFF09`);
  else bad(`\u652F\u6491\u811A\u53EA\u6491\u4E86 ${o.lambda[1].toFixed(1)} N < m\xB7g`);
}
log("");
log("\u2550\u2550 D. \u6469\u64E6\u9525\uFF1A|F_h| \u2264 \u03BC\xB7F_y \u771F\u7684\u5728\u8D77\u4F5C\u7528 \u2550\u2550");
{
  const cs = mkCs();
  for (const mu of [0.3, 0.8]) {
    const o = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 20, aDesY: 0, aDesZ: 0, mu });
    const fh = Math.hypot(o.fTotal[0], o.fTotal[2]);
    const cap = mu * o.fTotal[1];
    log(`   \u03BC=${mu}  a_des_x=20 \u21D2  |F_h| = ${fh.toFixed(0)} N   \u03BC\xB7F_y = ${cap.toFixed(0)} N  friction=${o.checks.friction ? "\u2713" : "\u2717"}`);
    const satOk = Math.abs(fh - cap) < 0.01 * Math.max(1, cap);
    log(`     ${satOk ? "\u2713" : "\u2717"} \u538B\u5230\u9525\u58C1\uFF08|F_h| ${fh.toFixed(0)} vs \u9525\u58C1 ${cap.toFixed(0)}\uFF09   \u7B49\u5F0F\u6B8B\u5DEE ${o.residual[0].toFixed(0)} N   equality=${o.checks.equality ? "\u2713" : "\u2717\uFF08\u5DF2\u5982\u5B9E\u62A5\u51FA\uFF09"}   feasible=${o.feasible ? "\u2713" : "\u2717"}`);
    if (!satOk) bad(`\u03BC=${mu} \u4E0B F_h \u843D\u5728 ${fh.toFixed(0)} N\uFF0C\u65E2\u4E0D\u5728\u9525\u5185\uFF08${cap.toFixed(0)}\uFF09\u4E5F\u4E0D\u5728\u9525\u58C1`);
    else if (!o.checks.friction) bad(`\u03BC=${mu} \u4E0B\u8F93\u51FA\u8D8A\u51FA\u6469\u64E6\u9525\uFF08\u975E\u6CD5\u8F93\u51FA\u6BD4\u4E0D\u6EE1\u8DB3\u9700\u6C42\u66F4\u7CDF\uFF09`);
    else if (o.checks.equality) bad(`\u88AB\u6469\u64E6\u9525\u6321\u4F4F\u5374\u4ECD\u62A5\u7B49\u5F0F\u6210\u7ACB \u2014\u2014 \u6B8B\u5DEE\u6CA1\u62A5\u51FA\u6765`);
    else if (o.feasible) bad(`\u9700\u6C42\u672A\u6EE1\u8DB3\u5374\u62A5 feasible`);
    else ok(`\u03BC=${mu}\uFF1A\u8F93\u51FA\u5408\u6CD5\uFF08\u538B\u5230\u9525\u58C1\uFF09+ \u6B8B\u5DEE ${o.residual[0].toFixed(0)}N + infeasible\uFF0C\u4E09\u8005\u4E00\u81F4`);
  }
  const o2 = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 2, aDesY: 0, aDesZ: 0, mu: 0.8 });
  if (o2.checks.friction) ok(`\u5C0F\u9700\u6C42\uFF08a_x=2 \u21D2 140N\uFF09\u5728 \u03BC=0.8 \u9525\u5185\uFF08\u4E0A\u9650 549N\uFF09`);
  else bad(`\u5C0F\u9700\u6C42\u88AB\u6469\u64E6\u9525\u8BEF\u6740`);
}
log("");
log("\u2550\u2550 E. \u9000\u5316\u5FC5\u987B\u663E\u5F0F\u62A5\u51FA\uFF1Af_y \u2248 0 \u21D2 ZMP \u65E0\u5B9A\u4E49 \u2550\u2550");
{
  const cs = mkCs();
  const c = bothFeet();
  c[0].active = false;
  c[1].active = false;
  const o = solveGrfQp({ contacts: c, cs, aDesX: 0, aDesY: -G2, aDesZ: 0, dhDes: null });
  log(`   \u817E\u7A7A\uFF08a_des_y = \u2212g \u21D2 \u81EA\u7531\u843D\u4F53\uFF09\u21D2  F_y = ${o.fTotal[1].toFixed(3)} N   ZMP = (${o.zmp[0]}, ${o.zmp[1]})`);
  if (Number.isNaN(o.zmp[0])) ok("ZMP \u62A5 NaN\uFF08\u65E0 f_y \u21D2 CoP \u65E0\u5B9A\u4E49\uFF09\uFF0C\u800C\u4E0D\u662F\u9759\u9ED8\u7ED9 0");
  else bad(`ZMP \u7ED9\u51FA\u4E86 ${o.zmp[0]} \u2014\u2014 \u65E0 f_y \u65F6 CoP \u65E0\u5B9A\u4E49\uFF0C\u7ED9\u6570\u5B57\u5C31\u662F\u7F16\u9020`);
}
log("");
if (fails) {
  log(`\u2717 \u03BB-QP \u9A8C\u6536\u5931\u8D25 ${fails} \u9879`);
  process.exit(1);
}
log("\u2605 \u03BB-QP \u9A8C\u6536\u5168\u7EFF\uFF1A\u7AD6\u5411\u81EA\u52A8\u843D\u5230 mg\u3001CoP \u4E0E\u6469\u64E6\u9525\u53EF\u5224\u3001\u5355\u8FB9\u751F\u6548\u3001\u9000\u5316\u663E\u5F0F\u62A5\u51FA");

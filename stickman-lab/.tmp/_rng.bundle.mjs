// src/core/brain.ts
var HIDDEN_UNITS = 32;
function shapeForJoints(jointCount) {
  return { inputs: 22 + 6 * jointCount, hidden: HIDDEN_UNITS, outputs: 3 * jointCount };
}
var BRAIN_SHAPE = shapeForJoints(9);
function inputLayout(jointCount) {
  const out = [
    "clock.sin",
    "clock.cos",
    // 0,1
    "chest.quat.x",
    "chest.quat.y",
    "chest.quat.z",
    "chest.quat.w",
    // 2..5
    "chest.vx",
    "chest.vy",
    "chest.vz",
    // 6..8
    "chest.wx",
    "chest.wy",
    "chest.wz",
    // 9..11
    "chest.height",
    // 12
    "chest.lateralZ",
    // 13
    "com.dx",
    "com.dz",
    // 14,15 CoM 相对支撑域中心（m）
    "com.vx",
    "com.vz",
    // 16,17 CoM 水平速度（×2）
    "dcm.nx",
    "dcm.nz"
    // 18,19 DCM 归一化位置（0=中心，±1=域边缘）
  ];
  for (let i = 0; i < jointCount; i++) out.push(`joint[${i}].rot.x`, `joint[${i}].rot.y`, `joint[${i}].rot.z`);
  for (let i = 0; i < jointCount; i++) out.push(`joint[${i}].relw.x`, `joint[${i}].relw.y`, `joint[${i}].relw.z`);
  out.push("sole.l.y", "sole.r.y");
  return out;
}
var INPUT_LAYOUT = inputLayout(12);
var INPUT_COUNT = 22 + 6 * 12;

// src/core/genome.ts
function makeRng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  f.getState = () => ({ s: a });
  f.setState = (st2) => {
    a = st2.s >>> 0;
  };
  return f;
}
function makeGaussian(rng) {
  let spare = 0;
  let hasSpare = false;
  const f = () => {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    hasSpare = true;
    return u * m;
  };
  f.getState = () => ({ s: rng.getState ? rng.getState().s : 0, spare, hasSpare });
  f.setState = (st2) => {
    if (rng.setState && st2) rng.setState({ s: st2.s });
    spare = st2?.spare ?? 0;
    hasSpare = st2?.hasSpare ?? false;
  };
  return f;
}

// tools/_rng.ts
var r1 = makeRng(42);
r1();
r1();
var st = r1.getState();
var x1 = r1();
var y1 = r1();
var r2 = makeRng(999);
r2.setState(st);
var x2 = r2();
var y2 = r2();
console.log(`rng \u6062\u590D: ${x1.toFixed(9)} vs ${x2.toFixed(9)}  ${x1 === x2 ? "\u2714" : "\u2718"}`);
var g1 = makeGaussian(makeRng(7));
g1();
var gst = g1.getState();
var gv1 = g1();
var g2 = makeGaussian(makeRng(123));
g2.setState(gst);
var gv2 = g2();
console.log(`gauss \u6062\u590D: ${gv1.toFixed(9)} vs ${gv2.toFixed(9)}  ${gv1 === gv2 ? "\u2714" : "\u2718"}`);
var R1 = makeRng(5);
var G1 = makeGaussian(R1);
G1();
G1();
var snap = G1.getState();
var R2 = makeRng(77);
var G2 = makeGaussian(R2);
G2.setState(snap);
var c1 = [G1(), G1(), G1()];
var c2 = [G2(), G2(), G2()];
console.log(`\u7EC4\u5408\u6062\u590D: ${c1.map((v) => v.toFixed(6)).join(",")} vs ${c2.map((v) => v.toFixed(6)).join(",")}  ${c1.every((v, i) => v === c2[i]) ? "\u2714" : "\u2718"}`);

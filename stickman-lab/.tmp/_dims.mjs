// 一次性量尺：把 parts.json 的像素尺寸换算成物理尺寸，回答"隐藏骨架是不是太小"
import fs from 'node:fs';

const M = JSON.parse(fs.readFileSync('src/data/parts.json', 'utf8'));
const H = 1.8;
const px2m = H / M.extent.h;
const centerPx = (M.extent.x0 + M.extent.x1) / 2;
const groundPx = M.extent.y1;

console.log(`画布 ${M.canvas.w}x${M.canvas.h}   并集包围盒 ${M.extent.w}x${M.extent.h} px`);
console.log(
  `px2m = ${px2m.toFixed(6)}   总高 ${(M.extent.h * px2m).toFixed(3)} m`
  + `   总宽 ${(M.extent.w * px2m).toFixed(3)} m`,
);
console.log(
  `脚掌 meta: len=${M.sole.len}px = ${(M.sole.len * px2m).toFixed(3)} m`
  + `   thick=${M.sole.thick}px = ${(M.sole.thick * px2m).toFixed(3)} m`
  + `   mass%=${M.sole.massPercent}`,
);

const SEG = {
  head: 8.1, torso: 49.7, arm_l: 2.8, arm_r: 2.8, hand_l: 2.2, hand_r: 2.2,
  thigh_l: 10, thigh_r: 10, shin_l: 6.1, shin_r: 6.1,
};
const MASS = 70;

console.log('\n组件         bbox(px)      尺寸(m)        胶囊L/r(m)      中心z(m)  质量kg');
for (const p of M.parts) {
  const w = p.bw * px2m;
  const h = p.bh * px2m;
  const length = Math.max(w, h);
  const radius = Math.min((Math.min(w, h) / 2) * 0.6, (length / 2) * 0.92);
  const z = -(p.cx - centerPx) * px2m;
  const m = ((SEG[p.key] ?? 0) / 100) * MASS;
  console.log(
    `${p.key.padEnd(10)} ${String(p.bw).padStart(5)}x${String(p.bh).padStart(5)}`
    + `  ${w.toFixed(3)}x${h.toFixed(3)}  L=${length.toFixed(3)} r=${radius.toFixed(4)}`
    + `  z=${z.toFixed(4).padStart(7)}  ${m.toFixed(2)}`,
  );
}

console.log('\n关节锚点（世界米）：');
for (const j of M.joints) {
  console.log(
    `  ${j.name.padEnd(11)} parent=${j.parent.padEnd(7)} child=${j.child.padEnd(8)}`
    + ` x=${(j.x * px2m).toFixed(4)} y=${((groundPx - j.y) * px2m).toFixed(3)}`
    + ` z=${(-(j.x - centerPx) * px2m).toFixed(4)}  limit=${JSON.stringify(j.limitDeg)}`,
  );
}

// ---- 派生量：站立能力真正关心的几个数 ----
const thighL = M.parts.find((p) => p.key === 'thigh_l');
const thighR = M.parts.find((p) => p.key === 'thigh_r');
const shinL = M.parts.find((p) => p.key === 'shin_l');
const stanceZ = (-(thighL.cx - centerPx) * px2m) - (-(thighR.cx - centerPx) * px2m);
const shinW = shinL.bw * px2m;
const shinRad = Math.min((Math.min(shinW, shinL.bh * px2m) / 2) * 0.6, 0.3);
const footHalfZ = shinRad * 0.9;
const footHalfX = (M.sole.len * px2m) / 2;

console.log('\n★ 站立相关的派生量：');
console.log(`  两脚中心间距（站姿宽）      ${Math.abs(stanceZ).toFixed(3)} m`);
console.log(`  脚掌物理尺寸 长 ${(footHalfX * 2).toFixed(3)} m  宽 ${(footHalfZ * 2).toFixed(3)} m`);
console.log(`  脚掌在地面上的横向可用范围  ±${(Math.abs(stanceZ) / 2 + footHalfZ).toFixed(3)} m（两脚凸包）`);
console.log(`  前后平衡极限（踝→趾）      ±${footHalfX.toFixed(3)} m`);
console.log(`  身高 1.800 m 的两脚间距/身高 = ${(Math.abs(stanceZ) / 1.8).toFixed(3)}（真人直立 ≈ 0.06~0.11）`);
console.log(`  脚长/身高 = ${((footHalfX * 2) / 1.8).toFixed(3)}（真人 ≈ 0.15）`);

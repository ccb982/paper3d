/** probe-footskin.ts —— 柔性足顶点解算验收（离线，纯数学，不依赖 WebGL） */
import { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } from '../src/core/skeleton';
import { buildFootBinding, skinPositions, bindSegPositions, identitySegRotations }
  from '../src/render/viewer.skin';
const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const bi = (k: string): number => sk.bodies.findIndex((b) => b.key === k);
const fl = bi('foot_l'), al = bi('arch_l');
if (fl < 0 || al < 0) throw new Error('缺少 foot_l / arch_l');
const foot = sk.bodies[fl];

// 弓的自由轴与行程直接从关节定义取，不写死
const ja = jointIndexByName(sk, 'arch_l');
const ax = sk.joints[ja].revoluteAxis ?? [1, 0, 0];
const lo = sk.joints[ja].minRad[0], hi = sk.joints[ja].maxRad[0];
const lim = [Math.round(lo * 180 / Math.PI), Math.round(hi * 180 / Math.PI)];
// ★ 弓的 x 跨度从 **collider 实际偏移**求（真源），不从配置比例反推 ——
//   配置里只有近端 `archAtFrac`，远端在 blk() 的 fx 参数里，两处会漂。
const archSpan = (bd: any): [number, number] => bd.colliders.reduce(
  (a: [number, number], c: any) => [Math.min(a[0], c.offsetX - c.hx),
                                    Math.max(a[1], c.offsetX + c.hx)],
  [Infinity, -Infinity] as [number, number]);
const [ax0, ax1] = archSpan(sk.bodies[al]);
log(`══ 灵性足顶点解算 ══`);
log(`   foot_l idx=${fl} arch_l idx=${al}  弓自由轴=[${ax.map((v) => v.toFixed(2))}]`
  + ` 限位=[${lim[0]},${lim[1]}]°`);
log(`   板 ${(foot.part.bw * sk.px2m * 1000).toFixed(0)}×`
  + `${(foot.part.bh * sk.px2m * (foot.plateUv?.height ?? 1) * 1000).toFixed(0)}mm`
  + `  弓区 x=[${(ax0 * 1000).toFixed(0)},${(ax1 * 1000).toFixed(0)}]mm`
  + ` (足长 ${(foot.length * 1000).toFixed(0)}mm)`);

const b = buildFootBinding(sk, fl, al, sk.joints[ja], ax0, ax1, 24, 4);
const deg = lim[1];
const th = (deg * Math.PI) / 180;
const c = Math.cos(th), sn = Math.sin(th);
// segR2: 段0=foot 单位阵，段1=arch 绕自由轴[1,0,0]旋转
const segR2 = new Float64Array(b.segBody.length * 9);
segR2[0] = 1; segR2[4] = 1; segR2[8] = 1;
segR2[9] = 1; segR2[13] = c; segR2[14] = -sn; segR2[16] = sn; segR2[17] = c;

log(`   网格 ${b.cols}×${b.rows}  顶点数 ${b.vCount}`);

// ---- [I] 恒等收敛：单位旋转下输出必须逐位等于 bindPos ----
const segT = new Float64Array(b.segBody.length * 3);
const segR = new Float64Array(b.segBody.length * 9);
bindSegPositions(sk, b, segT);
identitySegRotations(b, segR);
const out = new Float32Array(b.vCount * 3);
skinPositions(b, segT, segR, out);
let e = 0;
for (let i = 0; i < b.vCount * 3; i++) e = Math.max(e, Math.abs(out[i] - b.bindPos[i]));
log(`   [I] 恒等收敛最大误差 = ${(e * 1e6).toFixed(3)} µm  ${e < 1e-6 ? '✓' : '✗'}`);

// ---- [I2] ★ 等价性：绑定姿态下蒙皮顶点 == 旧**刚性**板路径的顶点 ----
//   解析推导（`qFix` 绕 Y+90°，`qYaw90 = (key==='foot_l'?1:-1)·90°`）：
//     左脚：Ry(90°)⊗Ry(90°) = Ry(180°) ⇒ (px,py,0) → (−px, py, 0)
//     右脚：Ry(90°)⊗Ry(−90°) = I        ⇒ (px,py,0) → ( px, py, 0)
//   ⇒ 左脚沿 −X、右脚沿 +X。**符号错一次就是"脚纹理前后反了"**（用户实测）。
const sh = foot.plateUv
  ? foot.part.bh * sk.px2m * (foot.plateUv.y + foot.plateUv.height / 2 - 0.5) : 0;
const ox = foot.cx + foot.plateOffset[0];
const oy = foot.cy + foot.plateOffset[1] + sh;
const oz = foot.cz + foot.plateOffset[2];
const sgnR = foot.key === 'foot_l' ? -1 : 1;
let eRigid = 0;
for (let r = 0; r <= b.rows; r++) {
  for (let c2 = 0; c2 <= b.cols; c2++) {
    const i = r * (b.cols + 1) + c2;
    const px = (c2 / b.cols) * b.w - b.w / 2;
    const py = b.H / 2 - (r / b.rows) * b.H;
    eRigid = Math.max(eRigid,
      Math.abs(b.bindPos[i * 3] - (ox + sgnR * px)),
      Math.abs(b.bindPos[i * 3 + 1] - (oy + py)),
      Math.abs(b.bindPos[i * 3 + 2] - oz));
  }
}
log(`   [I2] 与旧刚性板路径偏差 ${(eRigid * 1e6).toFixed(2)} µm`
  + `  ${eRigid < 1e-9 ? '✓ 符号正确（与旧路径逐位一致）' : '✗ 前后反了或异常'}`);

// ---- [II] 权重剖面：必须 0 → 单调升 → 1 → 回落 → 0，且无折角 ----
const mid = (b.rows >> 1) * (b.cols + 1);
log(`   [II] 列位移(中排, mm): ${(() => {
  const o = new Float32Array(b.vCount * 3);
  skinPositions(b, segT, segR2, o);   // segR2 = 弓转 ${deg}°
  let t = '';
  for (let ix = 0; ix <= b.cols; ix++) {
    const i = mid + ix;
    t += `${(o[i * 3 + 1] - b.bindPos[i * 3 + 1]) * 1000 | 0}`.padStart(4) + ' ';
  }
  return t;
})()}`);
log(`   [II] 权重(中排):     ${(() => {
  let t = '';
  for (let ix = 0; ix <= b.cols; ix++) t += b.vW1[mid + ix].toFixed(1).padStart(4) + ' ';
  return t;
})()}`);
let mono = true, prev = -1, nOut = 0;
for (let ix = 0; ix <= b.cols; ix++) {
  const v = b.vW1[mid + ix];
  if (v < -1e-9 || v > 1 + 1e-9) nOut++;
  if (prev >= 0 && v > prev + 1e-9) { /* 允许上升段 */ }
  prev = v;
}
let dz = 0;
for (let ix = 1; ix <= b.cols; ix++) {
  const d = Math.abs(b.vW1[mid + ix] - b.vW1[mid + ix - 1]);
  if (d > dz) dz = d;
}
// 判据用 smoothstep 的解析最大斜率 1.5/fade列 ——
// 写死一个阈值就是凭感觉（之前写 0.2，于是设计值 0.6 也被误报失败）。
const fadeCols = Math.max(1, (Math.max((ax1 - ax0) * 0.25, (foot.part.bw * sk.px2m / 24) * 2.5))
                          / (foot.part.bw * sk.px2m / 24));
const dzMax = 1.5 / fadeCols;
log(`   [II] 越界顶点 ${nOut}  相邻权重最大跳变 ${dz.toFixed(4)}`
  + `  (smoothstep 解析上限 ${dzMax.toFixed(4)} · ${fadeCols.toFixed(1)} 列)`);
log(`   [II] ${nOut === 0 && dz <= dzMax + 1e-6 ? '✓ 权重平滑且无硬阶跃' : '✗ 权重过檩'}`);

// ---- [III] 弓转限位角：弓区顶点必须动，非弓区必须不动 ----
segR.set(segR2);
const out2 = new Float32Array(b.vCount * 3);
skinPositions(b, segT, segR, out2);
let dArch = 0, dToe = 0;
for (let ix = 0; ix <= b.cols; ix++) {
  const i = mid + ix;
  const d = Math.hypot(out2[i * 3] - b.bindPos[i * 3],
                       out2[i * 3 + 1] - b.bindPos[i * 3 + 1],
                       out2[i * 3 + 2] - b.bindPos[i * 3 + 2]);
  const g = b.vW1[i];
  if (g > 0.9) dArch = Math.max(dArch, d);
  if (g < 1e-9) dToe = Math.max(dToe, d);
}
log(`   [III] 弓转 ${deg}°：弓区最大位移 ${(dArch * 1000).toFixed(1)}mm`
  + `   非arch区 ${(dToe * 1e6).toFixed(3)} µm`);
log(`   [III] ${dArch > 0.005 ? '✓ 弓区跟着变形' : '✗ 弓区没动（还是硬板）'}`
  + `   ${dToe < 1e-6 ? '✓ 非arch区不动' : '✗ 非arch区被误带动'}`);

// ---- [IV] 弓段刚性：权重=1 的顶点到锚点的距离旋转前后应不变 ----
//   采用“到锚点的距离”而不是“位移量”：弓段是绕锚点的刚体旋转，距离必守恒。
const J = sk.joints[ja];
const radBefore: number[] = [], radAfter: number[] = [];
for (let ix = 0; ix <= b.cols; ix++) {
  const i = mid + ix;
  if (b.vW1[i] < 0.999) continue;
  radBefore.push(Math.hypot(b.bindPos[i * 3] - J.wx,
                             b.bindPos[i * 3 + 1] - J.wy,
                             b.bindPos[i * 3 + 2] - J.wz));
  radAfter.push(Math.hypot(out2[i * 3] - J.wx,
                            out2[i * 3 + 1] - J.wy,
                            out2[i * 3 + 2] - J.wz));
}
let dRad = 0;
for (let k2 = 0; k2 < radBefore.length; k2++) dRad = Math.max(dRad, Math.abs(radAfter[k2] - radBefore[k2]));
log(`   [IV] 弓段到锚点距离变化 ${(dRad * 1e6).toFixed(2)} µm`
  + `  (${radBefore.length} 个顶点)  ${dRad < 1e-6 ? '✓ 刚体旋转' : '✗ 弓段被拉长'}`);

// ---- [V] 弧长守恒：LBS 在过渡带会导致“糖封裹”缩短，但应有上限 ----
let worstShrink = 1;
for (let r = 0; r <= b.rows; r++) {
  const row = r * (b.cols + 1);
  for (let ix = 1; ix <= b.cols; ix++) {
    const a0 = (row + ix - 1) * 3, a1 = (row + ix) * 3;
    const d0 = Math.hypot(b.bindPos[a1] - b.bindPos[a0],
                          b.bindPos[a1 + 1] - b.bindPos[a0 + 1],
                          b.bindPos[a1 + 2] - b.bindPos[a0 + 2]);
    const d1 = Math.hypot(out2[a1] - out2[a0], out2[a1 + 1] - out2[a0 + 1],
                          out2[a1 + 2] - out2[a0 + 2]);
    if (d0 > 1e-6) worstShrink = Math.min(worstShrink, d1 / d0);
  }
}
log(`   [V] 最大缩短比 ${worstShrink.toFixed(3)}`
  + `  ${worstShrink > 0.9 ? '✓ 无糖封裹磨磕' : '✗ 网格被压缩'}`);

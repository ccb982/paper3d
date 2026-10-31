/* 由 viewer.ts 抽出：蒙皮的**纯数学**部分（无 THREE / WebGL 依赖），
   供离屏探针 tools/probe-footskin.ts 复用。
   ⚠ viewer.ts 是真源；改蒙皮数学要改那边再重新抽，
     否则离屏验收验的就不是渲染器真正在用的那份代码。 */
import type { JointDef, Skeleton, Vec3 } from '../core/skeleton';

export interface SkinBinding {
  /** 驱动刚体下标，从下（骨盆）到上（胸腔） */
  segBody: number[];
  vCount: number;
  /** 每个顶点的绑定：主段 / 次段 / 次段权重 */
  vS0: Int32Array;
  vS1: Int32Array;
  vW1: Float32Array;
  /** 每个顶点在【主段 / 次段】刚体本地坐标系里的绑定坐标 */
  loc0: Float32Array;
  loc1: Float32Array;
  /** 绑定姿态下的世界位置 —— 蒙皮收敛性判据（单位旋转时输出必须等于它） */
  bindPos: Float32Array;
  /** 板面几何（米）：宽 / 高 / 板心 y / 板心 z / 网格行数 / 网格列数 */
  w: number;
  H: number;
  cyC: number;
  cz: number;
  rows: number;
  /**
   * ★ 网格列数（躯干固定 1 ⇒ `vCount=(rows+1)*2`，与原实现逐位一致）。
   *   柔性足需要 >1：权重沿**足长**变化才能显示弓的旋前，而躯干是沿**高度**变化。
   */
  cols: number;
  /**
   * ★ 绑定姿态下各驱动段的**平移**（K×3）。
   *   躯干 = 各段刚体中心；柔性足 = `[foot 中心, 弓的**关节锚点**]`。
   *   为什么要单独存：`skinPositions` 算的是 `R·loc + T`，旋转绕的是 **T**。
   *   弓若绕**刚体中心**转，近端会与脚掌脱开（实测锚点离中心 41mm）⇒
   *   靴子侧面会出现一条缝。绕**锚点**转才能保证近端焊死在脚掌上。
   */
  segBindT: Float64Array;
  /**
   * ★ 柔性足专用：第 `anchorSeg + 1` 段的旋转原点**不在自己刚体中心**，
   *   而在 `anchorSeg` 段刚体上的 `anchorLocal`（= 弓关节的 `parentLocal`）。
   *   `syncSkin` 每帧据此改写那一段的 `segT`：
   *       anchorWorld = segT[anchorSeg] + R[anchorSeg] · anchorLocal
   *   躯干为 `undefined`（各段绕自己中心转）。
   */
  anchorSeg?: number;
  anchorLocal?: Vec3;
}

/** 脚掌贴图借小腿那张图、只画踝下方的靴子 —— uv 子区域 */
export interface FootUVRect { x: number; y: number; width: number; height: number }

export function buildSkinBinding(sk: Skeleton, segIdx: number[], sub = 6, cols = 1): SkinBinding {
  const segs = [...segIdx].sort(
    (a, b) => sk.bodies[a].texSlice!.index - sk.bodies[b].texSlice!.index,
  );
  const K = segs.length;

  // 板子要覆盖整摞段：y 取所有段的并集。
  // 躯干是高瘦件（bh > bw）⇒ 这段联合区间正好等于 part.bh·px2m，即原来的整块高度，
  // 贴图不会被拉伸。若哪天躯干变成宽扁件，这里会按实际刚体跨度铺板（仍不裁图）。
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const i of segs) {
    const b = sk.bodies[i];
    yLo = Math.min(yLo, b.cy - b.length / 2);
    yHi = Math.max(yHi, b.cy + b.length / 2);
  }
  const H = yHi - yLo;
  const cyC = (yHi + yLo) / 2;
  const cz = sk.bodies[segs[0]].cz;
  const w = sk.bodies[segs[0]].part.bw * sk.px2m;

  const rows = Math.max(1, Math.round(K * sub));
  const vCount = (rows + 1) * (cols + 1);

  const vS0 = new Int32Array(vCount);
  const vS1 = new Int32Array(vCount);
  const vW1 = new Float32Array(vCount);
  const loc0 = new Float32Array(vCount * 3);
  const loc1 = new Float32Array(vCount * 3);
  const bindPos = new Float32Array(vCount * 3);

  for (let i = 0; i < vCount; i++) {
    const iy = (i / (cols + 1)) | 0;
    const ix = i % (cols + 1);
    const py = H / 2 - (iy / rows) * H;   // 板内高度（米），+ 朝上
    const px = (ix / cols) * w - w / 2;   // 板内横向（米），+ 朝画布右

    const by = cyC + py;
    const bz = cz - px;

    // 顶点落在第几段的中心线上：段中心处 v = 段号，段交界处 v = x.5
    let v = ((py + H / 2) / H) * K - 0.5;
    if (v < 0) v = 0;
    else if (v > K - 1) v = K - 1;
    const s0 = Math.min(K - 1, Math.floor(v));
    const s1 = Math.min(K - 1, s0 + 1);
    vS0[i] = s0;
    vS1[i] = s1;
    vW1[i] = s0 === s1 ? 0 : v - s0;

    // 相对各段刚体**绑定姿态**的本地坐标（绑定姿态旋转 = 单位阵 ⇒ 直接相减）
    const b0 = sk.bodies[segs[s0]];
    const b1 = sk.bodies[segs[s1]];
    loc0[i * 3] = -b0.cx;
    loc0[i * 3 + 1] = by - b0.cy;
    loc0[i * 3 + 2] = bz - b0.cz;
    loc1[i * 3] = -b1.cx;
    loc1[i * 3 + 1] = by - b1.cy;
    loc1[i * 3 + 2] = bz - b1.cz;

    bindPos[i * 3] = 0;
    bindPos[i * 3 + 1] = by;
    bindPos[i * 3 + 2] = bz;
  }

  const segBindT = new Float64Array(segs.length * 3);
  for (let s2 = 0; s2 < segs.length; s2++) {
    const bd = sk.bodies[segs[s2]];
    segBindT[s2 * 3] = bd.cx; segBindT[s2 * 3 + 1] = bd.cy; segBindT[s2 * 3 + 2] = bd.cz;
  }
  return {
    segBody: segs, vCount, vS0, vS1, vW1, loc0, loc1, bindPos,
    w, H, cyC, cz, rows, cols, segBindT,
  };
}

/**
 * ★★ 柔性足顶点解算：脚掌板 = `foot_*` 与 `arch_*` 的**两骨 LBS**。
 *
 * 为什么要单独一套绑定（`柔性足设计.md` §4）：
 *   弓的 collider 已从鞋底里**拿走**（`plateHidden` 的弓不画图），所以靴子那张
 *   图只能由 `foot_*` 整张画 —— 但那样弓转 16° 时**网格一动不动**，
 *   视觉上"弓在动、靴子是块硬板"。这里让弓区的顶点按权重跟着弓刚体走。
 *
 * 为什么权重沿**足长 x**、不是躯干那套沿**高度 y**：
 *   弓的自由轴是 `[1,0,0]` = **足长轴**（`skeleton.ts` 的 arch 关节），
 *   即旋前/旋后。脚掌板以**侧面**呈现、长边落在世界 X（`qFix` 绕 Y+90° 再
 *   `qYaw90`），所以沿足长铺列才有非平凡的权重梯度；沿高度铺列的话
 *   旋前在侧视图里几乎不可见。
 *
 * 权重曲线：弓区 `[ax0,ax1]` 内 smoothstep 0→1，两端各留 `fade` 的过渡带，
 *   避免出现折角。`archAtFrac=0.22` ⇒ 弓近端在 x = `(2·0.22−1)·hx`。
 */
export function buildFootBinding(
  sk: Skeleton, footIdx: number, archIdx: number, archJoint: JointDef,
  ax0: number, ax1: number, cols = 24, rows = 4,
): SkinBinding {
  const foot = sk.bodies[footIdx];
  const arch = sk.bodies[archIdx];
  // 板面尺寸：与 viewer 里 `PlaneGeometry(w, h)` 的取法保持一致
  const uv = foot.plateUv;
  const w = foot.part.bw * sk.px2m;                                  // 板宽 = 足长方向
  const h = foot.part.bh * sk.px2m * (uv ? uv.height : 1);          // 板高
  const shift = uv
    ? foot.part.bh * sk.px2m * (uv.y + uv.height / 2 - 0.5)
    : 0;

  // ★ 绑定姿态下的板心世界位置。静止时 `qRel = 单位阵`（viewer 的定调："纹理别动"），
  //   所以板心 = 刚体中心 + plateOffset(+uv 裁剪位移)，**不乘**任何旋转。
  const ox = foot.cx + foot.plateOffset[0];
  const oy = foot.cy + foot.plateOffset[1] + shift;
  const oz = foot.cz + foot.plateOffset[2];

  const vCount = (rows + 1) * (cols + 1);
  const vS0 = new Int32Array(vCount);
  const vS1 = new Int32Array(vCount);
  const vW1 = new Float32Array(vCount);
  const loc0 = new Float32Array(vCount * 3);
  const loc1 = new Float32Array(vCount * 3);
  const bindPos = new Float32Array(vCount * 3);

  // ★ 弓权重：弓区内 1，两端各一条**过渡带** smoothstep 回落。
  //   ⚠ 过渡带宽度必须**跟着网格走**，不能写死比例：原来 `fade=0.06·span`
  //   ≈ 4.9mm，而列间距 `w/cols` ≈ 10mm ⇒ 整条过渡带落在**一个列间隔内**，
  //   权重退化成 0/1 硬阶跃（实测"相邻权重最大跳变 1.0000"），
  //   接缝处网格会被撕开。这里取 **≥2.5 个列间隔**，保证至少有 3 列在渐变。
  const colW = w / Math.max(1, cols);
  const fade = Math.max((ax1 - ax0) * 0.25, colW * 2.5);
  const wArch = (x: number): number => {
    if (x <= ax0 - fade || x >= ax1 + fade) return 0;
    if (x >= ax0 && x <= ax1) return 1;
    const t = x < ax0 ? (x - (ax0 - fade)) / fade : ((ax1 + fade) - x) / fade;
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);          // smoothstep
  };

  for (let i = 0; i < vCount; i++) {
    const iy = (i / (cols + 1)) | 0;
    const ix = i % (cols + 1);
    const px = (ix / cols) * w - w / 2;      // 板内横向 → 足长方向
    const py = h / 2 - (iy / rows) * h;     // 板内高度，+ 朝上

    // ★ 板内 (px,py) → 世界 (0,py,−px)（qFix 绕 Y+90°）→ 再 qYaw90 → 足长落 X。
    //   逐轴推符号（别照抄注释，`qYaw90` 是 `(key==='foot_l' ? 1 : -1)·90°`）：
    //     R_y(+90°) = [[0,0,1],[0,1,0],[-1,0,0]] ⇒ (0,py,−px) 的 x' = +1·(−px) = −px
    //     R_y(−90°) = [[0,0,−1],[0,1,0],[1,0,0]] ⇒ x' = −1·(−px) = +px
    //   ⇒ foot_l 沿 −X、foot_r 沿 +X。
    //   ⚠ 我第一版写成 `sgn * -px`（sgn 左 −1 右 +1）⇒ **两只脚都前后反了**
    //     （用户：「脚纹理前后反了」）。`−px` 那一步已由 qFix 做完，
    //     这里只需再乘 qYaw90 的符号。
    const sgn = foot.key === 'foot_l' ? -1 : 1;
    const bx = ox + sgn * px;
    const by = oy + py;
    const bz = oz + 0;

    const g = wArch(px);
    vS0[i] = 0; vS1[i] = 1; vW1[i] = g;
    loc0[i * 3] = bx - foot.cx;
    loc0[i * 3 + 1] = by - foot.cy;
    loc0[i * 3 + 2] = bz - foot.cz;
    loc1[i * 3] = bx - archJoint.wx;
    loc1[i * 3 + 1] = by - archJoint.wy;
    loc1[i * 3 + 2] = bz - archJoint.wz;
    bindPos[i * 3] = bx; bindPos[i * 3 + 1] = by; bindPos[i * 3 + 2] = bz;
  }

  // 弓段的绑定平移 = **关节锚点**（不是刚体中心）⇒ 旋转绕锚点，近端焊死在脚掌上
  const segBindT = new Float64Array([foot.cx, foot.cy, foot.cz,
                                     archJoint.wx, archJoint.wy, archJoint.wz]);
  return {
    segBody: [footIdx, archIdx], vCount, vS0, vS1, vW1, loc0, loc1, bindPos,
    w, H: h, cyC: oy, cz: oz, rows, cols, segBindT,
    // ★ 弓段绕**弓关节锚点**转（锚点挂在 foot 刚体上）⇒ 近端随脚掌一起动，永不脱开
    anchorSeg: 0,
    anchorLocal: [archJoint.parentLocal[0], archJoint.parentLocal[1], archJoint.parentLocal[2]],
  };
}

/** 绑定姿态下各段刚体的平移（= 板心 + 段偏移），可直接喂给 skinPositions 做恒等检查 */
export function bindSegPositions(sk: Skeleton, b: SkinBinding, out: Float64Array): void {
  // ★ 直接用 binding 自带的 `segBindT`，不再重新查刚体中心 ——
  //   躯干那里 `segBindT` 就是各段中心（行为不变），
  //   柔性足那里弓段是**关节锚点**（绕锚点转才能让弓近端焊死在脚掌上）。
  out.set(b.segBindT);
}

/** 单位旋转矩阵（行主序 3×3）逐段铺开 —— 与 bindSegPositions 配对做收敛性检查 */
export function identitySegRotations(b: SkinBinding, out: Float64Array): void {
  for (let s = 0; s < b.segBody.length; s++) {
    const rp = s * 9;
    out[rp] = 1; out[rp + 1] = 0; out[rp + 2] = 0;
    out[rp + 3] = 0; out[rp + 4] = 1; out[rp + 5] = 0;
    out[rp + 6] = 0; out[rp + 7] = 0; out[rp + 8] = 1;
  }
}

/**
 * 逐顶点线性混合蒙皮：把绑定姿态的顶点按各段刚体的当前位姿混合到**世界坐标**。
 * @param segT K×3 各段刚体的世界平移
 * @param segR K×9 各段刚体的世界旋转（行主序 3×3）
 * @param out  长度必须 = binding.vCount × 3
 */
export function skinPositions(
  b: SkinBinding, segT: Float64Array, segR: Float64Array, out: Float32Array,
): void {
  const n = b.vCount;
  const loc0 = b.loc0;
  const loc1 = b.loc1;
  const vS0 = b.vS0;
  const vS1 = b.vS1;
  const vW1 = b.vW1;
  for (let i = 0; i < n; i++) {
    const i0 = vS0[i], i1 = vS1[i];
    const r0 = i0 * 9, r1 = i1 * 9;
    const t0 = i0 * 3, t1 = i1 * 3;
    const a = i * 3;
    const l0x = loc0[a], l0y = loc0[a + 1], l0z = loc0[a + 2];
    const l1x = loc1[a], l1y = loc1[a + 1], l1z = loc1[a + 2];

    const ax = segR[r0] * l0x + segR[r0 + 1] * l0y + segR[r0 + 2] * l0z + segT[t0];
    const ay = segR[r0 + 3] * l0x + segR[r0 + 4] * l0y + segR[r0 + 5] * l0z + segT[t0 + 1];
    const az = segR[r0 + 6] * l0x + segR[r0 + 7] * l0y + segR[r0 + 8] * l0z + segT[t0 + 2];
    const w1 = vW1[i];
    if (w1 <= 0) {
      out[a] = ax; out[a + 1] = ay; out[a + 2] = az;
    } else {
      const w0 = 1 - w1;
      const bx = segR[r1] * l1x + segR[r1 + 1] * l1y + segR[r1 + 2] * l1z + segT[t1];
      const by = segR[r1 + 3] * l1x + segR[r1 + 4] * l1y + segR[r1 + 5] * l1z + segT[t1 + 1];
      const bz = segR[r1 + 6] * l1x + segR[r1 + 7] * l1y + segR[r1 + 8] * l1z + segT[t1 + 2];
      out[a] = w0 * ax + w1 * bx;
      out[a + 1] = w0 * ay + w1 * by;
      out[a + 2] = w0 * az + w1 * bz;
    }
  }
}

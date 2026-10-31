// ============================================================
// PatchDecor —— 补丁装饰性纹理库（补丁属性的一部分，§14.10 延伸）
// ============================================================
// 语义（2026-09-05 用户定调）：坑洞/裂痕内部"坑坑洼洼"的观感 = 装饰性纹理，
//   作为补丁的属性挂在 PatchOverlay.decor 上（对齐"地块挂材质"的数据驱动风格）。
//   观感随补丁权重 u（depthOf / PATCH_DEPTH，几何侧逐顶点输出）渐变：
//     坑口（u≈0）        → 无装饰（与原地面连续）
//     坑缘坡降带（u 0.2~）→ 碎屑渐入（入坑带）
//     坑心/坑底（u≈1）   → ★ 满强度碎屑坑洼（2026-09-05 用户修正：坑底最需要
//                          凹凸噪点——原"剥蚀带向坑心收敛"设计作废）
//   渲染路径：geometry 逐顶点补丁权重（FaceGeometry.patchW → attribute "apw"）
//   → shader 每像素调图案函数（亮度乘数 + 伪法线扰动）——零烘焙、零贴图，
//   与地块材质库（TileMaterials/TerrainMaterial）同一程序化哲学。
//
// 本文件 = 注册表（声明式模板，对齐 TileMaterials）+ GLSL 图案函数库。
// 加装饰图案 = registerPatchDecor 登记 + PATCH_DECOR_GLSL 加函数 + patchDecor 分发行。
// ============================================================

/** 装饰图案定义（fnId 即注册表索引；params 为参数模板，v1 图案参数内置于 GLSL 常量） */
export interface PatchDecorDef {
  fnId: string;
  label: string;
  /** 参数模板（声明用；v1 由 GLSL 常量承载，uniform 化是后续扩展） */
  params: Record<string, number>;
}

const REGISTRY = new Map<string, PatchDecorDef>();

/** 扩展点：注册补丁装饰图案 */
export function registerPatchDecor(def: PatchDecorDef): void {
  REGISTRY.set(def.fnId, def);
}

/** 补丁装饰声明（PatchOverlay.decor 的类型；strength 缩放整体强度） */
export interface PatchDecorSpec {
  fnId: string;
  strength: number;
}

/** 默认装饰：碎屑坑洼（gravel）——弹坑/裂痕的通用"内部坑洼"观感 */
export const DEFAULT_PATCH_DECOR: PatchDecorSpec = { fnId: 'gravel', strength: 1 };

registerPatchDecor({
  fnId: 'gravel',
  label: '碎屑坑洼',
  params: {
    grainFreq: 52,     // ① 碎粒频率（1/m，高频 hash 亮度抖动）
    grainAmp: 0.30,    //    碎粒亮度幅度
    depressFreq: 9.0,  // ② 塌陷斑频率（1/m，value noise 负偏置）
    depressDepth: 0.85, //   塌陷暗斑深度
    rimGain: 0.20,     // ③ 碎屑堆缘微亮环
    bandEdge: 0.22,    // ④ 入坑带：碎屑渐入完成位置（u）→ 此后满强度直达坑底
  },
});

// ============================================================
// GLSL 图案函数库（拼入 MATERIAL_GLSL 之后；依赖其 h21/vnoise2/fbm2）
// ============================================================
// 输入：w = 纹理空间坐标（顶面世界 xz / 墙面 (沿墙距, 高)），u = 补丁权重 0..1
// 输出：vec3(亮度乘数, 伪法线扰动 x, 伪法线扰动 z)——乘 alb + 偏转伪法线
export const PATCH_DECOR_GLSL = /* glsl */ `
  // ==================== 补丁装饰性纹理（PatchDecor） ====================
  // gravel：碎屑坑洼——三层合成：
  //   ① 碎粒：高频 hash 亮度抖动（土渣颗粒）
  //   ② 塌陷斑：双八度 value noise 负偏置（凹多凸少 = "坑坑洼洼"主体）
  //   ③ 碎屑堆缘微亮环（塌陷斑边缘一圈反光 → 凹凸立体感）
  // 另输出塌陷场梯度作伪法线扰动（微阴影/微高光碎化——"看着不平"的关键在光照）。
  // 强度剖面：入坑带（u 0~0.22）渐入 → 之后满强度直达坑底（u=1 → k=1，
  // 2026-09-05 用户：坑洞底部最需要凹凸噪点；侧壁顶点权重恒 1 同样满强度）。
  vec3 patchDecorGravel(vec2 w, float u) {
    float k = u * smoothstep(0.02, 0.22, u);
    if (k < 0.004) return vec3(1.0, 0.0, 0.0);
    float grain = (h21(floor(w * 52.0)) - 0.5) * 0.30;
    float dep = fbm2(w * 9.0) - 0.60;              // 负偏置：主凹陷
    float rim = smoothstep(-0.16, -0.02, dep) * (1.0 - smoothstep(-0.02, 0.10, dep));
    float lum = 1.0 + (grain + dep * 0.85 + rim * 0.20) * k;
    float e = 0.09;                                 // 塌陷场中心差分 → 梯度
    float dx = vnoise2((w + vec2(e, 0.0)) * 9.0) - vnoise2((w - vec2(e, 0.0)) * 9.0);
    float dz = vnoise2((w + vec2(0.0, e)) * 9.0) - vnoise2((w - vec2(0.0, e)) * 9.0);
    return vec3(lum, -dx * 1.6 * k, -dz * 1.6 * k);
  }
  // 图案分发（v1 单图案直调；注册表扩展时在此加分发行，模式同 MATERIAL_DISPATCH）
  vec3 patchDecor(vec2 w, float u) { return patchDecorGravel(w, u); }
`;

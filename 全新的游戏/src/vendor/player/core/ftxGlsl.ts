// ============================================================
// ftxGlsl —— FTX 合成的唯一 GLSL 实现（base HSL + 残差 → RGB）
// ============================================================
// ★★★ 全项目 GPU 侧只允许在这里出现该公式。
// 收敛前有 4 份复制：
//   · vendor/player/FtxAsset.createCompositeMaterial（uResidualRange 可配，基准）
//   · services/render/FTXQuad（硬编码 0.5）
//   · services/combat/BulletVisual（硬编码 0.5）
//   · vendor/player/gl/renderer（硬编码 0.5，月亮/无人机 VAT）
//
// ★★★ 改动必须同步 CPU 真源 src/fx/tex/ftxComposite.ts —— 两边公式必须逐值一致。
// ★ alpha / discard 策略**故意不抽**：各处语义不同（流体裁切、uFadeAlpha、
//   残差平流不能 discard），抽进来会变成隐式耦合。
// ============================================================

/** HSL → RGB（0~1）。与 CPU 版 `ftxHsl2rgb` 同一公式 */
export const FTX_HSL2RGB_GLSL = /* glsl */ `
  vec3 ftxHsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }
`;

/** HSL→RGB + 残差合成（baseHSLA + residualRgb → rgb） */
export const FTX_COMPOSITE_GLSL = /* glsl */ `
  ${FTX_HSL2RGB_GLSL}
  /** baseHSLA + 量化残差 → RGB；rangeH/rangeSL 通常均为 0.5 */
  vec3 ftxCompositeRgb(vec4 baseHSLA, vec3 residual, float rangeH, float rangeSL) {
    float dH = (residual.r * 2.0 - 1.0) * rangeH;
    float dS = (residual.g * 2.0 - 1.0) * rangeSL;
    float dL = (residual.b * 2.0 - 1.0) * rangeSL;
    float finalH = fract(baseHSLA.r + dH);
    float finalS = clamp(baseHSLA.g + dS, 0.0, 1.0);
    float finalL = clamp(baseHSLA.b + dL, 0.0, 1.0);
    return ftxHsl2rgb(finalH, finalS, finalL);
  }
`;

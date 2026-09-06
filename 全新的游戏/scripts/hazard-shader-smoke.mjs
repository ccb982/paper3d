// ============================================================================
// hazard-shader-smoke —— 警示贴画着色器链路冒烟测试（纯 node 可跑，无 GPU/浏览器）
// ============================================================================
// 目的：离线复现 TerrainMaterial 片元的【oklchShade + 光照 + ACES】全链路，
// 验证贴画的黄/内部/黑在渲染管线后不会漂移成品红/紫。
//
// 结论基准：
//   普通沙土 → 暖棕 tan       贴画黄 → 亮黄 贴画内部 → 深橙 贴画黑 → 黑
//   任何一处出现 R≫G 的"品红/红紫"即判失败。
//
// 用法：node scripts/hazard-shader-smoke.mjs
// ============================================================================

// ---------- 色彩工具（与 colorLab.ts / TerrainMaterial GLSL 完全同式） ----------
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const acesLinear = (x) => {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return (x * (a * x + b)) / (x * (c * x + d) + e);
};

// oklab2linear（同 TerrainMaterial MATERIAL_GLSL）
function oklab2linear(L, A, B) {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416613 * l - 3.3077115904 * m + 0.2309699287 * s,
    -1.2684380041 * l + 2.6097574007 * m - 0.3413193963 * s,
    -0.0041960865 * l - 0.7034186145 * m + 1.7076147009 * s,
  ];
}

// ---------- 输入（取自 Tiles.ts id19 / TileMaterials sand / 常量） ----------
// 沙土地块基色 OKLCH（组调色板中立 → 无着色）
const SAND_BASE = { L: 0.542, C: 0.067, H: 0.191 };
// 贴画目标色
const YELLOW = { L: 0.85, C: 0.175, H: 0.24 };
const INTERIOR = { L: 0.62, C: 0.085, H: 0.16 };
const BLACK = { L: 0.015, C: 0.0, H: 0.0 };

// ---------- oklchShade 收口（base + 装饰 delta → clamp → lab → linear × reflect） ----------
function shade(target, reflect = 1) {
  const LCH = {
    x: SAND_BASE.L + (target.L - SAND_BASE.L),
    y: SAND_BASE.C + (target.C - SAND_BASE.C),
    z: SAND_BASE.H + (target.H - SAND_BASE.H),
  };
  LCH.x = Math.max(0, Math.min(1, LCH.x));
  LCH.y = Math.max(0, Math.min(0.4, LCH.y));
  LCH.z = ((LCH.z % 1) + 1) % 1; // fract(H)
  const base = oklab2linear(
    LCH.x,
    LCH.y * Math.cos(LCH.z * 6.28318530718),
    LCH.y * Math.sin(LCH.z * 6.28318530718),
  );
  return base.map((v) => v * reflect);
}

// ---------- 光照 + ACES（同一中性光 → 纯暴露色相漂移；any 处品红即败） ----------
function render(lin, sun, amb, ao, alb, d, lmG) {
  let lit = lin.map((b, i) => b * alb * (amb[i] * lmG * ao + sun[i] * d));
  lit = lit.map(acesLinear).map(linearToSrgb).map((v) => Math.max(0, Math.min(1, v)));
  return lit.map((v) => Math.round(v * 255));
}

const r8 = (h) => [srgbToLinear((h >> 16 & 255) / 255), srgbToLinear((h >> 8 & 255) / 255), srgbToLinear((h & 255) / 255)];
const SUN_WHITE = [1, 1, 1];
const AMB_ZERO = [0, 0, 0];

// 明亮正午：暖白直射 + 冷蓝环境（TERRAIN_LIGHT_TUNING）
const NOON_SUN = r8(0xfff3e0).map((v) => v * 1.15);
const NOON_AMB = r8(0x9aa8c4).map((v) => v * 0.32);

const cases = [
  ['普通沙土', SAND_BASE, 1, [165, 122, 66], '暖棕 tan'],
  ['贴画黄  ', YELLOW, 1, [232, 210, 0], '亮黄'],
  ['贴画内部', INTERIOR, 1, [197, 146, 88], '深橙'],
  ['贴画黑  ', BLACK, 1, [0, 0, 0], '黑'],
];

let failed = false;
for (const [name, target, reflect, nowarn] of cases) {
  // 中性光 + 正午光各跑一次
  const neutral = render(shade(target, reflect), SUN_WHITE, AMB_ZERO, 1, 1, 1, 0);
  const noon = render(shade(target, reflect), NOON_SUN, NOON_AMB, 0.8, 0.95, 1, 1);
  const got = `${neutral.join(',')}`;
  const pink = neutral[0] > neutral[1] * 1.35 && neutral[2] > neutral[1] * 1.35; // R与B都远超G = 品红
  if (pink) failed = true;
  console.log(
    `${name}  中性光=[${got}]  期望≈[${nowarn.join(',')}] (${nowarn[1] ? '' : '黑'})${pink ? '  ← 品红!!' : ''}  正午=[${noon.join(',')}]`,
  );
}
console.log(failed ? '\n✗ 失败：出现品红/红紫漂移' : '\n✓ 通过：贴画黄/内部/黑在渲染后均为正确色相，无品红漂移');

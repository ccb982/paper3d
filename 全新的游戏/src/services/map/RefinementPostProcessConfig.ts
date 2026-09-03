// ============================================================
// RefinementPostProcessConfig —— 精修层后处理常量（零依赖）
// ============================================================
// 架构文档：《精修层后处理设计.md》（v5，独立双产物替换）
// 定位：后处理层在精修层定型快照之后运行，不依附精修层内部语义，
//       对顶面/侧壁/裁决任意整形，独立生成 渲染版(细) + 物理版(粗自洽)
//       两套替换件装回原快照。
// 本文件只放常量；真正的整形逻辑在 RefinementPostProcess.ts。
// ★ 总开关 = 默认关：不开启后处理时，一切 ≡ 精修层原世界（回归 A）。
// ============================================================

/** ★ 后处理总开关（默认关）。关 = 空后处理 ≡ 原世界，逐位不变。 */
export const POST_PROCESS_ENABLED = true;

/** 圆角圆弧半径（米）：磨掉顶面与崖壁间 90° 外角的 fillet 半径。
 *  用户画图《我要的倒角》（侧面）：高台顶面保持水平(高度不变)、墙壁保持竖直，
 *  只在棱处用一个小圆弧连接（侧看呈弧线；用细分多棱拼成）。
 *  半径需大到可见、但又只在棱带内生效（台面主体不变）。 */
export const BEVEL_R = 0.3;

/** 圆角判棱阈值：相邻两快高差超过此值才算「棱」（米） */
export const BEVEL_EPS = 0.05;

/** 哪些 genRole 的顶面外缘参与圆滑（风化）。仅高台(platform)块圆滑，
 *  且只圆滑「对面是不插值地面(ground,非weld)」的外露硬边；
 *  高台↔高台/水/坑、插值(weld)边一律棱角分明不圆滑。 */
export const BEVEL_TILES: ReadonlySet<string> = new Set(["platform"]);

/** 坑洞：每块撒坑锚的确定性概率（0~1） */
export const PIT_PROB = 0.03;

/** 坑洞：半径范围（米，确定性在区间内取） */
export const PIT_R_MIN = 0.75;
export const PIT_R_MAX = 1.5;

/** 坑洞：深度范围（米，确定性在区间内取） */
export const PIT_D_MIN = 0.25;
export const PIT_D_MAX = 0.5;

/** 裂缝：贯穿 chunk 的确定性折线段数（2~4） */
export const CRACK_SEG_MIN = 2;
export const CRACK_SEG_MAX = 4;

/** 裂缝：半宽范围（米） */
export const CRACK_W_MIN = 0.15;
export const CRACK_W_MAX = 0.4;

/** 裂缝：中心深度范围（米） */
export const CRACK_D_MIN = 0.15;
export const CRACK_D_MAX = 0.3;

/** 渲染版局部细分：fine 区递归细分深度（1/2 递归；depth=3 → 1m 切成 0.125m，
 *  倒角圆弧由多段细分棱拼成、呈平滑弧线） */
export const PP_FINE_SUBDIV_DEPTH = 3;

/** 渲染版/物理版：判定该点需要局部细分的「fine 影响带」半径（米） */
export const PP_FINE_BAND = 0.5;

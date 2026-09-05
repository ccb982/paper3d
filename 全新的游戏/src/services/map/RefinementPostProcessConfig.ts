// ============================================================
// RefinementPostProcessConfig —— 精修层后处理常量（零依赖）
// ============================================================
// ★ 已弃用（2026-09-05）：渲染层坑/裂几何已由表驱动路径取代（无坑裂，
//   FaceBuild 自带 bevel 弧带）；坑/裂只残留于查询侧（surfaceHeightAt）与
//   烘焙高度源。本层随之一并关停（POST_PROCESS_ENABLED=false）：
//     · surfaceHeightAt → 退化为纯精修层视觉面（cornerCell 三角插值）
//     · 烘焙高度源 → 同上（光照不再带坑/裂偏移）
//     · 旧回退渲染（__PP_TABLE_BUILD=false）→ 逐位退化为精修层原输出（回归 A）
//   保留代码与脚本供 A/B 对照，退役拆分见《地形表驱动管线重构设计.md》§12。
// 本文件只放常量；真正的整形逻辑在 RefinementPostProcess.ts。
// ============================================================

/** ★ 后处理总开关 = 关（2026-09-05 弃用：渲染已表驱动，坑/裂几何废弃）。
 *  关 = ppHeight≡0 → 查询/烘焙/旧渲染全部退化为精修层原世界。 */
export const POST_PROCESS_ENABLED = false;

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

/** 渲染版局部细分：fine 区递归细分深度（1/2 递归；depth=3 → 1m 切成 0.125m，
 *  倒角圆弧由多段细分棱拼成、呈平滑弧线） */
export const PP_FINE_SUBDIV_DEPTH = 3;

/** 渲染版/物理版：判定该点需要局部细分的「fine 影响带」半径（米） */
export const PP_FINE_BAND = 0.5;

// ============================================================
// TileMaterials —— 地块材质库（材质是地块的属性，挂在 TileDef 上）
// ============================================================
// 架构（2026-08-27 修正定稿）：
//   TileDef.visual.material = { fnId, params }   ← 地块自挂材质
//     ↓ 渲染（阶段二）
//   块 id 微纹理 → 片元按 id 查材质 → 调该材质的 GLSL 图案/表面函数
//     → 输出：基色图案 + 粗糙度 + 镜面 + 菲涅尔 + 发光 + 动画
//
// 与装饰纹理的分工：
//   材质 = 这块地"是什么"（泥/砖/草/木/冰/水…）
//   装饰纹理（decor/TileDecalBase）= 这块地上"长了什么"（裂隙/石子/污渍）
//   装饰层独立叠加在材质之上，不参与材质定义。
//
// 本文件 = 材质注册表 + 参数模板（声明式）。GLSL 函数本体在阶段二
// （TerrainMaterial 分发改造）实现；同 fnId 不同 params = 变体。
// ============================================================

/** 材质表面属性模板（材质 shader 消费：光照图之上叠加的表面行为） */
export interface TileMaterialSurface {
  /** 粗糙度 0~1（0=镜面，1=全哑光） */
  roughness: number;
  /** 镜面高光强度（0=无；冰/水/湿泥 >0） */
  specular?: number;
  /** 菲涅尔边缘强度（0=无；冰/水的半透明感） */
  fresnel?: number;
  /** 自发光（灰烬余烬/坑洞警示/boss4D 边缘线） */
  emissive?: { r: number; g: number; b: number; strength: number };
  /** 动画（水波/气泡/闪烁；静态材质缺省 false = 零成本） */
  animated?: boolean;
}

/** 材质定义（fnId 即注册表索引；params 为默认参数模板，地块可覆盖） */
export interface TileMaterialDef {
  fnId: string;
  label: string;
  /** 图案参数模板（默认值；地块 visual.material.params 合并覆盖） */
  params: Record<string, number>;
  /** 表面属性（材质 shader 消费） */
  surface: TileMaterialSurface;
  /** LOD 发光强度（0=无；>0=近距离发光，模拟 subsurface/湿面反光） */
  lodEmissive?: number;
}

const REGISTRY = new Map<string, TileMaterialDef>();

/** ★ 扩展点：注册材质（加材质 = 注册一个定义；阶段二同步提供 GLSL 函数） */
export function registerTileMaterial(def: TileMaterialDef): void {
  if (REGISTRY.has(def.fnId)) throw new Error(`[TileMaterials] 材质 fnId 已存在: ${def.fnId}`);
  REGISTRY.set(def.fnId, def);
}

export function tileMaterialByKey(fnId: string): TileMaterialDef | undefined {
  return REGISTRY.get(fnId);
}

export function allTileMaterials(): TileMaterialDef[] {
  return [...REGISTRY.values()];
}

// ============================================================
// 内置材质（先落四个地面 + 平台底座；冰/水/灰烬/坑等后续逐个填）
// ============================================================

/** 纯泥土地面：细颗粒 + 稀疏小石子 + 路辙扫痕；高粗糙无高光 */
registerTileMaterial({
  fnId: 'dirt', label: '纯泥土地面',
  params: {
    grain: 0.03,          // 高频颗粒幅度
    pebbles: 0.12,        // 小石子密度
    ruts: 0.06,           // 路辙扫痕强度
    patch: 0.15,          // 大尺度斑驳
  },
  surface: { roughness: 0.95 },
  lodEmissive: 0,
});

/** 砖石路面：交错砖块网格 + 灰缝 + 每砖明度抖动 + 破损变体 */
registerTileMaterial({
  fnId: 'brick', label: '砖石路面',
  params: {
    groutWidth: 0.06,     // 灰缝线宽（砖宽的占比）
    brickJitter: 0.05,    // 每砖明度抖动
    brickVariant: 0.5,    // 砖色变体（同色系深浅）
    broken: 0.08,         // 破损块比例
  },
  surface: { roughness: 0.72 },
  lodEmissive: 0,
});

/** 草地路面：低饱和绿底 + 成片斑驳 + 草簇 */
registerTileMaterial({
  fnId: 'grass', label: '草地路面',
  params: {
    patch: 0.28,          // 大尺度明暗斑块
    tuft: 0.18,           // 草簇密度
    tuftScale: 0.06,      // 草簇尺度
    grain: 0.02,          // 底颗粒
  },
  surface: { roughness: 0.85 },
  lodEmissive: 0.005,
});

/** 木板路面：横板条 + 板缝错位 + 木纹 + 钉点 */
registerTileMaterial({
  fnId: 'wood', label: '木板路面',
  params: {
    plankWidth: 0.09,     // 板宽（板长占比）
    seamJitter: 0.10,     // 板缝随机错位
    plankJitter: 0.06,    // 每板明度抖动
    grain: 0.10,          // 木纹强度
    nails: 0.15,          // 钉点密度
  },
  surface: { roughness: 0.55, specular: 0.05 },
  lodEmissive: 0.01,
});

/** 岩石平台底座：分层岩理 + 拉丝 + 粗裂纹 */
registerTileMaterial({
  fnId: 'rock', label: '岩石材质',
  params: {
    strata: 0.18,         // 分层岩理
    streak: 0.12,         // 方向拉丝
    cracks: 0.10,         // 粗裂纹
    bump: 0.08,           // 微凹凸
  },
  surface: { roughness: 0.8 },
  lodEmissive: 0,
});

/** 苔藓平台：石底 + 苔藓斑块 + 绒毛边缘 */
registerTileMaterial({
  fnId: 'moss', label: '苔藓材质',
  params: {
    mossCover: 0.6,       // 苔藓覆盖率
    mossEdge: 0.15,       // 边缘绒毛
    drip: 0.1,            // 滴水痕
    stone: 0.6,           // 石底露出比例
  },
  surface: { roughness: 0.75 },
  lodEmissive: 0.025,
});
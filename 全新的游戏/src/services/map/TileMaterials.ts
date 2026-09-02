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
// 内置材质（地面 6 + 平台底座 + 新增水/冰/灰/泥/坑；后续逐个扩）
// ============================================================

/** 纯泥土地面：细颗粒 + 圆形石子（暗核亮边）+ 路辙扫痕；高粗糙无高光 */
registerTileMaterial({
  fnId: 'dirt', label: '纯泥土地面',
  params: {
    grain: 0.035,         // 高频颗粒幅度
    pebbles: 0.10,        // 小石子密度（每 0.5m 格出现概率）
    ruts: 0.10,           // 路辙扫痕强度（各向异性条痕）
    patch: 0.15,          // 大尺度斑驳
  },
  surface: { roughness: 0.95 },
  lodEmissive: 0.02,
});

/** 砖石路面：真实错缝砌法（0.72×0.30m 砖 + 半砖偏移）+ 灰缝 + 每砖抖动 + 破损变体 */
registerTileMaterial({
  fnId: 'brick', label: '砖石路面',
  params: {
    groutWidth: 0.06,     // 灰缝线宽（砖宽的占比）
    brickJitter: 0.05,    // 每砖明度抖动
    brickVariant: 0.5,    // 砖色变体（同色系深浅）
    broken: 0.08,         // 破损块比例
  },
  surface: { roughness: 0.72 },
  lodEmissive: 0.03,
});

/** 草地路面：低饱和绿底 + 成片斑驳 + 枯草斑（色相偏黄）+ 草簇 */
registerTileMaterial({
  fnId: 'grass', label: '草地路面',
  params: {
    patch: 0.28,          // 大尺度明暗斑块
    tuft: 0.18,           // 草簇密度
    tuftScale: 0.06,      // 草簇尺度（驱动网格频率）
    grain: 0.02,          // 底颗粒
  },
  surface: { roughness: 0.85 },
  lodEmissive: 0.015,
});

/** 木板路面：横板条 + 板缝 + 端缝错位 + 方向性木纹 + 钉点 */
registerTileMaterial({
  fnId: 'wood', label: '木板路面',
  params: {
    plankWidth: 0.55,     // 板宽（米）
    seamJitter: 0.10,     // 端缝随机错位幅度
    plankJitter: 0.06,    // 每板明度抖动
    grain: 0.10,          // 木纹强度（沿板方向拉伸）
    nails: 0.15,          // 钉点密度
  },
  surface: { roughness: 0.55, specular: 0.05 },
  lodEmissive: 0.035,
});

/** 岩石平台底座：水平分层岩理 + 拉丝 + ridged 线状裂纹 */
registerTileMaterial({
  fnId: 'rock', label: '岩石材质',
  params: {
    strata: 0.18,         // 分层岩理（带状）
    streak: 0.12,         // 方向拉丝
    cracks: 0.10,         // 裂纹（线状）
    bump: 0.08,           // 微凹凸
  },
  surface: { roughness: 0.8 },
  lodEmissive: 0.04,
});

/** 苔藓平台：多尺度苔斑覆盖 + 绒毛边缘 + 滴水痕 + 石底颗粒 */
registerTileMaterial({
  fnId: 'moss', label: '苔藓材质',
  params: {
    mossCover: 0.6,       // 苔藓覆盖率
    mossEdge: 0.15,       // 边缘破碎带宽度
    drip: 0.1,            // 滴水痕
    stone: 0.6,           // 石底露出比例
  },
  surface: { roughness: 0.75 },
  lodEmissive: 0.05,
});

/** 水面：双层流动波纹（动画）+ 波峰亮线 + 浅水斑 + 阳光闪粼 */
registerTileMaterial({
  fnId: 'water', label: '水面',
  params: {
    wave: 0.50,           // 波纹明暗幅度
    waveFreq: 1.0,        // 波纹频率
    glint: 0.35,          // 阳光闪粼强度
    shallow: 0.40,        // 浅水斑（透底感）
  },
  surface: { roughness: 0.12, specular: 0.40, fresnel: 0.45, animated: true },
});

/** 冰面：ridged 结晶裂纹 + 冰层厚薄 + 霜白斑 + 高频闪晶；低粗糙高镜面菲涅尔 */
registerTileMaterial({
  fnId: 'ice', label: '冰面',
  params: {
    crack: 0.45,          // 结晶裂纹密度
    shimmer: 0.30,        // 闪晶强度
    frost: 0.35,          // 霜白斑
    depth: 0.30,          // 冰层厚薄渐变
  },
  surface: { roughness: 0.18, specular: 0.45, fresnel: 0.55 },
  lodEmissive: 0.02,
});

/** 灰烬地：风积条纹 + 聚堆斑块 + 高频灰粒 + 余烬点（动画呼吸闪烁 + 整面余温辉光） */
registerTileMaterial({
  fnId: 'ash', label: '灰烬地',
  params: {
    grain: 0.05,          // 高频灰粒
    clumps: 0.20,         // 聚堆斑块
    embers: 0.06,         // 余烬点密度
    drift: 0.12,          // 风积条纹
  },
  surface: {
    roughness: 0.92,
    emissive: { r: 1.0, g: 0.42, b: 0.12, strength: 0.10 },  // 余温整面微光
  },
  lodEmissive: 0.03,
});

/** 泥沼地：低频水洼（暗+强反光）+ 干裂纹 + 湿度渐变；湿面微高光 */
registerTileMaterial({
  fnId: 'mud', label: '泥沼地',
  params: {
    puddle: 0.35,         // 水洼阈值（越大越多）
    crack: 0.30,          // 干裂纹
    wet: 0.50,            // 湿度渐变
    grain: 0.04,          // 泥粒
  },
  surface: { roughness: 0.55, specular: 0.18 },
  lodEmissive: 0.02,
});

/** 坑洞：径向渐深 + ridged 裂纹（透警示红光）+ 整面危险微光 */
registerTileMaterial({
  fnId: 'pit', label: '坑洞',
  params: {
    crack: 0.40,          // 裂纹密度
    glow: 0.25,           // 裂纹红光
    depth: 0.50,          // 中心渐深
    grain: 0.03,          // 暗粒
  },
  surface: {
    roughness: 0.90,
    emissive: { r: 0.9, g: 0.16, b: 0.10, strength: 0.12 },  // 警示红微光
  },
  lodEmissive: 0.02,
});

/** 沙土（1-7 写实风主打）：纯色底 + 高频细沙粒 + 极弱低频起伏；无斑点无纹理图案 */
registerTileMaterial({
  fnId: 'sand', label: '沙土',
  params: {
    grain: 0.04,          // 细沙粒幅度（粗糙感来源）
    undulate: 0.08,       // 极弱低频起伏（避免死平）
  },
  surface: { roughness: 0.95 },
  lodEmissive: 0.02,
});
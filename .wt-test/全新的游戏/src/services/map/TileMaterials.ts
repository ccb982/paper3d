// ============================================================
// TileMaterials —— 地块材质库（材质是地块的属性，挂在 TileDef 上）
// ============================================================
// 架构（2026-09-12 两级模型定稿）：
//   ★ 一个材质 = 两级表现（同一材质的两级，不是两个材质）：
//     · 一级 base（底色）——材质的"素色"：
//         粗块直接把底色当纹理用（顶点色，可叠组调色 + 逐 4m 抖动）；
//         细化块也以它作基底。
//     · 二级 detail（细节）——fnId 图案函数 + 参数 + 表面属性：
//         仅细化块绘制，在底色之上"接着画"（砖缝/木纹/草簇/裂纹…）。
//   TileDef.visual.material = { fnId, params }   ← 地块自挂材质（选一级 + 二级）
//   TileDef.visual.baseHsl ?= 地块级底色覆盖      ← 变体皮用（缺省继承材质一级底色）
//
//   LOD 观感 = 同级材质的降级渲染：粗块只画一级，细化画一级+二级。
//
// 统一读取出口 = resolveTileLook(td)：底色解析 + 细节材质/参数合并，
// 粗块 / 细化配置 / 低频烘焙 / 外观烘焙全部走它，保证各链同源。
//
// 与装饰纹理的分工：
//   材质 = 这块地"是什么"（泥/砖/草/木/冰/水…）
//   装饰纹理（decor/TileDecalBase）= 这块地上"长了什么"（裂隙/石子/污渍）
//   装饰层独立叠加在材质之上，不参与材质定义。
//
// 本文件 = 材质注册表 + 参数模板（声明式）。GLSL 函数本体在阶段二
// （TerrainMaterial 分发改造）实现；同 fnId 不同 params = 变体。
// ============================================================

import type { Hsl } from "./TerrainPalette";

/** 材质二级（细节）的表面属性模板（细化 shader 消费：光照图之上叠加的表面行为） */
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

/** 材质二级：细节层（细化块在底色之上继续绘制） */
export interface TileMaterialDetail {
  /** 细节图案参数模板（默认值；地块 visual.material.params 合并覆盖） */
  params: Record<string, number>;
  /** 表面属性（细化 shader 消费） */
  surface: TileMaterialSurface;
  /** LOD 发光强度（0=无；>0=近距离发光，模拟 subsurface/湿面反光） */
  lodEmissive?: number;
}

/** 材质定义（fnId 即注册表索引；一级底色 + 二级细节，同一材质的两级） */
export interface TileMaterialDef {
  fnId: string;
  label: string;
  /**
   * ★ 一级：底色（显示空间 HSL）——材质的"素色"：
   *   粗块顶点色 / 细化基底色 / 烘焙基底 的唯一默认来源；
   *   变体皮可在地块 visual.baseHsl 覆盖（如沙土高台比沙土地面亮）。
   */
  base: Hsl;
  /** ★ 二级：细节（细化块在底色之上的继续绘制） */
  detail: TileMaterialDetail;
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
// ★ 统一读取出口（两级模型）：底色 + 细节材质/参数
// ============================================================

/** 地块两级观感来源的最小结构面（结构类型，避免 Tiles ↔ TileMaterials 循环依赖） */
export interface TileLookSource {
  visual: {
    /** 地块级底色覆盖（变体皮用；缺省继承材质一级底色） */
    baseHsl?: Hsl | null;
    /** 地块自挂细节材质（缺省 = 纯底色地块，如预留位/纯色地面） */
    material?: { fnId: string; params?: Record<string, number> } | null;
  };
}

/** 兜底底色（既无地块覆盖、又无材质时的中性灰；不应出现在正式地块上） */
export const DEFAULT_BASE_HSL: Hsl = { h: 0.55, s: 0.2, l: 0.5 };

export interface ResolvedTileLook {
  /** 一级底色：地块覆盖 → 材质一级 → 兜底灰 */
  baseHsl: Hsl;
  /** 材质定义（同一材质，粗块只取 base、细化取 base + detail） */
  mat?: TileMaterialDef;
  /** 二级细节参数（材质模板 + 地块覆盖合并；按模板声明顺序消费） */
  params: Record<string, number>;
}

/**
 * ★ 两级观感解析（唯一读取出口）：
 *   一级底色供粗块顶点色 / 细化基底 / 烘焙基底；
 *   二级细节（mat.detail + 地块 params）供细化 shader 在底色之上绘制。
 */
export function resolveTileLook(td: TileLookSource): ResolvedTileLook {
  const ref = td.visual.material;
  const mat = ref ? REGISTRY.get(ref.fnId) : undefined;
  const baseHsl = td.visual.baseHsl ?? mat?.base ?? DEFAULT_BASE_HSL;
  const params = mat ? { ...mat.detail.params, ...(ref?.params ?? {}) } : {};
  return { baseHsl, mat, params };
}

// ============================================================
// 内置材质（地面 6 + 平台底座 + 新增水/冰/灰/泥/坑；后续逐个扩）
// ============================================================

/** 纯泥土地面：细颗粒 + 圆形石子（暗核亮边）+ 路辙扫痕；高粗糙无高光 */
registerTileMaterial({
  fnId: 'dirt', label: '纯泥土地面',
  base: { h: 0.0881, s: 0.343, l: 0.400 }, // 明日方舟 1-7 地面 rgb(137,104,67)
  detail: {
    params: {
      grain: 0.035,         // 高频颗粒幅度
      pebbles: 0.10,        // 小石子密度（每 0.5m 格出现概率）
      ruts: 0.10,           // 路辙扫痕强度（各向异性条痕）
      patch: 0.15,          // 大尺度斑驳
    },
    surface: { roughness: 0.95 },
    lodEmissive: 0.02,
  },
});

/** 砖石路面：真实错缝砌法（0.72×0.30m 砖 + 半砖偏移）+ 灰缝 + 每砖抖动 + 破损变体 */
registerTileMaterial({
  fnId: 'brick', label: '砖石路面',
  base: { h: 0.08, s: 0.18, l: 0.42 },
  detail: {
    params: {
      groutWidth: 0.06,     // 灰缝线宽（砖宽的占比）
      brickJitter: 0.05,    // 每砖明度抖动
      brickVariant: 0.5,    // 砖色变体（同色系深浅）
      broken: 0.08,         // 破损块比例
    },
    surface: { roughness: 0.72 },
    lodEmissive: 0.03,
  },
});

/** 草地路面：低饱和绿底 + 成片斑驳 + 枯草斑（色相偏黄）+ 草簇 */
registerTileMaterial({
  fnId: 'grass', label: '草地路面',
  base: { h: 0.3, s: 0.32, l: 0.38 },
  detail: {
    params: {
      patch: 0.28,          // 大尺度明暗斑块
      tuft: 0.18,           // 草簇密度
      tuftScale: 0.06,      // 草簇尺度（驱动网格频率）
      grain: 0.02,          // 底颗粒
    },
    surface: { roughness: 0.85 },
    lodEmissive: 0.015,
  },
});

/** 木板路面：横板条 + 板缝 + 端缝错位 + 方向性木纹 + 钉点 */
registerTileMaterial({
  fnId: 'wood', label: '木板路面',
  base: { h: 0.07, s: 0.35, l: 0.38 },
  detail: {
    params: {
      plankWidth: 0.55,     // 板宽（米）
      seamJitter: 0.10,     // 端缝随机错位幅度
      plankJitter: 0.06,    // 每板明度抖动
      grain: 0.10,          // 木纹强度（沿板方向拉伸）
      nails: 0.15,          // 钉点密度
    },
    surface: { roughness: 0.55, specular: 0.05 },
    lodEmissive: 0.035,
  },
});

/** 岩石平台底座：水平分层岩理 + 拉丝 + ridged 线状裂纹 */
registerTileMaterial({
  fnId: 'rock', label: '岩石材质',
  base: { h: 0.0774, s: 0.356, l: 0.537 }, // 明日方舟 1-7 高台 rgb(179,134,95)
  detail: {
    params: {
      strata: 0.18,         // 分层岩理（带状）
      streak: 0.12,         // 方向拉丝
      cracks: 0.10,         // 裂纹（线状）
      bump: 0.08,           // 微凹凸
    },
    surface: { roughness: 0.8 },
    lodEmissive: 0.04,
  },
});

/** 苔藓平台：多尺度苔斑覆盖 + 绒毛边缘 + 滴水痕 + 石底颗粒 */
registerTileMaterial({
  fnId: 'moss', label: '苔藓材质',
  base: { h: 0.3, s: 0.35, l: 0.4 },
  detail: {
    params: {
      mossCover: 0.6,       // 苔藓覆盖率
      mossEdge: 0.15,       // 边缘破碎带宽度
      drip: 0.1,            // 滴水痕
      stone: 0.6,           // 石底露出比例
    },
    surface: { roughness: 0.75 },
    lodEmissive: 0.05,
  },
});

/** 水面：双层流动波纹（动画）+ 波峰亮线 + 浅水斑 + 阳光闪粼 */
registerTileMaterial({
  fnId: 'water', label: '水面',
  base: { h: 0.55, s: 0.40, l: 0.45 }, // 水体模块启用后生效（当前水地块用 pebble 河床）
  detail: {
    params: {
      wave: 0.50,           // 波纹明暗幅度
      waveFreq: 1.0,        // 波纹频率
      glint: 0.35,          // 阳光闪粼强度
      shallow: 0.40,        // 浅水斑（透底感）
    },
    surface: { roughness: 0.12, specular: 0.40, fresnel: 0.45, animated: true },
  },
});

/** 水底鹅卵石（2026-09-07 v4：水体模块未开工前的静态占位。水地块临时用，
 *  等真实水面实施后再换回 water。小而密、磨圆的扁椭圆卵石紧贴叠瓦，
 *  随机朝向；暖灰棕多矿石色（无蓝无青）；湿润光泽。无动画静态。 */
registerTileMaterial({
  fnId: 'pebble', label: '鹅卵石河床',
  base: { h: 0.12, s: 0.06, l: 0.42 }, // 河床基调（中性灰褐沙砾；多彩卵石色由细节函数逐石调制）
  detail: {
    params: {
      radius: 0.09,         // 卵石尺度（*140 → 格米数；越大石头越大；默认 ~8cm）
      scatter: 0.5,         // 石头中心散布（越小越整齐紧密）
      tone: 0.10,           // 每块石头明暗区分幅度（低）
      grain: 0.03,          // 石面细磨砂
    },
    surface: { roughness: 0.75, specular: 0.25 }, // 湿润反光感（鹅卵石浸水微亮）
    lodEmissive: 0.02,
  },
});

/** 冰面：ridged 结晶裂纹 + 冰层厚薄 + 霜白斑 + 高频闪晶；低粗糙高镜面菲涅尔 */
registerTileMaterial({
  fnId: 'ice', label: '冰面',
  base: { h: 0.55, s: 0.3, l: 0.72 },
  detail: {
    params: {
      crack: 0.45,          // 结晶裂纹密度
      shimmer: 0.30,        // 闪晶强度
      frost: 0.35,          // 霜白斑
      depth: 0.30,          // 冰层厚薄渐变
    },
    surface: { roughness: 0.18, specular: 0.45, fresnel: 0.55 },
    lodEmissive: 0.02,
  },
});

/** 灰烬地：风积条纹 + 聚堆斑块 + 高频灰粒 + 余烬点（动画呼吸闪烁 + 整面余温辉光） */
registerTileMaterial({
  fnId: 'ash', label: '灰烬地',
  base: { h: 0.05, s: 0.06, l: 0.40 },
  detail: {
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
  },
});

/** 泥沼地：低频水洼（暗+强反光）+ 干裂纹 + 湿度渐变；湿面微高光 */
registerTileMaterial({
  fnId: 'mud', label: '泥沼地',
  base: { h: 0.08, s: 0.15, l: 0.36 },
  detail: {
    params: {
      puddle: 0.35,         // 水洼阈值（越大越多）
      crack: 0.30,          // 干裂纹
      wet: 0.50,            // 湿度渐变
      grain: 0.04,          // 泥粒
    },
    surface: { roughness: 0.55, specular: 0.18 },
    lodEmissive: 0.02,
  },
});

/** 坑洞：径向渐深 + ridged 裂纹（透警示红光）+ 整面危险微光 */
registerTileMaterial({
  fnId: 'pit', label: '坑洞',
  base: { h: 0.98, s: 0.30, l: 0.34 }, // 暗红警示（坑洞玩法可读性）
  detail: {
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
  },
});

/** 沙土（1-7 写实风主打）：纯色基调 + 三尺度连续明暗（无图案无格块）+ 色彩呼吸 */
registerTileMaterial({
  fnId: 'sand', label: '沙土',
  base: { h: 0.0881, s: 0.343, l: 0.400 }, // 沙土地面 rgb(137,104,67)（高台变体在地块侧覆盖）
  detail: {
    params: {
      grain: 0.045,   // 细沙粒（像素级磨砂）
      meso: 0.05,     // 中波团块明暗（~0.75/m）
      macro: 0.09,    // 大波大范围明暗（~0.18/m）
      chroma: 1.0,    // 色彩呼吸幅度（暗处饱和偏冷 / 亮处褪色偏暖）
    },
    surface: { roughness: 0.95 },
    lodEmissive: 0.02,
  },
});

/** 水泥（装饰性高台）：平滑哑光灰面 + 少噪点（细颗粒残留，无图案无斑驳）。
 * 2026-09-06 与水泥台座实体同款观感：去掉 LOD 发光层（反光感来源），
 * surface roughness 0.92 + 无 specular → 离线 PBR 般哑光暗沉。 */
registerTileMaterial({
  fnId: 'cement', label: '水泥',
  base: { h: 0.1667, s: 0.023, l: 0.237 }, // 水泥灰（2026-09-06 定版亮 13%）
  detail: {
    params: {
      grain: 0.018,   // 细颗粒（噪点有但不要多）
      meso: 0.03,     // 中波微起伏（远看水泥浇筑面）
      macro: 0.04,    // 大波大范围明暗（很弱）
      chroma: 0.35,   // 色彩呼吸幅度（水泥灰，走色极少）
    },
    surface: { roughness: 0.92 },
    lodEmissive: 0,   // ★ 0：去掉距离呼吸发光，像梯台实体（哑光暗沉）
  },
});

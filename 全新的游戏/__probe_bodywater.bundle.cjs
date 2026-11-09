"use strict";

// src/services/map/TerrainPalette.ts
function hsl2rgb(h, s, l) {
  h = (h % 1 + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255)
  ];
}

// src/services/map/TileMaterials.ts
var REGISTRY = /* @__PURE__ */ new Map();
function registerTileMaterial(def) {
  if (REGISTRY.has(def.fnId)) throw new Error(`[TileMaterials] \u6750\u8D28 fnId \u5DF2\u5B58\u5728: ${def.fnId}`);
  REGISTRY.set(def.fnId, def);
}
var DEFAULT_BASE_HSL = { h: 0.55, s: 0.2, l: 0.5 };
function resolveTileLook(td) {
  const ref = td.visual.material;
  const mat = ref ? REGISTRY.get(ref.fnId) : void 0;
  const baseHsl = td.visual.baseHsl ?? mat?.base ?? DEFAULT_BASE_HSL;
  const params = mat ? { ...mat.detail.params, ...ref?.params ?? {} } : {};
  return { baseHsl, mat, params };
}
registerTileMaterial({
  fnId: "dirt",
  label: "\u7EAF\u6CE5\u571F\u5730\u9762",
  base: { h: 0.0881, s: 0.343, l: 0.4 },
  // 明日方舟 1-7 地面 rgb(137,104,67)
  detail: {
    params: {
      grain: 0.035,
      // 高频颗粒幅度
      pebbles: 0.1,
      // 小石子密度（每 0.5m 格出现概率）
      ruts: 0.1,
      // 路辙扫痕强度（各向异性条痕）
      patch: 0.15
      // 大尺度斑驳
    },
    surface: { roughness: 0.95 },
    lodEmissive: 0.02
  }
});
registerTileMaterial({
  fnId: "brick",
  label: "\u7816\u77F3\u8DEF\u9762",
  base: { h: 0.08, s: 0.18, l: 0.42 },
  detail: {
    params: {
      groutWidth: 0.06,
      // 灰缝线宽（砖宽的占比）
      brickJitter: 0.05,
      // 每砖明度抖动
      brickVariant: 0.5,
      // 砖色变体（同色系深浅）
      broken: 0.08
      // 破损块比例
    },
    surface: { roughness: 0.72 },
    lodEmissive: 0.03
  }
});
registerTileMaterial({
  fnId: "grass",
  label: "\u8349\u5730\u8DEF\u9762",
  base: { h: 0.3, s: 0.32, l: 0.38 },
  detail: {
    params: {
      patch: 0.28,
      // 大尺度明暗斑块
      tuft: 0.18,
      // 草簇密度
      tuftScale: 0.06,
      // 草簇尺度（驱动网格频率）
      grain: 0.02
      // 底颗粒
    },
    surface: { roughness: 0.85 },
    lodEmissive: 0.015
  }
});
registerTileMaterial({
  fnId: "wood",
  label: "\u6728\u677F\u8DEF\u9762",
  base: { h: 0.07, s: 0.35, l: 0.38 },
  detail: {
    params: {
      plankWidth: 0.55,
      // 板宽（米）
      seamJitter: 0.1,
      // 端缝随机错位幅度
      plankJitter: 0.06,
      // 每板明度抖动
      grain: 0.1,
      // 木纹强度（沿板方向拉伸）
      nails: 0.15
      // 钉点密度
    },
    surface: { roughness: 0.55, specular: 0.05 },
    lodEmissive: 0.035
  }
});
registerTileMaterial({
  fnId: "rock",
  label: "\u5CA9\u77F3\u6750\u8D28",
  base: { h: 0.0774, s: 0.356, l: 0.537 },
  // 明日方舟 1-7 高台 rgb(179,134,95)
  detail: {
    params: {
      strata: 0.18,
      // 分层岩理（带状）
      streak: 0.12,
      // 方向拉丝
      cracks: 0.1,
      // 裂纹（线状）
      bump: 0.08
      // 微凹凸
    },
    surface: { roughness: 0.8 },
    lodEmissive: 0.04
  }
});
registerTileMaterial({
  fnId: "moss",
  label: "\u82D4\u85D3\u6750\u8D28",
  base: { h: 0.3, s: 0.35, l: 0.4 },
  detail: {
    params: {
      mossCover: 0.6,
      // 苔藓覆盖率
      mossEdge: 0.15,
      // 边缘破碎带宽度
      drip: 0.1,
      // 滴水痕
      stone: 0.6
      // 石底露出比例
    },
    surface: { roughness: 0.75 },
    lodEmissive: 0.05
  }
});
registerTileMaterial({
  fnId: "water",
  label: "\u6C34\u9762",
  base: { h: 0.55, s: 0.4, l: 0.45 },
  // 水体模块启用后生效（当前水地块用 pebble 河床）
  detail: {
    params: {
      wave: 0.5,
      // 波纹明暗幅度
      waveFreq: 1,
      // 波纹频率
      glint: 0.35,
      // 阳光闪粼强度
      shallow: 0.4
      // 浅水斑（透底感）
    },
    surface: { roughness: 0.12, specular: 0.4, fresnel: 0.45, animated: true }
  }
});
registerTileMaterial({
  fnId: "pebble",
  label: "\u9E45\u5375\u77F3\u6CB3\u5E8A",
  base: { h: 0.12, s: 0.06, l: 0.42 },
  // 河床基调（中性灰褐沙砾；多彩卵石色由细节函数逐石调制）
  detail: {
    params: {
      radius: 0.09,
      // 卵石尺度（*140 → 格米数；越大石头越大；默认 ~8cm）
      scatter: 0.5,
      // 石头中心散布（越小越整齐紧密）
      tone: 0.1,
      // 每块石头明暗区分幅度（低）
      grain: 0.03
      // 石面细磨砂
    },
    surface: { roughness: 0.75, specular: 0.25 },
    // 湿润反光感（鹅卵石浸水微亮）
    lodEmissive: 0.02
  }
});
registerTileMaterial({
  fnId: "ice",
  label: "\u51B0\u9762",
  base: { h: 0.55, s: 0.3, l: 0.72 },
  detail: {
    params: {
      crack: 0.45,
      // 结晶裂纹密度
      shimmer: 0.3,
      // 闪晶强度
      frost: 0.35,
      // 霜白斑
      depth: 0.3
      // 冰层厚薄渐变
    },
    surface: { roughness: 0.18, specular: 0.45, fresnel: 0.55 },
    lodEmissive: 0.02
  }
});
registerTileMaterial({
  fnId: "ash",
  label: "\u7070\u70EC\u5730",
  base: { h: 0.05, s: 0.06, l: 0.4 },
  detail: {
    params: {
      grain: 0.05,
      // 高频灰粒
      clumps: 0.2,
      // 聚堆斑块
      embers: 0.06,
      // 余烬点密度
      drift: 0.12
      // 风积条纹
    },
    surface: {
      roughness: 0.92,
      emissive: { r: 1, g: 0.42, b: 0.12, strength: 0.1 }
      // 余温整面微光
    },
    lodEmissive: 0.03
  }
});
registerTileMaterial({
  fnId: "mud",
  label: "\u6CE5\u6CBC\u5730",
  base: { h: 0.08, s: 0.15, l: 0.36 },
  detail: {
    params: {
      puddle: 0.35,
      // 水洼阈值（越大越多）
      crack: 0.3,
      // 干裂纹
      wet: 0.5,
      // 湿度渐变
      grain: 0.04
      // 泥粒
    },
    surface: { roughness: 0.55, specular: 0.18 },
    lodEmissive: 0.02
  }
});
registerTileMaterial({
  fnId: "pit",
  label: "\u5751\u6D1E",
  base: { h: 0.98, s: 0.3, l: 0.34 },
  // 暗红警示（坑洞玩法可读性）
  detail: {
    params: {
      crack: 0.4,
      // 裂纹密度
      glow: 0.25,
      // 裂纹红光
      depth: 0.5,
      // 中心渐深
      grain: 0.03
      // 暗粒
    },
    surface: {
      roughness: 0.9,
      emissive: { r: 0.9, g: 0.16, b: 0.1, strength: 0.12 }
      // 警示红微光
    },
    lodEmissive: 0.02
  }
});
registerTileMaterial({
  fnId: "sand",
  label: "\u6C99\u571F",
  base: { h: 0.0881, s: 0.343, l: 0.4 },
  // 沙土地面 rgb(137,104,67)（高台变体在地块侧覆盖）
  detail: {
    params: {
      grain: 0.045,
      // 细沙粒（像素级磨砂）
      meso: 0.05,
      // 中波团块明暗（~0.75/m）
      macro: 0.09,
      // 大波大范围明暗（~0.18/m）
      chroma: 1
      // 色彩呼吸幅度（暗处饱和偏冷 / 亮处褪色偏暖）
    },
    surface: { roughness: 0.95 },
    lodEmissive: 0.02
  }
});
registerTileMaterial({
  fnId: "cement",
  label: "\u6C34\u6CE5",
  base: { h: 0.1667, s: 0.023, l: 0.237 },
  // 水泥灰（2026-09-06 定版亮 13%）
  detail: {
    params: {
      grain: 0.018,
      // 细颗粒（噪点有但不要多）
      meso: 0.03,
      // 中波微起伏（远看水泥浇筑面）
      macro: 0.04,
      // 大波大范围明暗（很弱）
      chroma: 0.35
      // 色彩呼吸幅度（水泥灰，走色极少）
    },
    surface: { roughness: 0.92 },
    lodEmissive: 0
    // ★ 0：去掉距离呼吸发光，像梯台实体（哑光暗沉）
  }
});

// src/services/map/Tiles.ts
var TileDef = class {
  constructor(id, key, label, genRole, visual, physics, groups = []) {
    this.id = id;
    this.key = key;
    this.label = label;
    this.genRole = genRole;
    this.visual = visual;
    this.physics = physics;
    this.groups = groups;
  }
  get isDepression() {
    return this.visual.depression;
  }
  /** ★ 缓存槽（见 baseRgb 说明；地块注册后 visual 不再变，缓存永久有效） */
  _baseRgb = null;
  _packedRgb = -1;
  /**
   * 基准色 RGB（显示空间；小地图等直接消费）——两级解析后的 Tier-1 底色
   *
   * ★ 性能（2026-09-15）：本 getter 是**逐像素热路径**的叶子——小地图跨格重绘每帧
   *   25,600 次、大地图整屏可达 6.9 万次。原实现每次都要跑 resolveTileLook
   *   （内含 `{...params}` 对象展开分配）+ hsl2rgb（内含闭包 + 数组分配），
   *   实测单次上百 ns → 单次整幅重绘 5~10ms。
   *   而 resolveTileLook 只读 `visual.material`（静态引用）/ `visual.baseHsl`（静态字段）
   *   / 静态材质注册表 → 结果对同一 TileDef **恒定**，故惰性算一次即可。
   */
  get baseRgb() {
    const c = this._baseRgb;
    if (c) return c;
    const b = resolveTileLook(this).baseHsl;
    return this._baseRgb = hsl2rgb(b.h, b.s, b.l);
  }
  /** 基准色打包 0xRRGGBB（地图逐像素写图用；避免每像素解构数组） */
  get packedRgb() {
    if (this._packedRgb < 0) {
      const [r, g, b] = this.baseRgb;
      this._packedRgb = r << 16 | g << 8 | b;
    }
    return this._packedRgb;
  }
};
var TILE_FLAT = new TileDef(
  0,
  "flat",
  "\u5E73\u5730/\u8DEF",
  "ground",
  {
    // 底色继承 dirt 材质（rgb(137,104,67)）
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: false,
    // ★ 1-7 写实风：无 4×4 黑框（去方块拼贴感）
    material: {
      fnId: "dirt",
      // ★ 1-7 写实风：纯色为主——斑块/石子/扫痕弱化，保留高频颗粒的粗糙感
      params: { grain: 0.045, pebbles: 0.05, ruts: 0.04, patch: 0.07 }
    }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["foundation"]
);
var TILE_PLATFORM = new TileDef(
  1,
  "platform",
  "\u9AD8\u53F0",
  "platform",
  {
    // 底色继承 rock 材质（rgb(179,134,95)）
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: false,
    // ★ 1-7 写实风：无 4×4 黑框（去方块拼贴感）
    streaks: true,
    // 拉丝金属
    material: {
      fnId: "rock",
      // ★ 1-7 写实风：纯色为主——岩理/拉丝/裂纹弱化，保留微凹凸颗粒的粗糙感
      params: { strata: 0.06, streak: 0.05, cracks: 0.05, bump: 0.12 }
    }
  },
  {
    height: 1.8,
    heightJitterRange: 0.4,
    walkable: true
  },
  ["foundation"]
);
var TILE_PIT = new TileDef(
  2,
  "pit",
  "\u5751\u6D1E",
  "pit",
  {
    // 底色继承 pit 材质（暗红警示；2026-09-05 抬 l 记录见材质表）
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: true,
    patches: true,
    patchHalf: true,
    // 警示色保持醒目
    borderLine: true,
    material: { fnId: "pit" }
    // ★ 坑洞材质（径向渐深 + 裂纹红光）
  },
  {
    height: -3,
    walkable: false,
    lethal: true
  },
  ["foundation"]
);
var TILE_WATER = new TileDef(
  4,
  "water",
  "\u6C34\u57DF",
  "liquid",
  {
    // 底色继承 pebble 材质（河床基调；多彩卵石色由细节函数逐石调制）
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // 河床逐地块轻微色偏（鹅卵石底，非液态均质）
    depression: true,
    patches: false,
    // 河床无色阶斑块（自有鹅卵石纹理）
    borderLine: false,
    // 水底无内描边
    material: { fnId: "pebble" }
    // ★ 水底鹅卵石河床（2026-09-07：水体模块未开工，临时静态占位；开工后换回真实水面）
  },
  {
    // ★ 水底高程（2026-09-14 加深：-0.5 → -1.5）——水面恒 y=0，
    //   水深 = -height（此值）→ 湖盆/孤岛观感更深，且仍 << WATER_MAX_DEEP(6)
    height: -1.5,
    walkable: false,
    smoothDirs: [0, 1, 2, 3]
    // 水全向插值
  },
  ["foundation"]
);
var TILE_SLOPE = new TileDef(
  3,
  "slope",
  "\u5761\u9053\uFF08\u9884\u7559\uFF09",
  "ground",
  {
    // ★ 预留位无材质 → 必须显式底色（否则走兜底灰）；数值 = dirt 材质底色
    baseHsl: { h: 0.0881, s: 0.343, l: 0.4 },
    jitter: TILE_FLAT.visual.jitter,
    depression: false
  },
  { height: 0, walkable: true }
);
var TILE_ICE = new TileDef(
  10,
  "ice",
  "\u51B0\u9762",
  "ground",
  {
    // 底色继承 ice 材质
    jitter: { h: 6e-3, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
    material: { fnId: "ice" }
    // ★ 冰面材质（结晶裂纹 + 闪晶 + 高镜面）
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["crystal"]
);
var TILE_ASH_FIELD = new TileDef(
  11,
  "ash_field",
  "\u7070\u70EC\u5730",
  "ground",
  {
    // 底色继承 ash 材质（灰烬地；2026-09-05 抬 l 记录见材质表）
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "ash" }
    // ★ 灰烬材质（风积纹 + 余烬呼吸闪烁）
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["ashen"]
);
var TILE_MUD = new TileDef(
  12,
  "mud",
  "\u6CE5\u6CBC\u5730",
  "ground",
  {
    // 底色继承 mud 材质（暗灰棕）
    jitter: { h: 6e-3, s: 0.03, l: 0.04 },
    depression: false,
    borderLine: true,
    material: { fnId: "mud" }
    // ★ 泥沼材质（水洼 + 干裂纹 + 湿面高光）
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["ashen", "overgrown"]
);
var TILE_ROCK_PLATFORM = new TileDef(
  13,
  "rock_platform",
  "\u5CA9\u53F0",
  "platform",
  {
    baseHsl: { h: 0.08, s: 0.12, l: 0.42 },
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: "rock", params: { strata: 0.06, streak: 0.06, cracks: 0.08 } }
    // ★ 岩台（2026-09-07 收敛：原 strata 0.24/streak 0.12/cracks 0.14 的水平阴影条纹带过重，对齐被保留的基础岩台舒适度）
  },
  {
    height: 1.8,
    heightJitterRange: 0.4,
    walkable: true
  },
  ["ashen"]
);
var TILE_ICE_PLATFORM = new TileDef(
  14,
  "ice_platform",
  "\u51B0\u53F0",
  "platform",
  {
    baseHsl: { h: 0.55, s: 0.22, l: 0.66 },
    jitter: { h: 6e-3, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: "ice", params: { crack: 0.6, frost: 0.2 } }
    // ★ 冰台（裂纹更密、霜更少）
  },
  { height: 1.8, heightJitterRange: 0.4, walkable: true },
  ["crystal"]
);
var TILE_MOSSY_PLATFORM = new TileDef(
  15,
  "mossy_platform",
  "\u82D4\u53F0",
  "platform",
  {
    // 底色继承 moss 材质
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: "moss" }
    // ★ 苔藓材质
  },
  {
    height: 1.8,
    heightJitterRange: 0.4,
    walkable: true
  },
  ["overgrown"]
);
var TILE_BRICK = new TileDef(
  16,
  "brick",
  "\u7816\u77F3\u8DEF",
  "ground",
  {
    // 底色继承 brick 材质
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "brick" }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["ashen"]
);
var TILE_GRASS = new TileDef(
  17,
  "grass",
  "\u8349\u5730",
  "ground",
  {
    // 底色继承 grass 材质
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "grass" }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["overgrown"]
);
var TILE_WOOD = new TileDef(
  18,
  "wood",
  "\u6728\u677F\u8DEF",
  "ground",
  {
    // 底色继承 wood 材质
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "wood" }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["overgrown"]
);
var TILE_FLAT_SAND = new TileDef(
  19,
  "flat_sand",
  "\u6C99\u571F\u5730\u9762",
  "ground",
  {
    // 底色继承 sand 材质（rgb(137,104,67)）
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // ★ 逐地块轻微 HSL 色偏（4m 地块粒度）
    depression: false,
    borderLine: true,
    // ★ 地块交界黑线（0.85 强度；强化逐地块色差层次）
    material: {
      fnId: "sand",
      // ★ 条带装饰 = 沙土地块专属（斑马线式琥珀虚线段，20% 地块出现；shader slot15 门控）
      params: { stripes: 0.55, hazard: 0.85 }
      // ★ 警示贴画 = 沙土地块专属（黑黄 45° 警示方框贴画，~20% 地块出现；shader slot14 门控）
    }
    // 沙土材质（细沙粒 + 微起伏）+ 条带装饰 + 警示贴画
  },
  TILE_FLAT.physics,
  ["foundation"]
);
var TILE_PLATFORM_SAND = new TileDef(
  20,
  "platform_sand",
  "\u6C99\u571F\u9AD8\u53F0",
  "platform",
  {
    baseHsl: { h: 0.0774, s: 0.356, l: 0.537 },
    // rgb(179,134,95)
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // ★ 逐地块轻微 HSL 色偏（4m 地块粒度）
    depression: false,
    borderLine: true,
    // ★ 地块交界黑线（0.85 强度；强化逐地块色差层次）
    material: { fnId: "sand" }
    // 沙土材质（与地面同质感）
  },
  TILE_PLATFORM.physics,
  ["foundation"]
);
var TILE_CEMENT_PLATFORM = new TileDef(
  21,
  "cement_platform",
  "\u6C34\u6CE5\u9AD8\u53F0",
  "platform",
  {
    // 背景色（2026-09-06）：水泥灰，当前再增亮 13%（用户定版）
    // 原 0x6f6f6a → sRGB(111,111,106) → HSL(h≈0.1667, s≈0.023, l≈0.4255)
    // 减半 → l 0.21 → 增亮 13% → l ≈ 0.237
    baseHsl: { h: 0.1667, s: 0.023, l: 0.237 },
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // ★ 逐地块轻微 HSL 色偏（4m 地块粒度）
    depression: false,
    borderLine: true,
    // ★ 地块交界黑线（0.85 强度；强化逐地块色差层次）
    material: { fnId: "cement" }
    // ★ 水泥材质（平滑灰面 + 少噪点）
  },
  TILE_PLATFORM.physics,
  ["foundation"]
);
var TILE_CAVE_FLOOR = new TileDef(
  22,
  "cave_floor",
  "\u6D1E\u7A74\u5730\u9762",
  "ground",
  {
    // 岩灰岩底（2026-09-14 调亮：0.16 → 0.30——洞内太暗看不清材质）
    baseHsl: { h: 0.09, s: 0.08, l: 0.3 },
    jitter: { h: 6e-3, s: 0.02, l: 0.03 },
    depression: false,
    borderLine: true,
    material: { fnId: "rock", params: { strata: 0.05, streak: 0.04, cracks: 0.1 } }
  },
  TILE_FLAT.physics,
  []
);
var TILE_CAVE_PLATFORM = new TileDef(
  23,
  "cave_platform",
  "\u6D1E\u7A74\u5CA9\u58C1",
  "platform",
  {
    // ★ 2026-09-14 调亮：0.24 → 0.38（洞内墙面别发黑）
    baseHsl: { h: 0.09, s: 0.09, l: 0.38 },
    jitter: { h: 6e-3, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: "rock", params: { strata: 0.06, streak: 0.05, cracks: 0.08 } }
  },
  TILE_PLATFORM.physics,
  []
);
var REGISTRY2 = /* @__PURE__ */ new Map();
var KEY_INDEX = /* @__PURE__ */ new Map();
for (const t of [
  TILE_FLAT,
  TILE_PLATFORM,
  TILE_PIT,
  TILE_SLOPE,
  TILE_WATER,
  TILE_ICE,
  TILE_ASH_FIELD,
  TILE_MUD,
  TILE_ROCK_PLATFORM,
  TILE_ICE_PLATFORM,
  TILE_MOSSY_PLATFORM,
  TILE_BRICK,
  TILE_GRASS,
  TILE_WOOD,
  TILE_FLAT_SAND,
  TILE_PLATFORM_SAND,
  TILE_CEMENT_PLATFORM,
  TILE_CAVE_FLOOR,
  TILE_CAVE_PLATFORM
]) {
  if (REGISTRY2.has(t.id)) throw new Error(`[Tiles] \u5730\u5757 id \u51B2\u7A81: ${t.id}`);
  REGISTRY2.set(t.id, t);
  KEY_INDEX.set(t.key, t);
}

// src/services/map/TerrainNoise.ts
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041) | 0;
  h = h ^ h >>> 13 | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ h >>> 16) >>> 0;
  return h / 4294967296;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash2(a, b, seed);
  const top = h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx;
  const bot = h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

// src/services/map/TileGroups.ts
var REGISTRY3 = /* @__PURE__ */ new Map();
function registerGroup(def) {
  if (REGISTRY3.has(def.key)) throw new Error(`[TileGroups] \u7EC4 key \u5DF2\u5B58\u5728: ${def.key}`);
  REGISTRY3.set(def.key, def);
}
var NEUTRAL_PALETTE = { hueShift: 0, satMul: 1, lightMul: 1 };
var NEUTRAL_GEN = { densityBias: 0, waterMul: 1, pitMul: 1 };
registerGroup({
  key: "foundation",
  label: "\u57FA\u77F3",
  // ★ 2026-09-05 转正：用户定调"1-7 沙土风才是精心制作的主力内容"——
  //   基石组参与正式选组（权重 1，与主题组均等，中性调色保持原味）；
  //   兼职不变：生效组缺角色时仍走本组回退。
  weight: 1,
  members: { flat_sand: 1, platform_sand: 1, cement_platform: 0.2, water: 1, pit: 1 },
  palette: NEUTRAL_PALETTE,
  gen: NEUTRAL_GEN
});
registerGroup({
  key: "crystal",
  label: "\u971C\u84DD\u7ED3\u6676",
  weight: 1,
  members: { ice: 3, ice_platform: 3, water: 1, pit: 1 },
  palette: { hueShift: 0.47, satMul: 0.85, lightMul: 1.02 },
  gen: { densityBias: 0.1, waterMul: 1.7, pitMul: 0.6 }
});
registerGroup({
  key: "ashen",
  label: "\u7070\u70EC\u5E9F\u571F",
  weight: 1,
  members: { ash_field: 3, mud: 1, rock_platform: 3, pit: 2, water: 0.5, brick: 2 },
  palette: { hueShift: 0, satMul: 0.45, lightMul: 0.82 },
  gen: { densityBias: -0.06, waterMul: 0.6, pitMul: 1.2 }
});
registerGroup({
  key: "overgrown",
  label: "\u6C83\u7EFF\u8513\u751F",
  weight: 1,
  members: { mud: 2, mossy_platform: 3, water: 2, pit: 0.5, grass: 2, wood: 2 },
  palette: { hueShift: 0.33, satMul: 1.05, lightMul: 0.98 },
  gen: { densityBias: 0, waterMul: 1.4, pitMul: 0.7 }
});

// src/services/map/TerrainPresets.ts
var SIDE = 15;
var N = SIDE * SIDE;
var ROLE_PATH = 0;
var ROLE_WALL = 1;
var ROLE_LIQUID = 2;
var ROLE_PIT = 3;
var REGISTRY4 = /* @__PURE__ */ new Map();
var ORDER = [];
function registerPreset(def) {
  if (REGISTRY4.has(def.key)) throw new Error(`[TerrainPresets] \u9884\u8BBE key \u5DF2\u5B58\u5728: ${def.key}`);
  REGISTRY4.set(def.key, def);
  ORDER.push(def.key);
}
var _nbrBuf = [];
function gridNeighbors(idx) {
  const r = Math.floor(idx / SIDE);
  const c = idx % SIDE;
  _nbrBuf.length = 0;
  if (r > 0) _nbrBuf.push(idx - SIDE);
  if (r < SIDE - 1) _nbrBuf.push(idx + SIDE);
  if (c > 0) _nbrBuf.push(idx - 1);
  if (c < SIDE - 1) _nbrBuf.push(idx + 1);
  return _nbrBuf;
}
function portCells(ports) {
  const out = [];
  for (const c of ports.top) out.push(c);
  for (const c of ports.bottom) out.push((SIDE - 1) * SIDE + c);
  for (const r of ports.left) out.push(r * SIDE);
  for (const r of ports.right) out.push(r * SIDE + (SIDE - 1));
  return [...new Set(out)];
}
function portCellsPerSide(ports) {
  return [
    ports.top.map((c) => c),
    ports.bottom.map((c) => (SIDE - 1) * SIDE + c),
    ports.left.map((r) => r * SIDE),
    ports.right.map((r) => r * SIDE + (SIDE - 1))
  ];
}
function portNearSet(ports) {
  const s = /* @__PURE__ */ new Set();
  for (const p of portCells(ports)) {
    s.add(p);
    for (const nb of gridNeighbors(p)) s.add(nb);
  }
  return s;
}
function openPorts(roles, ports) {
  const carve = (cells, inward) => {
    for (const p of cells) {
      roles[p] = ROLE_PATH;
      let cur = p;
      for (let k = 0; k < 2; k++) {
        const nb = cur + inward;
        if (nb < 0 || nb >= N) break;
        if (inward === 1 && nb % SIDE === 0) break;
        if (inward === -1 && nb % SIDE === SIDE - 1) break;
        roles[nb] = ROLE_PATH;
        cur = nb;
      }
    }
  };
  const [top, bottom, left, right] = portCellsPerSide(ports);
  carve(top, SIDE);
  carve(bottom, -SIDE);
  carve(left, 1);
  carve(right, -1);
}
function shuffled(arr, salt) {
  const out = arr.slice();
  let s = salt | 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s + 1) % 1e6;
    const j = Math.floor(hash2(s, 0, salt * 7 + 13) * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
function paintCluster(roles, seedCell, size, role, exclude, salt) {
  const painted = [];
  const visited = /* @__PURE__ */ new Set([seedCell]);
  const frontier = [seedCell];
  let s = salt | 0;
  while (frontier.length > 0 && painted.length < size) {
    s = (s + 1) % 1e6;
    const fi = Math.floor(hash2(s, 3, salt + 29) * frontier.length);
    const cur = frontier[fi];
    frontier[fi] = frontier[frontier.length - 1];
    frontier.pop();
    if (exclude.has(cur)) continue;
    roles[cur] = role;
    painted.push(cur);
    for (const nb of gridNeighbors(cur)) {
      if (!visited.has(nb) && !exclude.has(nb)) {
        visited.add(nb);
        frontier.push(nb);
      }
    }
  }
  return painted.length;
}
function pickStart(_roles, allow, salt) {
  const all = [];
  for (let i = 0; i < N; i++) if (allow(i)) all.push(i);
  if (all.length === 0) return -1;
  return shuffled(all, salt)[0];
}
function hazards(gen) {
  const wm = gen?.waterMul ?? 1;
  const pm = gen?.pitMul ?? 1;
  return { water: wm, pit: pm };
}
registerPreset({
  key: "lake",
  label: "\u6E56\u76C6",
  weight: 1.7,
  // 常规变体
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const { water } = hazards(ctx.gen);
    const ccx = 4 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 2) * 7);
    const ccz = 4 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 3) * 7);
    const rBase = 3.2 + hash2(ctx.cx + 1, ctx.cz + 1, ctx.salt + 4) * 2.6 * Math.min(1.6, water);
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        const dx = x - ccx, dz = z - ccz;
        const d = Math.sqrt(dx * dx + dz * dz);
        const wob = (vnoise(x * 0.35, z * 0.35, ctx.salt + 5) - 0.5) * 1.8;
        if (d + wob < rBase) roles[i] = ROLE_LIQUID;
      }
    }
    const islands = hash2(ccx, ccz, ctx.salt + 6) < 0.45 ? 1 + Math.floor(hash2(ccx, ccz, ctx.salt + 8) * 2) : 0;
    for (let k = 0; k < islands; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_LIQUID, ctx.salt + 701 + k);
      if (s < 0) break;
      paintCluster(roles, s, 2 + Math.floor(hash2(k, 5, ctx.salt + 9) * 3), ROLE_WALL, near, ctx.salt + 801 + k);
    }
    openPorts(roles, ctx.ports);
    return roles;
  }
});
registerPreset({
  key: "ruins",
  label: "\u9057\u8FF9",
  weight: 1.6,
  // 常规变体
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const cell = 4 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 21) * 2);
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        const onGrid = x % cell === 0 || z % cell === 0;
        if (onGrid) roles[i] = ROLE_WALL;
      }
    }
    for (let a = 0; a < SIDE; a += cell) {
      for (let k = 0; k < 6; k++) {
        const g = Math.floor(hash2(a, k, ctx.salt + 22) * SIDE);
        const g2 = (g + 1) % SIDE;
        for (const gg of [g, g2]) {
          const iH = a * SIDE + gg;
          const iV = gg * SIDE + a;
          if (!near.has(iH)) roles[iH] = ROLE_PATH;
          if (!near.has(iV)) roles[iV] = ROLE_PATH;
        }
      }
    }
    const { water, pit } = hazards(ctx.gen);
    for (let k = 0; k < Math.floor(2 * water); k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 901 + k);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_LIQUID, near, ctx.salt + 911 + k);
    }
    for (let k = 0; k < Math.floor(2 * pit); k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 921 + k);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_PIT, near, ctx.salt + 931 + k);
    }
    openPorts(roles, ctx.ports);
    return roles;
  }
});
registerPreset({
  key: "pitfield",
  label: "\u5751\u539F",
  weight: 1.1,
  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    const { pit } = hazards(ctx.gen);
    const clusters = Math.floor((4 + hash2(ctx.cx, ctx.cz, ctx.salt + 23) * 4) * pit);
    for (let k = 0; k < clusters; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 941 + k);
      if (s < 0) break;
      paintCluster(roles, s, 2 + Math.floor(hash2(k, 11, ctx.salt + 24) * 5), ROLE_PIT, near, ctx.salt + 951 + k);
    }
    for (let k = 0; k < 6; k++) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 961 + k);
      if (s < 0) break;
      paintCluster(roles, s, 3 + Math.floor(hash2(k, 12, ctx.salt + 25) * 3), ROLE_WALL, near, ctx.salt + 971 + k);
    }
    openPorts(roles, ctx.ports);
    return roles;
  }
});
registerPreset({
  key: "corridor",
  label: "\u5CE1\u9053",
  weight: 1.1,
  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    const near = portNearSet(ctx.ports);
    roles.fill(ROLE_WALL);
    const lanes = 2 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 30) * 2);
    for (let k = 0; k < lanes; k++) {
      let pos = 2 + Math.floor(hash2(k, 14, ctx.salt + 31) * (SIDE - 4));
      const width = 2 + Math.floor(hash2(k, 15, ctx.salt + 32) * 2);
      for (let x = 0; x < SIDE; x++) {
        if (hash2(x, k, ctx.salt + 33) < 0.25) pos += hash2(x, k, ctx.salt + 34) < 0.5 ? -1 : 1;
        pos = Math.min(SIDE - width - 1, Math.max(1, pos));
        for (let d = 0; d < width; d++) {
          const i = (pos + d) * SIDE + x;
          roles[i] = ROLE_PATH;
        }
      }
    }
    const { water, pit } = hazards(ctx.gen);
    if (water > 1.2) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 981);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_LIQUID, near, ctx.salt + 991);
    }
    if (pit > 1.2) {
      const s = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 992);
      if (s >= 0) paintCluster(roles, s, 2, ROLE_PIT, near, ctx.salt + 993);
    }
    openPorts(roles, ctx.ports);
    return roles;
  }
});
registerPreset({
  key: "highland",
  label: "\u9AD8\u539F",
  weight: 2.2,
  // 常规地貌（体量大，承担"平原替身"）
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(NaN);
    const SHELF = 6;
    const H = 9 + hash2(ctx.cx, ctx.cz, ctx.salt + 71) * 2;
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        const edge = Math.min(x, z, SIDE - 1 - x, SIDE - 1 - z);
        if (edge < 1) {
          roles[i] = ROLE_PATH;
          heights[i] = Math.round((SHELF + (vnoise(x * 0.3, z * 0.3, ctx.salt + 74) - 0.5) * 0.4) * 4) / 4;
          continue;
        }
        const wob = (vnoise(x * 0.3, z * 0.3, ctx.salt + 72) - 0.5) * 0.8;
        heights[i] = Math.round((H + wob) * 4) / 4;
        const soil = vnoise(x * 0.22, z * 0.22, ctx.salt + 73) > 0.62;
        roles[i] = soil ? ROLE_PATH : ROLE_WALL;
      }
    }
    const ramp = (p0, inward) => {
      let cur = p0;
      let h = SHELF;
      for (let k = 1; k <= 12; k++) {
        const nb = cur + inward;
        if (nb < 0 || nb >= N) break;
        if (inward === SIDE && Math.floor(nb / SIDE) > SIDE - 1) break;
        if (inward === -SIDE && Math.floor(nb / SIDE) < 0) break;
        if (inward === 1 && nb % SIDE === 0) break;
        if (inward === -1 && nb % SIDE === SIDE - 1) break;
        roles[nb] = ROLE_PATH;
        if (k <= 2) {
          heights[nb] = SHELF;
        } else {
          h = Math.min(H, SHELF + (k - 2) * 0.75);
          heights[nb] = Math.round(h * 4) / 4;
        }
        cur = nb;
        if (h >= H) break;
      }
    };
    for (const c of ctx.ports.top) ramp(c, SIDE);
    for (const c of ctx.ports.bottom) ramp((SIDE - 1) * SIDE + c, -SIDE);
    for (const r of ctx.ports.left) ramp(r * SIDE, 1);
    for (const r of ctx.ports.right) ramp(r * SIDE + (SIDE - 1), -1);
    for (let k = 0; k < 4; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_WALL && heights[i] > SHELF + 2, ctx.salt + 741 + k);
      if (s0 < 0) break;
      heights[s0] = Math.round((heights[s0] + 1.2) * 4) / 4;
    }
    openPorts(roles, ctx.ports);
    return { roles, heights, overridePorts: true };
  }
});
registerPreset({
  key: "field325",
  label: "325",
  weight: 0,
  // 不参与区域抽取：独立稀疏规则投放（≈2%，互不靠近）
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(0);
    const PLAT = 2.5;
    for (let z = 3; z <= 11; z++) {
      for (let x = 1; x <= 13; x++) {
        const i = z * SIDE + x;
        roles[i] = ROLE_PATH;
        heights[i] = PLAT;
      }
    }
    const rampH = [0.9, 1.7, PLAT];
    for (let k = 0; k < 3; k++) {
      const i = (12 - k) * SIDE + 4;
      roles[i] = ROLE_PATH;
      heights[i] = Math.round(rampH[k] * 4) / 4;
    }
    openPorts(roles, ctx.ports);
    const G3 = [7, 1, 3, 1, 7];
    const G2 = [7, 1, 7, 4, 7];
    const G5 = [7, 4, 7, 1, 7];
    const glyph = (g, ox, oz = 5) => {
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r] >> 2 - c & 1) {
            const i = (oz + r) * SIDE + (ox + c);
            roles[i] = ROLE_WALL;
            heights[i] = PLAT + 0.6;
          }
        }
      }
    };
    glyph(G3, 2);
    glyph(G2, 6);
    glyph(G5, 10);
    return {
      roles,
      heights,
      materials: { ground: "flat_sand", platform: "cement_platform" },
      noGroundPatch: true
    };
  }
});
registerPreset({
  key: "peak",
  label: "\u5C71\u5CF0",
  weight: 1.5,
  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(NaN);
    const near = portNearSet(ctx.ports);
    const cx0 = 4 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 41) * 7);
    const cz0 = 4 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 42) * 7);
    const R = 6 + hash2(ctx.cx + 1, ctx.cz, ctx.salt + 43) * 3;
    const H = 12 + hash2(ctx.cx, ctx.cz + 1, ctx.salt + 44) * 8;
    const peaks = [{ x: cx0, z: cz0, r: R, h: H }];
    if (hash2(ctx.cx, ctx.cz, ctx.salt + 45) < 0.6) {
      peaks.push({
        x: 2 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 46) * 11),
        z: 2 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 47) * 11),
        r: 3.5 + hash2(ctx.cx, ctx.cz, ctx.salt + 48) * 2.5,
        h: H * 0.6
      });
    }
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        let h = 0;
        for (const p of peaks) {
          const dx = x - p.x, dz = z - p.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          const wob = (vnoise(x * 0.45, z * 0.45, ctx.salt + 49) - 0.5) * 1.6;
          const t = 1 - (d + wob) / p.r;
          if (t > 0) h = Math.max(h, p.h * Math.pow(t, 1.5));
        }
        if (h <= 0.05) continue;
        heights[i] = Math.round(h * 4) / 4;
        if (h > 1.2) roles[i] = ROLE_WALL;
      }
    }
    for (let k = 0; k < 5; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i) && !Number.isFinite(heights[i]), ctx.salt + 451 + k);
      if (s0 < 0) break;
      roles[s0] = ROLE_WALL;
      heights[s0] = 0.8;
    }
    openPorts(roles, ctx.ports);
    for (const p of portCells(ctx.ports)) heights[p] = NaN;
    return { roles, heights };
  }
});
registerPreset({
  key: "canyon",
  label: "\u5927\u5CE1\u8C37",
  weight: 1.4,
  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(NaN);
    const near = portNearSet(ctx.ports);
    const plateauH = 2.2;
    roles.fill(ROLE_WALL);
    for (let i = 0; i < N; i++) heights[i] = plateauH;
    const horiz = hash2(ctx.cx, ctx.cz, ctx.salt + 52) < 0.5;
    const halfW = 1 + (hash2(ctx.cx, ctx.cz, ctx.salt + 53) < 0.5 ? 1 : 0);
    const stepH = 0.72;
    const banks = 7;
    const floorH = plateauH - banks * stepH;
    const loPos = halfW + banks + 1;
    const hiPos = SIDE - 1 - (halfW + 1);
    let pos = loPos + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 54) * Math.max(1, hiPos - loPos + 1));
    const span = halfW * 2 + banks + 1;
    for (let step = 0; step < SIDE; step++) {
      if (hash2(step, 0, ctx.salt + 55) < 0.45) pos += hash2(step, 1, ctx.salt + 56) < 0.5 ? -1 : 1;
      pos = Math.min(hiPos, Math.max(loPos, pos));
      for (let d = -(halfW + banks); d <= halfW + 1; d++) {
        const a = pos + d;
        if (a < 0 || a >= SIDE) continue;
        const i = horiz ? a * SIDE + step : step * SIDE + a;
        if (near.has(i)) continue;
        const ad = Math.abs(d);
        let h;
        if (d >= 0) {
          h = ad < halfW ? floorH : plateauH;
        } else {
          const perp = Math.max(0, ad - halfW + 1);
          h = Math.max(floorH, plateauH - perp * stepH);
        }
        heights[i] = Math.round(h * 4) / 4;
        roles[i] = h > 0.5 ? ROLE_WALL : ROLE_PATH;
      }
    }
    for (let k = 0; k < 3; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_PATH && !near.has(i), ctx.salt + 571 + k);
      if (s0 < 0) break;
      if (hash2(k, 30, ctx.salt + 57) < 0.5) {
        roles[s0] = ROLE_WALL;
        heights[s0] = floorH + 0.3;
      } else {
        roles[s0] = ROLE_LIQUID;
        heights[s0] = floorH - 0.4;
      }
    }
    openPorts(roles, ctx.ports);
    for (const p of portCells(ctx.ports)) heights[p] = NaN;
    return { roles, heights };
  }
});
registerPreset({
  key: "island",
  label: "\u5B64\u5C9B",
  weight: 1.3,
  // 地标
  build(ctx) {
    const roles = new Uint8Array(N);
    roles.fill(ROLE_LIQUID);
    const heights = new Float32Array(N).fill(NaN);
    const near = portNearSet(ctx.ports);
    const cx0 = 5 + Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 61) * 5);
    const cz0 = 5 + Math.floor(hash2(ctx.cz, ctx.cx, ctx.salt + 62) * 5);
    const R = 3.2 + hash2(ctx.cx + 1, ctx.cz + 1, ctx.salt + 63) * 1.8;
    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const i = z * SIDE + x;
        if (near.has(i)) continue;
        const dx = x - cx0, dz = z - cz0;
        const d = Math.sqrt(dx * dx + dz * dz);
        const wob = (vnoise(x * 0.5, z * 0.5, ctx.salt + 64) - 0.5) * 1.4;
        if (d + wob < R) {
          const t = 1 - (d + wob) / R;
          heights[i] = Math.max(0.4, t * 1.8);
          roles[i] = t > 0.55 ? ROLE_WALL : ROLE_PATH;
        }
      }
    }
    const isles = hash2(cx0, cz0, ctx.salt + 65) < 0.55 ? 1 + Math.floor(hash2(cx0, cz0, ctx.salt + 66) * 2) : 0;
    for (let k = 0; k < isles; k++) {
      const s0 = pickStart(roles, (i) => roles[i] === ROLE_LIQUID && !near.has(i), ctx.salt + 661 + k);
      if (s0 < 0) break;
      const painted = paintCluster(roles, s0, 2 + Math.floor(hash2(k, 21, ctx.salt + 67) * 2), ROLE_PATH, near, ctx.salt + 671 + k);
      if (painted > 0) heights[s0] = 0.5;
    }
    const bridge = (_c, sx, sz) => {
      let x = sx, z = sz;
      for (let guard = 0; guard < SIDE * 2; guard++) {
        const i = z * SIDE + x;
        roles[i] = ROLE_PATH;
        if (!Number.isFinite(heights[i])) heights[i] = 0.6;
        if (x === cx0 && z === cz0) break;
        if (Math.abs(cx0 - x) > Math.abs(cz0 - z)) x += Math.sign(cx0 - x);
        else z += Math.sign(cz0 - z);
      }
    };
    for (const c of ctx.ports.top) bridge(c, c, 0);
    for (const c of ctx.ports.bottom) bridge(c, c, SIDE - 1);
    for (const r of ctx.ports.left) bridge(r, 0, r);
    for (const r of ctx.ports.right) bridge(r, SIDE - 1, r);
    openPorts(roles, ctx.ports);
    for (const p of portCells(ctx.ports)) heights[p] = NaN;
    return { roles, heights };
  }
});
var CAVE_CLEARANCE = 2.8;
var CAVE_CAP_THICK = 0.6;
var CAVE_RAMP_STEPS = 7;
registerPreset({
  key: "cave",
  label: "\u6D1E\u7A74\u5C71\u4E18",
  weight: 1.2,
  build(ctx) {
    const roles = new Uint8Array(N);
    const heights = new Float32Array(N).fill(NaN);
    const caps = new Float32Array(N).fill(NaN);
    const PH = Math.round((5 + hash2(ctx.cx, ctx.cz, ctx.salt + 81) * 1.5) * 4) / 4;
    const PF = Math.round((PH - (CAVE_CLEARANCE + CAVE_CAP_THICK)) * 4) / 4;
    roles.fill(ROLE_WALL);
    for (let i = 0; i < N; i++) heights[i] = PH;
    const side = Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 82) * 4);
    const portsOf = [ctx.ports.top, ctx.ports.bottom, ctx.ports.left, ctx.ports.right][side];
    const pick = portsOf.length > 0 ? portsOf[Math.floor(hash2(ctx.cx, ctx.cz, ctx.salt + 83) * portsOf.length)] : 7;
    let x, z, ddx, ddz;
    if (side === 0) {
      x = Math.max(2, Math.min(SIDE - 3, pick));
      z = 0;
      ddx = 0;
      ddz = 1;
    } else if (side === 1) {
      x = Math.max(2, Math.min(SIDE - 3, pick));
      z = SIDE - 1;
      ddx = 0;
      ddz = -1;
    } else if (side === 2) {
      x = 0;
      z = Math.max(2, Math.min(SIDE - 3, pick));
      ddx = 1;
      ddz = 0;
    } else {
      x = SIDE - 1;
      z = Math.max(2, Math.min(SIDE - 3, pick));
      ddx = -1;
      ddz = 0;
    }
    const totalSteps = CAVE_RAMP_STEPS + 5;
    const perpX = ddz, perpZ = ddx;
    const tunnel = [];
    for (let s = 0; s < totalSteps; s++) {
      if (s > 1 && hash2(s, 1, ctx.salt + 84) < 0.4) {
        const d = hash2(s, 2, ctx.salt + 85) < 0.5 ? -1 : 1;
        x += perpX * d;
        z += perpZ * d;
        x = Math.max(1, Math.min(SIDE - 2, x));
        z = Math.max(1, Math.min(SIDE - 2, z));
      }
      const t = Math.min(1, s / CAVE_RAMP_STEPS);
      const h = Math.round((PH + (PF - PH) * t) * 4) / 4;
      for (let w = 0; w < 2; w++) {
        const tx = Math.max(0, Math.min(SIDE - 1, x + perpX * w));
        const tz = Math.max(0, Math.min(SIDE - 1, z + perpZ * w));
        tunnel.push({ x: tx, z: tz, h });
      }
      x += ddx;
      z += ddz;
      x = Math.max(0, Math.min(SIDE - 1, x));
      z = Math.max(0, Math.min(SIDE - 1, z));
    }
    const end = tunnel[tunnel.length - 1];
    for (let zz = -1; zz <= 1; zz++) {
      for (let xx = -1; xx <= 1; xx++) {
        const hx = Math.max(0, Math.min(SIDE - 1, end.x + xx));
        const hz = Math.max(0, Math.min(SIDE - 1, end.z + zz));
        tunnel.push({ x: hx, z: hz, h: PF });
      }
    }
    for (const c of tunnel) {
      const i = c.z * SIDE + c.x;
      roles[i] = ROLE_PATH;
      heights[i] = c.h;
      if (PH - c.h >= CAVE_CLEARANCE + CAVE_CAP_THICK - 0.3) caps[i] = PH;
    }
    openPorts(roles, ctx.ports);
    return {
      roles,
      heights,
      caveCaps: caps,
      overridePorts: true,
      materials: { ground: "cave_floor", platform: "cave_platform" },
      noGroundPatch: true
    };
  }
});

// src/services/map/ChunkGenerator.ts
var CHUNK_SIZE = 60;
var BLOCK_SIZE = 4;
var BLOCKS_PER_SIDE = CHUNK_SIZE / BLOCK_SIZE;

// src/services/map/Refinements.ts
var WELD_RAMP_CELLS = BLOCK_SIZE / 3;

// src/services/map/WaterSurface.ts
var HALF = CHUNK_SIZE / 2;
var WATER_MAX_DEEP = 6;
var WATER_Y_EPS = 0.03;
var PLANE_Y_EPS = 0.05;
var LIP_STRIDE = 0.05;
var BED_GRID = Math.round(4 / LIP_STRIDE);

// src/services/map/water/bodyWater.ts
function blockKeyToXZ(k) {
  return { bx: Math.floor(k / 8192) - 4096, bz: k % 8192 - 4096 };
}
function buildBodyWater(inp) {
  const verts = [];
  const nors = [];
  const uvs = [];
  const deps = [];
  const borders = [];
  const idx = [];
  const S = inp.step;
  const y = inp.level - WATER_Y_EPS;
  const minDepth = -PLANE_Y_EPS;
  for (const bk2 of inp.blocks) {
    const { bx, bz } = blockKeyToXZ(bk2);
    const x0 = bx * 4, z0 = bz * 4, x1 = x0 + 4, z1 = z0 + 4;
    const bed = inp.bedAt(bx, bz);
    const depth = inp.level - bed;
    if (depth < minDepth) continue;
    const deep = Math.min(Math.max(depth, 0), WATER_MAX_DEEP);
    const edge = inp.isEdge(bx, bz) ? 1 : 0;
    const base = verts.length / 3;
    if (S === 4) {
      verts.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      for (let k = 0; k < 4; k++) {
        nors.push(0, 1, 0);
        uvs.push(x0, z0);
        deps.push(deep);
        borders.push(edge);
      }
      idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
    } else {
      for (let iz = 0; iz < 4; iz++) {
        for (let ix = 0; ix < 4; ix++) {
          const ax = x0 + ix, az = z0 + iz;
          const b = verts.length / 3;
          verts.push(ax, y, az, ax + 1, y, az, ax + 1, y, az + 1, ax, y, az + 1);
          for (let k = 0; k < 4; k++) {
            nors.push(0, 1, 0);
            uvs.push(ax, az);
            deps.push(deep);
            borders.push(edge);
          }
          idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
        }
      }
    }
  }
  return {
    vertices: new Float32Array(verts),
    normals: new Float32Array(nors),
    uvs: new Float32Array(uvs),
    deep: new Float32Array(deps),
    border: new Float32Array(borders),
    spin: new Float32Array(verts.length / 3 * 2),
    indices: new Uint32Array(idx),
    quads: idx.length / 6,
    // ★ levelIsForced = true：body 级几何的水位就是 body.L，**不是**求解器算的唇
    //   ⇒ 主线程不会把它当"唇候选"回灌 ⇒ 不会污染 body.L 的汇总。
    level: inp.level,
    levelIsForced: true
  };
}

// __probe_bodywater.ts
var fails = 0;
function assert(cond, msg) {
  if (!cond) {
    fails++;
    console.log("  FAIL  " + msg);
  } else console.log("  PASS  " + msg);
}
var bk = (bx, bz) => (bx + 4096) * 8192 + (bz + 4096);
console.log("=== \u2460 body \u4E00\u4E2A\u6C34\u4F4D\uFF1B\u6C60\u5E95\u9AD8\u4E8E\u6C34\u4F4D\u7684\u5757\u88AB\u5254\u9664 ===");
{
  const beds = /* @__PURE__ */ new Map([
    [bk(0, 0), -1],
    [bk(1, 0), -0.5],
    [bk(2, 0), -0.02]
  ]);
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0), bk(2, 0)],
    level: -0.5,
    // ★ body 唯一水位
    bedAt: (bx, bz) => beds.get(bk(bx, bz)) ?? -1,
    isEdge: () => false,
    step: 4
  });
  console.log(`  \u9876\u70B9 ${raw.vertices.length / 3}\u3001\u4E09\u89D2 ${raw.indices.length / 3}\uFF083 \u5757\u5168\u7559\u5E94\u662F 12/6\uFF09`);
  assert(raw.vertices.length / 3 === 8, "\u2605 \u6D45\u6EE9\u5757\u88AB\u5254\u9664\uFF088 \u9876\u70B9 = 2 \u5757\uFF09");
  assert(raw.indices.length / 3 === 4, "\u4E09\u89D2\u6570\u5BF9\u5E94\uFF084\uFF09");
}
console.log("=== \u2461 \u5168\u90E8\u5757\u90FD\u6709\u6C34 \u21D2 \u5168\u90E8\u4FDD\u7559 ===");
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0), bk(2, 0)],
    level: -0.5,
    bedAt: () => -1,
    isEdge: () => false,
    step: 4
  });
  console.log(`  \u9876\u70B9 ${raw.vertices.length / 3}\u3001\u4E09\u89D2 ${raw.indices.length / 3}`);
  assert(raw.vertices.length / 3 === 12, "3 \u5757\u5168\u7559\uFF0812 \u9876\u70B9\uFF09");
}
console.log("=== \u2462 \u5168\u90E8\u5757\u90FD\u9732\u5E95 \u21D2 \u7A7A\u51E0\u4F55\uFF08\u4E0D\u753B\uFF09===");
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0)],
    level: -0.5,
    bedAt: () => 0.5,
    // 池底高于水位
    isEdge: () => false,
    step: 4
  });
  console.log(`  \u9876\u70B9 ${raw.vertices.length / 3}`);
  assert(raw.vertices.length / 3 === 0, "\u7A7A\u51E0\u4F55");
  assert(raw.indices.length === 0, "\u65E0\u7D22\u5F15");
}
console.log("=== \u2463 \u6C34\u4F4D\u7EDF\u4E00\uFF08\u4E00\u4F53\uFF09\uFF1A\u6240\u6709\u9876\u70B9 y \u76F8\u540C ===");
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0)],
    level: -0.37,
    bedAt: () => -1,
    isEdge: () => false,
    step: 4
  });
  const ys = /* @__PURE__ */ new Set();
  for (let i = 1; i < raw.vertices.length; i += 3) ys.add(Math.round(raw.vertices[i] * 1e6) / 1e6);
  console.log(`  \u4E0D\u540C\u7684 y \u503C\u4E2A\u6570 = ${ys.size}\uFF08\u5E94\u4E3A 1\uFF09`);
  assert(ys.size === 1, "\u2605 body \u4E00\u4F53\uFF1A\u6240\u6709\u9876\u70B9\u540C\u9AD8");
}
console.log("=== \u2464 near \u6863\uFF081m \u7F51\u683C\uFF09\u540C\u6837\u5254\u9664 ===");
{
  const raw = buildBodyWater({
    blocks: [bk(0, 0), bk(1, 0)],
    level: -0.5,
    bedAt: (bx) => bx === 0 ? -1 : -0.02,
    // 第二块是浅滩
    isEdge: () => false,
    step: 1
  });
  console.log(`  \u9876\u70B9 ${raw.vertices.length / 3}\uFF081m \u7F51\u683C\u6BCF\u5757 64 \u9876\u70B9\uFF09`);
  assert(raw.vertices.length / 3 === 64, "\u2605 \u8FD1\u666F\u6863\u4E5F\u5254\u9664\u4E86\u6D45\u6EE9\u5757");
}
console.log(fails === 0 ? "\n\u5168\u90E8 PASS" : `
${fails} \u9879 FAIL`);
process.exit(fails === 0 ? 0 : 1);

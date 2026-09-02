// ============================================================
// SunCycle —— 昼夜时间模型（纯计算，无副作用）
// ============================================================
// 时间模型：局内连续推进（update(dt) 每帧驱动；DAY_SECONDS 现实秒 = 游戏 24h）。
// ★ 归 RenderManager 持有协调，实体不直接访问本类——查询走 renderManager.querySun()。
// 消费者：
//   - GameLights.follow      → 太阳/月亮位置/颜色/强度
//   - EntityBase.syncShadow  → 剪影影子仿射投影（方向+长度随太阳变化）
//   - RenderManager          → 天空颜色/雾色动态更新
//
// 几何约定（与剪影影子的解析投影配套）：
//   - 日出 SUNRISE / 日落 SUNSET，正弦仰角弧线，峰值 MAX_ELEV_DEG
//   - ★ 仰角钳制 MIN_ELEV_DEG（用户决策：不要贴地夕阳）→ 影长上限 ≈ h/tan(20°) ≈ 2.7h
//   - 方位：东(+x) → 西(-x) 匀速扫过，固定 z 偏（影子始终略偏一侧）
//   - 月亮：夜间升起，与太阳大致对侧，独立仰角弧线
//   - 天空渐变色：天顶/地平线/地面三色，随时间插值
// ============================================================

export interface SunSample {
  /** 太阳方向（单位向量，指向太阳） */
  dir: { x: number; y: number; z: number };
  /** 白昼因子 0..1（1=白天全亮；晨昏过渡；0=夜） */
  daylight: number;
  /** 阳光颜色（hex；低仰角暖橙 → 正午暖白；夜晚冷蓝暗色） */
  color: number;
  /** 强度系数（乘 LIGHT_TUNING.sunIntensity；夜晚 ≈0.18 不至于漆黑） */
  intensityScale: number;
  /** 游戏内小时 0-24（调试/HUD 用） */
  hour: number;
}

export interface MoonSample {
  /** 月亮方向（单位向量，指向月亮） */
  dir: { x: number; y: number; z: number };
  /** 月亮仰角（度，0..MAX_MOON_ELEV_DEG） */
  elevationDeg: number;
  /** 月亮可见度 0..1（升落过渡带平滑） */
  visibility: number;
  /** 月光颜色（hex，冷银蓝色） */
  color: number;
  /** 月光强度系数（夜晚最大 ~0.12，白天为 0） */
  intensityScale: number;
  /** 月相 0..1（0=新月/看不见，0.5=满月） */
  phase: number;
}

export interface SkyGradient {
  /** 天顶色（hex） */
  zenith: number;
  /** 地平线色（hex） */
  horizon: number;
  /** 地面反光色（hex，影响半球光地面色） */
  ground: number;
}

// ---- 时间常量 ----
const DAY_SECONDS = 900;   // 现实 15 分钟 = 游戏 24 小时（可调）
const START_HOUR = 6;      // 初始时间 = 白天（上午，太阳仰角充足、光照明亮）
const SUNRISE = 6;
const SUNSET = 18;
const MIN_ELEV_DEG = 20;   // ★ 用户决策：仰角不用太低
const MAX_ELEV_DEG = 66;

// ---- 月亮常量 ----
const MOONRISE = 19;       // 日落后约 1 小时升起
const MOONSET = 5;         // 日出前约 1 小时落下
const MAX_MOON_ELEV_DEG = 52;
const MOON_COLOR = 0xc8d8f0;       // 冷银蓝
const MOON_INTENSITY = 0.12;       // 满月最大强度
const MOON_PHASE_PERIOD = 7;       // 天 = 一个完整月相周期（游戏加速版）

// ---- 工具函数 ----
function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** hex 颜色通道线性插值 */
function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// ---- 天空色板 ----
// 白天
const DAY_ZENITH  = 0x4a90d9;   // 明亮天蓝
const DAY_HORIZON = 0x87ceeb;   // 浅天蓝
const DAY_GROUND  = 0x8a7455;   // 暖棕（地面反光）

// 黄昏/黎明（晨昏过渡）
const DUSK_ZENITH  = 0x3a2060;   // 深紫
const DUSK_HORIZON = 0xe8854a;   // 暖橙红
const DUSK_GROUND  = 0x4a3028;   // 暗棕

// 夜晚
const NIGHT_ZENITH  = 0x0a0e28;   // 极深靛蓝
const NIGHT_HORIZON = 0x1a2444;   // 深蓝灰
const NIGHT_GROUND  = 0x181820;   // 近黑

// ---- 太阳色板 ----
const NOON_COLOR  = 0xfff3e0;    // 正午暖白
const DUSK_SUN    = 0xffc48a;    // 晨昏暖橙
const NIGHT_SUN   = 0x8fa3cc;    // 夜晚冷蓝（夜晚太阳不可见时的残余色）

export class SunCycle {
  private hour = START_HOUR;
  private _dayCount = 0;   // 累计天数（用于月相）
  private sample: SunSample = {
    dir: { x: 0, y: 1, z: 0 }, daylight: 1, color: NOON_COLOR,
    intensityScale: 1, hour: START_HOUR,
  };
  private moonSample: MoonSample = {
    dir: { x: 0, y: 0.5, z: 0 }, elevationDeg: 0, visibility: 0,
    color: MOON_COLOR, intensityScale: 0, phase: 0.5,
  };
  private skyGradient: SkyGradient = {
    zenith: DAY_ZENITH, horizon: DAY_HORIZON, ground: DAY_GROUND,
  };
  /** 重置到指定时刻（每次出击进入世界时调用） */
  reset(hour = START_HOUR): void {
    this.hour = hour;
    this.recompute();
  }

  /** 每帧连续推进 */
  update(dt: number): void {
    const prevHour = this.hour;
    this.hour = (this.hour + (dt * 24) / DAY_SECONDS) % 24;
    // 跨日检测（用于月相）
    if (this.hour < prevHour) this._dayCount++;
    this.recompute();
  }

  get current(): SunSample { return this.sample; }
  get moon(): MoonSample { return this.moonSample; }
  get sky(): SkyGradient { return this.skyGradient; }

  // ---- 内部计算 ----
  private recompute(): void {
    const t = this.hour;

    // ==================== 太阳 ====================
    const p = clamp((t - SUNRISE) / (SUNSET - SUNRISE), 0, 1);

    const elevGeoDeg = Math.sin(p * Math.PI) * MAX_ELEV_DEG;
    const elevUseRad = Math.max(elevGeoDeg, MIN_ELEV_DEG) * (Math.PI / 180);

    const az = p * Math.PI;
    let hx = Math.cos(az);
    let hz = -0.45;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl; hz /= hl;

    const ce = Math.cos(elevUseRad), se = Math.sin(elevUseRad);
    this.sample.dir.x = hx * ce;
    this.sample.dir.y = se;
    this.sample.dir.z = hz * ce;

    const dl =
      smoothstep(SUNRISE - 1.2, SUNRISE + 1.2, t) *
      (1 - smoothstep(SUNSET - 1.2, SUNSET + 1.2, t));
    this.sample.daylight = dl;

    const dayColor = mixHex(DUSK_SUN, NOON_COLOR, clamp(elevGeoDeg / MAX_ELEV_DEG, 0, 1));
    this.sample.color = mixHex(NIGHT_SUN, dayColor, dl);
    this.sample.intensityScale = 0.18 + 0.82 * dl;
    this.sample.hour = t;

    // ==================== 月亮 ====================
    this.recomputeMoon(t);

    // ==================== 天空渐变色 ====================
    this.recomputeSky(t, dl);
  }

  /** 月亮方位/仰角/可见度/月相 */
  private recomputeMoon(t: number): void {
    // 月亮可见度：MOONRISE → MOONSET 跨午夜弧线
    // 处理方式：将时间映射到 [MOONRISE, MOONSET+24) 范围
    let moonT: number;
    if (MOONRISE < MOONSET) {
      // 不跨午夜（异常情况，但兼容）
      moonT = clamp((t - MOONRISE) / (MOONSET - MOONRISE), 0, 1);
    } else {
      // 跨午夜：MOONRISE=19, MOONSET=5 → [19,29) 范围
      const effectiveT = t < MOONSET ? t + 24 : t;
      moonT = clamp((effectiveT - MOONRISE) / ((MOONSET + 24) - MOONRISE), 0, 1);
    }

    // 仰角：正弦弧线
    const elevGeoDeg = Math.sin(moonT * Math.PI) * MAX_MOON_ELEV_DEG;
    this.moonSample.elevationDeg = elevGeoDeg;

    // 可见度：晨昏平滑过渡（±1.0h）。
    // ★ 必须用与 moonT 相同的跨午夜窗口 effectiveT——直接对原始 t 做
    //   smoothstep(MOONSET±1,t) 会在天黑后（t>MOONSET）把整夜月亮压成 0，
    //   导致"晚上月亮不升起"。MOONSET=5 的小时位置要+24 映射到窗口 [19,29)。
    const eff = (MOONRISE > MOONSET && t < MOONSET) ? t + 24 : t;
    const riseFade = smoothstep(MOONRISE - 1.0, MOONRISE + 1.0, eff);
    const setFade = 1.0 - smoothstep((MOONSET + 24) - 1.0, (MOONSET + 24) + 1.0, eff);
    const moonVisibility = riseFade * setFade;
    this.moonSample.visibility = moonVisibility;

    // 方位：与太阳相反方向（+x → -x 变为 -x → +x），z 偏取反
    const moonAz = (1 - moonT) * Math.PI;   // 反向扫过
    let mx = Math.cos(moonAz);
    let mz = 0.45;   // z 偏与太阳相反
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;

    const meRad = Math.max(elevGeoDeg, 10) * (Math.PI / 180);
    const mce = Math.cos(meRad), mse = Math.sin(meRad);
    this.moonSample.dir.x = mx * mce;
    this.moonSample.dir.y = mse;
    this.moonSample.dir.z = mz * mce;

    // 月相：基于累计天数的正弦波（0=新月，0.5=满月）
    this.moonSample.phase = 0.5 + 0.5 * Math.sin((this._dayCount / MOON_PHASE_PERIOD) * Math.PI * 2);

    // 月光强度：满月 × 可见度
    const moonBrightness = this.moonSample.phase * moonVisibility;
    this.moonSample.intensityScale = MOON_INTENSITY * moonBrightness;
  }

  /** 天空三色渐变 + 雾色 */
  private recomputeSky(t: number, dl: number): void {
    // 三个时间段的权重：
    // dayW: 白天（日出后→日落前）
    // duskW: 晨昏过渡（日出±1.5h / 日落±1.5h）
    // nightW: 夜晚
    //
    // 利用 daylight 平方作为"正午感"，dl 本身作为"白天感"
    // dusk 感来自 |dl - dl²|（过渡带峰值）
    const noonFactor = dl * dl;                // 正午最强，晨昏/夜晚为 0
    const dayFactor = dl;                      // 白天感
    const duskFactor = Math.abs(dl - dl * dl); // 晨昏带 = dl*(1-dl) 在 0.5 处峰值
    const nightFactor = 1 - dl;               // 夜晚感

    // 晨昏过渡在日出/日落附近额外增强（±1.5h 窗口）
    const dawnDusk = smoothstep(SUNRISE - 0.5, SUNRISE + 1.5, t) *
                     (1 - smoothstep(SUNSET - 1.5, SUNSET + 0.5, t));
    const duskBand = Math.abs(dawnDusk - dl);  // 晨昏过渡带强度

    // ---- 天顶色 ----
    let zenith = NIGHT_ZENITH;
    zenith = mixHex(zenith, DUSK_ZENITH, clamp(duskFactor * 3, 0, 1));
    zenith = mixHex(zenith, DAY_ZENITH, clamp(dayFactor, 0, 1));

    // ---- 地平线色 ----
    let horizon = NIGHT_HORIZON;
    horizon = mixHex(horizon, DUSK_HORIZON, clamp(duskBand * 4, 0, 1));
    horizon = mixHex(horizon, DAY_HORIZON, clamp(dayFactor, 0, 1));

    // ---- 地面色 ----
    let ground = NIGHT_GROUND;
    ground = mixHex(ground, DUSK_GROUND, clamp(duskFactor * 3, 0, 1));
    ground = mixHex(ground, DAY_GROUND, clamp(dayFactor, 0, 1));

    this.skyGradient.zenith = zenith;
    this.skyGradient.horizon = horizon;
    this.skyGradient.ground = ground;
  }
}

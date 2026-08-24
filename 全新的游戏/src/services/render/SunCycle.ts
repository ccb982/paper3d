// ============================================================
// SunCycle —— 昼夜时间模型（纯计算，无副作用）
// ============================================================
// 时间模型：局内连续推进（update(dt) 每帧驱动；DAY_SECONDS 现实秒 = 游戏 24h）。
// ★ 归 RenderManager 持有协调，实体不直接访问本类——查询走 renderManager.querySun()。
// 消费者：
//   - GameLights.follow      → 太阳位置/颜色/强度（真实光照词汇表）
//   - EntityBase.syncShadow  → 剪影影子仿射投影（方向+长度随太阳变化）
//
// 几何约定（与剪影影子的解析投影配套）：
//   - 日出 SUNRISE / 日落 SUNSET，正弦仰角弧线，峰值 MAX_ELEV_DEG
//   - ★ 仰角钳制 MIN_ELEV_DEG（用户决策：不要贴地夕阳）→ 影长上限 ≈ h/tan(20°) ≈ 2.7h
//   - 方位：东(+x) → 西(-x) 匀速扫过，固定 z 偏（影子始终略偏一侧）
//   - daylight 白昼因子：晨昏 ±过渡带平滑归零 —— 夜晚内容（月光等）的未来接入点
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

const DAY_SECONDS = 900;   // 现实 15 分钟 = 游戏 24 小时（可调）
const START_HOUR = 7.5;    // 每次出击从清晨出发
const SUNRISE = 6;
const SUNSET = 18;
const MIN_ELEV_DEG = 20;   // ★ 用户决策：仰角不用太低
const MAX_ELEV_DEG = 66;

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

const NOON_COLOR = 0xfff3e0;    // 正午暖白
const DUSK_COLOR = 0xffc48a;    // 晨昏暖橙
const NIGHT_COLOR = 0x8fa3cc;   // 夜晚冷蓝

export class SunCycle {
  private hour = START_HOUR;
  private sample: SunSample = { dir: { x: 0, y: 1, z: 0 }, daylight: 1, color: NOON_COLOR, intensityScale: 1, hour: START_HOUR };

  /** 重置到指定时刻（每次出击进入世界时调用） */
  reset(hour = START_HOUR): void {
    this.hour = hour;
    this.recompute();
  }

  /** 每帧连续推进 */
  update(dt: number): void {
    this.hour = (this.hour + (dt * 24) / DAY_SECONDS) % 24;
    this.recompute();
  }

  get current(): SunSample {
    return this.sample;
  }

  private recompute(): void {
    const t = this.hour;

    // ---- 白昼进度 0..1（日出到日落）----
    const p = clamp((t - SUNRISE) / (SUNSET - SUNRISE), 0, 1);

    // ---- 仰角：正弦弧线（几何值用于白昼判定），使用值钳制下限 ----
    const elevGeoDeg = Math.sin(p * Math.PI) * MAX_ELEV_DEG;
    const elevUseRad = Math.max(elevGeoDeg, MIN_ELEV_DEG) * (Math.PI / 180);

    // ---- 方位：东(+x) → 西(-x)，固定 z 偏 ----
    const az = p * Math.PI;
    let hx = Math.cos(az);
    let hz = -0.45;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl; hz /= hl;

    const ce = Math.cos(elevUseRad), se = Math.sin(elevUseRad);
    this.sample.dir.x = hx * ce;
    this.sample.dir.y = se;
    this.sample.dir.z = hz * ce;

    // ---- 白昼因子：日出/日落过渡带平滑（几何仰角低于钳制值时开始衰减）----
    const dl =
      smoothstep(SUNRISE - 1.2, SUNRISE + 1.2, t) *
      (1 - smoothstep(SUNSET - 1.2, SUNSET + 1.2, t));
    this.sample.daylight = dl;

    // ---- 色温：正午暖白 ↔ 晨昏暖橙 ↔ 夜晚冷蓝 ----
    const dayColor = mixHex(DUSK_COLOR, NOON_COLOR, clamp(elevGeoDeg / MAX_ELEV_DEG, 0, 1));
    this.sample.color = mixHex(NIGHT_COLOR, dayColor, dl);
    this.sample.intensityScale = 0.18 + 0.82 * dl;
    this.sample.hour = t;
  }
}

// ============================================================
// GroundShadowController —— 贴地剪影影子控制器（EntityBase 组合件）
// ============================================================
// 从 EntityBase 搬出（《RTS架构.md》E1；行为零变化）：
//   影子 = 竖立精灵在太阳平行光下的解析仿射投影（脚跟锚定）：
//     锚点 = 脚点投影（离地越高整条影子向阳反方向外移）
//     影长 = 视觉高 × 投影比（1/tan 仰角），方向与太阳水平分量反向
// 组合关系：EntityBase 持有本控制器，每帧把宿主状态经 host 回调喂进来；
//   host 回调惰性求值 → 视锥外/强 LOD 裁剪时不做剪影解析（性能语义与原实现一致）。
// ============================================================

import * as THREE from 'three';
import { RasterMap } from '../map/RasterMap';
import { renderManager } from '../render/RenderManager';
import { SilhouetteShadow, type ShadowFrameSource } from '../render/SilhouetteShadow';

/** 宿主状态访问面（EntityBase 实现；均为惰性 getter，零分配） */
export interface GroundShadowHost {
  scene(): THREE.Scene | null;
  /** 影子形状声明（null = 无影子） */
  shape(): { w: number; h?: number; len?: number; alpha?: number } | null;
  /** 影子朝向（固定长轴模式用） */
  yaw(): number;
  visible(): boolean;
  inFrustum(): boolean;
  /** 当前 LOD 档位（0 最高） */
  lod(): number;
  /** 远距影子裁剪比例（0~1；0 = 不裁） */
  farCull(): number;
  /** 剪影源（无 = 不画） */
  frameData(): ShadowFrameSource | null;
  /** 贴片右向量的地面投影（近共线时返回 null 退化） */
  basisX(): { x: number; z: number } | null;
  position(): { x: number; y: number; z: number };
}

export class GroundShadowController {
  private shadow: SilhouetteShadow | null = null;
  /** 影子仿射上次更新时刻（中远 LOD 降频用） */
  private lastAffMs = 0;
  /** 实体级固定裁剪随机键（构造时一次；同一实体远近移动不闪变） */
  private readonly cullKey = Math.random();

  constructor(private readonly host: GroundShadowHost) {}

  /** 每帧同步（惰性创建 + 剪影更新 + 太阳投影仿射 + LOD/日照渐隐） */
  sync(): void {
    const shape = this.host.shape();
    const scene = this.host.scene();
    if (!shape || !scene) return;
    // ★ 视锥外（上一帧渲染未命中）→ 影子不计算、网格隐藏；转回视野内下一帧自动恢复
    if (!this.host.inFrustum()) {
      this.hide();
      return;
    }
    const lod = this.host.lod();
    if (!this.host.visible() || lod >= 3) {
      this.hide();
      return;
    }
    // ★ 强 LOD（2026-09-12 用户定调：80% 远距敌人无需影子）：
    //   lod≥1 按实体固定 hash 裁掉 shadowFarCull 比例，lod≥2 全裁；
    //   放在剪影源解析/网格创建【之前】→ 连逐顶点贴地采样都省掉。
    const farCull = this.host.farCull();
    if (farCull > 0 && lod >= 1 && (lod >= 2 || this.cullKey < farCull)) {
      this.hide();
      return;
    }
    const fd = this.host.frameData();
    if (!fd) return; // 无剪影源 = 无影子（不做纯色矩形兜底）
    if (!this.shadow) {
      this.shadow = new SilhouetteShadow(scene, shape.w, shape.alpha ?? 0.38);
    }
    this.shadow.setSource(fd);

    // ★ 性能：逐顶点贴地采样（77→15 点/次）是实体更新的最大单点开销，
    //   不可见/最远档直接隐藏跳过；中远档（lod≥1）降频到 80ms 一次（位置差不可感）
    const nowMs = performance.now();
    if (lod >= 1 && nowMs - this.lastAffMs < 80) return;
    this.lastAffMs = nowMs;

    // ---- 地面仿射基：宽向量 R × 长向量 S（脚跟锚定，向阳反方向延伸） ----
    const p = this.host.position();
    const sun = renderManager.querySun();
    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    const airH = Math.max(0, p.y - gy);
    // 太阳水平单位向量(脚跟→影子方向) 与 投影比 1/tan(仰角)
    const ux = -sun.dir.x, uz = -sun.dir.z;
    const ul = Math.hypot(ux, uz) || 1e-6;
    const sunUx = ux / ul, sunUz = uz / ul;
    const ratio = ul / Math.max(0.15, sun.dir.y);
    let ax = p.x, az = p.z;
    let rx: number, rz: number, sx: number, sz: number, len: number;

    if (shape.len != null) {
      // 固定长轴模式（子弹等自拉伸体）：椭圆居中于地面投影点，
      // 方向 = shadowYaw；离地高度使整条影子沿太阳反向位移
      const yaw = this.host.yaw();
      sx = Math.sin(yaw); sz = Math.cos(yaw);
      len = shape.len;
      rx = sz; rz = -sx;
      ax += sunUx * airH * ratio - sx * len / 2;
      az += sunUz * airH * ratio - sz * len / 2;
    } else {
      // 太阳投影模式：影长 = 视觉高 × 投影比；锚点 = 脚点投影
      // （脚跟在 P_xz + S×离地投影，末端再向外延 h×投影比）
      sx = sunUx; sz = sunUz;
      len = (shape.h ?? shape.w) * ratio;
      rx = -sz; rz = sx;                       // 宽轴默认垂直长轴
      const rb = this.host.basisX();           // 贴片右向量投影（近共线时退化）
      if (rb && Math.abs(rb.x * sx + rb.z * sz) < 0.98) { rx = rb.x; rz = rb.z; }
      ax += sx * airH * ratio;
      az += sz * airH * ratio;
    }

    this.shadow.followAffine(ax, az, rx, rz, sx, sz, len,
      (wx, wz) => RasterMap.current?.surfaceHeightAt(wx, wz) ?? 0);
    this.shadow.mesh.visible = true;
    // 浓度随白昼因子调制：正午浓、晨昏淡、夜晚自然消失
    this.shadow.setLodOpacity(lod, 0.2 + 0.8 * sun.daylight);
  }

  /** 立即隐藏影子网格（不销毁；视锥外/不可见/裁剪） */
  hide(): void {
    if (this.shadow) this.shadow.mesh.visible = false;
  }

  /** 可见性联动（调用方已含 lod 判定；池化回收后必须立即隐藏，否则留"幽灵影子"） */
  setVisible(v: boolean): void {
    if (this.shadow) this.shadow.mesh.visible = v;
  }

  dispose(): void {
    this.shadow?.dispose();
    this.shadow = null;
  }
}

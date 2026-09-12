// ============================================================
// ShipRenderer —— 舰船渲染器（GLB 优先 + 程序化兜底）
// ============================================================
// 管线约定：
//   ① 构造即挂程序化军武运输舰（`proceduralShip.ts`）——立即可见、零下载；
//   ② 异步尝试 `public/models/ship.glb`（≤500KB 预算）：
//      存在 → 按包围盒归一化（长度 = SHIP_LENGTH，中心对齐姿态枢轴，
//      机头 +Z；朝向不符用 travel.json `shipModelYawDeg` 校正）后替换；
//      不存在/失败 → 静默保留程序化模型（控制台不打 error）。
//   ③ 姿态组（YXZ：航向→俯仰→滚转）与旧占位版一致，飞行代码零改动。
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FxRendererBase } from '../../services/render/FxRendererBase';
import { buildProceduralShip, disposeObject, SHIP_LENGTH, type ProceduralShip } from './proceduralShip';
import travelConfig from '../../config/travel.json';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** ★ 模型整体缩放（2026-09-12 用户定调：2× 大船；GLB 归一化后再乘此值） */
const MODEL_SCALE = 2;

export class ShipRenderer extends FxRendererBase {
  /** 姿态组（唯一旋转节点：飞行代码只碰它） */
  private group: THREE.Group;
  /** 程序化模型（GLB 就位后置空） */
  private procedural: ProceduralShip | null = null;
  /** 喷口基色（油门调制乘数用） */
  private readonly nozzleBase = new THREE.Color(0x8fdcff);
  private disposed = false;

  constructor(scene: THREE.Scene) {
    super();
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.scale.setScalar(MODEL_SCALE); // ★ 2× 大船（模型/G 尾焰/GLB 一起放大）
    scene.add(g);
    this.group = g;
    this.mesh = g as unknown as THREE.Mesh;

    // ① 程序化兜底（立即可见）
    this.procedural = buildProceduralShip();
    g.add(this.procedural.group);

    // ② 尝试美术模型（drop-in 替换）
    this.loadGltf();
  }

  /** ★ 飞行姿态（YXZ：先航向、再俯仰、后滚转） */
  setAttitude(heading: number, pitch: number, roll: number): void {
    this.group.rotation.y = heading;
    this.group.rotation.x = -pitch;
    this.group.rotation.z = roll;
  }

  /** ★ 油门视觉（0..1）：喷口增亮 + 尾焰伸缩/闪烁（GLB 模型由美术自带 emissive） */
  setThrottle(t: number): void {
    const th = clamp01(t);
    const proc = this.procedural;
    if (!proc) return;
    proc.nozzleMat.color.copy(this.nozzleBase).multiplyScalar(0.45 + 1.25 * th);
    const flames = proc.flames;
    if (flames.length === 0) return;
    const now = performance.now() * 0.001;
    const len = 0.18 + 1.0 * th;
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      f.visible = th > 0.02;
      // 每个喷口独立相位抖动（0.9~1.15），避免四道焰完全同步
      f.scale.z = len * (0.9 + 0.25 * Math.sin(now * 41.0 + i * 1.7));
    }
    proc.flameMat.opacity = (0.22 + 0.7 * th) * (0.86 + 0.14 * Math.sin(now * 37.0));
  }

  /** 异步加载 models/ship.glb（存在即替换程序化模型；失败静默） */
  private loadGltf(): void {
    const loader = new GLTFLoader();
    loader.load(
      'models/ship.glb',
      (gltf) => {
        if (this.disposed) {
          disposeObject(gltf.scene);
          return;
        }
        const holder = new THREE.Group();
        holder.rotation.y = THREE.MathUtils.degToRad(travelConfig.shipModelYawDeg ?? 0);
        holder.add(gltf.scene);

        // 归一化：机头 +Z 假设 → 长度对齐 SHIP_LENGTH；包围盒中心对齐姿态枢轴
        const size = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
        const scale = SHIP_LENGTH / Math.max(size.z, 1e-3);
        holder.scale.setScalar(scale);
        const box = new THREE.Box3().setFromObject(holder);
        const c = box.getCenter(new THREE.Vector3());
        holder.position.set(-c.x, -c.y, -c.z);

        this.group.add(holder);
        if (this.procedural) {
          this.group.remove(this.procedural.group);
          disposeObject(this.procedural.group);
          this.procedural = null;
        }
      },
      undefined,
      () => {
        // 无 models/ship.glb：保留程序化模型（属预期路径）
        console.info('[ShipRenderer] 未发现 models/ship.glb，使用程序化军武运输舰');
      },
    );
  }

  override dispose(): void {
    this.disposed = true;
    disposeObject(this.group);
    this.group.parent?.remove(this.group);
    this.procedural = null;
    this.mesh = null;
  }
}

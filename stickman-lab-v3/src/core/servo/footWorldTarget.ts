/** 脚体世界目标：只保存世界位姿，不写关节。 */
import type { World } from '../world';

export interface WorldPose {
  p: { x: number; y: number; z: number };
  q: { x: number; y: number; z: number; w: number };
}

export class FootWorldTarget {
  readonly pose = new Map<'l' | 'r', WorldPose>();
  private captured = false;

  reset(): void {
    this.pose.clear();
    this.captured = false;
  }

  capture(w: World): void {
    if (this.captured) return;
    for (const side of ['l', 'r'] as const) {
      const bi = w.body.indexByKey.get(`foot_${side}`);
      if (bi === undefined) continue;
      const rb = w.body.bodies[bi]!;
      const p = rb.translation();
      const q = rb.rotation();
      this.pose.set(side, { p: { x: p.x, y: p.y, z: p.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } });
    }
    this.captured = true;
  }
}

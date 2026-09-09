// ============================================================
// DroneFormation —— 无人机编队跟随偏移（纯函数，支持任意数量）
// ============================================================
// 多无人机跟随玩家时的 3D 分布：
//   · 左右交替（index 奇偶 → 右/左），更多无人机向外扩层；
//   · 高度错层（三档 1.6/2.05/2.5m），不挤在同一高度；
//   · 前后少量错落（±0.45m），不都在一个面上。
// 主体是横向偏移（r ≥ 1.1m）——远离准星正前方，不挡瞄准；
// 纵深只做少量错落，不会飘到画面中心。

import type { CameraFrame } from '../camera/CameraController';

export interface DroneFollowOffset {
  /** 沿相机 right 的横向偏移（米；正 = 画面右） */
  r: number;
  /** 相对玩家脚底的高度（米） */
  up: number;
  /** 沿相机 forward 的纵深偏移（米；正 = 画面深处） */
  f: number;
}

/** ★ 编队槽位 → 3D 跟随偏移（index = 第几架，0 起） */
export function droneFollowOffset(index: number, frame: CameraFrame): DroneFollowOffset {
  const side = index % 2 === 0 ? 1 : -1;              // 左右交替：0 右 / 1 左 / 2 右 …
  const tier = Math.floor(index / 2);                  // 第几层（更多无人机向外扩）
  const r = side * (1.1 + tier * 0.55);                // 横向：≥1.1m，远离准星
  const up = 1.6 + (index % 3) * 0.45;                 // 高度错层：1.6 / 2.05 / 2.5
  const f = ((tier + index) % 3 - 1) * 0.45;           // 前后错落：-0.45 / 0 / +0.45
  return { r, up, f };
}
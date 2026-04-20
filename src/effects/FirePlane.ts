import * as THREE from 'three';
import { createFireMaterial } from './FireMaterial';

/**
 * 创建一个动态火焰平面
 * @param width 宽度
 * @param height 高度
 * @param segments 分段数（越高越细腻，默认 16x16）
 * @param position 世界坐标
 * @param colorBottom 底部颜色
 * @param colorTop 顶部颜色
 * @returns Mesh 对象
 */
export function createFirePlane(
  width: number = 0.8,
  height: number = 1.2,
  segments: number = 16,
  position: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
  colorBottom?: THREE.Color,
  colorTop?: THREE.Color
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
  const material = createFireMaterial(colorBottom, colorTop);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  // 让平面始终面向相机（如果火苗需要始终面向玩家，可以每帧更新）
  // 但为了简化，可以让它固定在场景中，方向略向上倾斜。
  // 这里默认让它垂直于地面，并略微倾斜。
  mesh.rotation.x = -Math.PI / 6; // 向上倾斜 30 度
  return mesh;
}

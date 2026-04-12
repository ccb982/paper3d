import { BOUNDARY, SPEED } from '../../utils/constants';

interface Position {
  x: number;
  z: number;
}

interface Direction {
  x: number;
  z: number;
}

export const calculateNewPosition = (
  currentPos: Position,
  direction: Direction,
  speed: number = SPEED,
  deltaTime: number,
  boundary: typeof BOUNDARY = BOUNDARY
): Position => {
  // 计算移动距离
  const distance = speed * deltaTime;
  
  // 计算新位置
  let newX = currentPos.x + direction.x * distance;
  let newZ = currentPos.z + direction.z * distance;
  
  // 边界检查
  newX = Math.max(boundary.minX, Math.min(boundary.maxX, newX));
  newZ = Math.max(boundary.minZ, Math.min(boundary.maxZ, newZ));
  
  return { x: newX, z: newZ };
};
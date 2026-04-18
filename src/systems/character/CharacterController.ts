import { BOUNDARY, SPEED } from '../../utils/constants';

interface Position {
  x: number;
  z: number;
}

interface Direction {
  x: number;
  z: number;
  isRunning?: boolean;
}

export const calculateNewPosition = (
  currentPos: Position,
  direction: Direction,
  speed: number = SPEED,
  deltaTime: number,
  boundary: typeof BOUNDARY = BOUNDARY
): Position => {
  // 根据奔跑状态调整速度
  const runSpeedMultiplier = direction.isRunning ? 1.5 : 1;
  const adjustedSpeed = speed * runSpeedMultiplier;
  
  // 计算移动距离
  const distance = adjustedSpeed * deltaTime;
  
  // 计算新位置
  let newX = currentPos.x + direction.x * distance;
  let newZ = currentPos.z + direction.z * distance;
  
  // 边界检查
  newX = Math.max(boundary.minX, Math.min(boundary.maxX, newX));
  newZ = Math.max(boundary.minZ, Math.min(boundary.maxZ, newZ));
  
  return { x: newX, z: newZ };
};
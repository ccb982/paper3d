import { Position, Boundary } from './CharacterTypes';

export const calculateNewPosition = (
  currentPos: Position,
  direction: Position,
  speed: number,
  deltaTime: number,
  boundary: Boundary
): Position => {
  // 计算新位置
  let newX = currentPos.x + direction.x * speed * deltaTime;
  let newZ = currentPos.z + direction.z * speed * deltaTime;

  // 限制在边界内
  newX = Math.max(boundary.minX, Math.min(boundary.maxX, newX));
  newZ = Math.max(boundary.minZ, Math.min(boundary.maxZ, newZ));

  return { x: newX, z: newZ };
};
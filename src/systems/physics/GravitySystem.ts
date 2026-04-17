import { GRAVITY, GROUND_HEIGHT, CHARACTER_HEIGHT } from '../../utils/constants';

interface Position {
  x: number;
  y: number;
  z: number;
}

interface Velocity {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsObject {
  position: Position;
  velocity: Velocity;
  height: number;
  mass?: number;
}

export const applyGravity = (
  object: PhysicsObject,
  deltaTime: number
): PhysicsObject => {
  // 计算新的速度（应用重力）
  const newVelocity = {
    ...object.velocity,
    y: object.velocity.y + GRAVITY * deltaTime
  };

  // 计算新的位置
  const newPosition = {
    ...object.position,
    y: object.position.y + newVelocity.y * deltaTime
  };

  // 地面碰撞检测（角色底部上移1个单位）
  const groundY = GROUND_HEIGHT + object.height / 2 + 0.75;
  if (newPosition.y <= groundY) {
    return {
      ...object,
      position: {
        ...object.position,
        y: groundY
      },
      velocity: {
        ...newVelocity,
        y: 0 // 碰撞后速度为0
      }
    };
  }

  return {
    ...object,
    position: newPosition,
    velocity: newVelocity
  };
};

// 为角色应用重力
export const applyGravityToCharacter = (
  position: Position,
  velocity: Velocity,
  deltaTime: number
): { position: Position; velocity: Velocity } => {
  const characterObject: PhysicsObject = {
    position,
    velocity,
    height: CHARACTER_HEIGHT
  };

  const updatedObject = applyGravity(characterObject, deltaTime);
  return {
    position: updatedObject.position,
    velocity: updatedObject.velocity
  };
};

// 碰撞检测系统（预留接口）
export const checkCollision = (
  object1: PhysicsObject,
  object2: PhysicsObject
): boolean => {
  // 简单的AABB碰撞检测
  const distanceX = Math.abs(object1.position.x - object2.position.x);
  const distanceY = Math.abs(object1.position.y - object2.position.y);
  const distanceZ = Math.abs(object1.position.z - object2.position.z);
  
  const minDistanceX = (object1.height / 2) + (object2.height / 2);
  const minDistanceY = (object1.height / 2) + (object2.height / 2);
  const minDistanceZ = (object1.height / 2) + (object2.height / 2);
  
  return distanceX < minDistanceX && distanceY < minDistanceY && distanceZ < minDistanceZ;
};

// 处理碰撞响应（预留接口）
export const handleCollision = (
  object1: PhysicsObject,
  object2: PhysicsObject
): { object1: PhysicsObject; object2: PhysicsObject } => {
  // 简单的碰撞响应：交换速度
  const tempVelocity = { ...object1.velocity };
  
  return {
    object1: {
      ...object1,
      velocity: { ...object2.velocity }
    },
    object2: {
      ...object2,
      velocity: tempVelocity
    }
  };
};

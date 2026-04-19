import React, { useRef } from 'react';
import * as THREE from 'three';

interface BulletProps {
  position: { x: number; y: number; z: number };
  direction: THREE.Vector3;
  velocity: number;
  onExpire: () => void;
}

const Bullet: React.FC<BulletProps> = ({ position, direction, velocity, onExpire }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const creationTimeRef = useRef(Date.now());
  const bulletLifeTime = 20000;
  const gravity = -0.05;
  const currentPositionRef = useRef(new THREE.Vector3(position.x, position.y, position.z));
  const currentVelocityRef = useRef(new THREE.Vector3().copy(direction).multiplyScalar(velocity));
  const hasExpiredRef = useRef(false);
  const lastFrameTimeRef = useRef(Date.now());

  const checkCollision = () => {
    if (!meshRef.current || !meshRef.current.parent || hasExpiredRef.current) return;

    const bulletPos = meshRef.current.position;
    const bulletRadius = 0.2; // 增大子弹碰撞半径
    const targetHalfSize = 1.5;

    meshRef.current.parent.traverse((object) => {
      if (hasExpiredRef.current) return;
      
      if (object instanceof THREE.Mesh && object.userData.isTarget && object !== meshRef.current) {
        const distance = bulletPos.distanceTo(object.position);
        
        if (distance < bulletRadius + targetHalfSize) {
          if (object.userData.handleHit) {
            object.userData.handleHit();
          }
          hasExpiredRef.current = true;
          onExpire();
        }
      }
    });
  };

  const animate = () => {
    if (!meshRef.current || hasExpiredRef.current) return;

    const currentTime = Date.now();
    const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000;
    lastFrameTimeRef.current = currentTime;

    // 自动瞄准功能：检测附近的敌人并调整子弹方向
    if (meshRef.current.parent) {
      let closestTarget: THREE.Mesh | null = null;
      let closestDistance = Infinity;
      
      meshRef.current.parent.traverse((object) => {
        if (object instanceof THREE.Mesh && object.userData.isTarget && object !== meshRef.current) {
          const distance = meshRef.current!.position.distanceTo(object.position);
          if (distance < closestDistance && distance < 5) { // 减小自动瞄准范围到5
            closestDistance = distance;
            closestTarget = object;
          }
        }
      });
      
      // 如果找到目标，调整子弹方向
      if (closestTarget) {
        const bulletPos = meshRef.current.position;
        const targetPos = closestTarget.position;
        const targetDirection = new THREE.Vector3(
          targetPos.x - bulletPos.x,
          targetPos.y - bulletPos.y,
          targetPos.z - bulletPos.z
        ).normalize();
        
        // 减小转向力，使子弹调整方向更平缓
        const steeringForce = 5; // 减小转向力到5
        currentVelocityRef.current.lerp(targetDirection.multiplyScalar(velocity), steeringForce * deltaTime);
        currentVelocityRef.current.normalize().multiplyScalar(velocity);
      }
    }

    currentVelocityRef.current.y += gravity * deltaTime;

    currentPositionRef.current.add(currentVelocityRef.current.clone().multiplyScalar(deltaTime));

    meshRef.current.position.set(
      currentPositionRef.current.x,
      currentPositionRef.current.y,
      currentPositionRef.current.z
    );

    checkCollision();

    if (currentTime - creationTimeRef.current >= bulletLifeTime && !hasExpiredRef.current) {
      hasExpiredRef.current = true;
      onExpire();
    } else if (!hasExpiredRef.current) {
      requestAnimationFrame(animate);
    }
  };

  React.useEffect(() => {
    // 初始化位置和速度
    currentPositionRef.current.set(position.x, position.y, position.z);
    currentVelocityRef.current.copy(direction).multiplyScalar(velocity);
    const animationId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []); // 只在组件挂载时运行一次，避免因依赖项变化而重置动画

  return (
    <mesh ref={meshRef} position={[position.x, position.y, position.z]}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshStandardMaterial color="#ffff00" emissive="#ffff00" emissiveIntensity={0.5} />
    </mesh>
  );
};

export default Bullet;

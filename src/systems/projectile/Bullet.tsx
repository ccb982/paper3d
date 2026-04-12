import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface BulletProps {
  position: { x: number; y: number; z: number };
  direction: THREE.Vector3;
  velocity: number;
  onExpire: () => void;
}

const Bullet: React.FC<BulletProps> = ({ position, direction, velocity, onExpire }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const creationTimeRef = useRef(Date.now()); // 保存子弹创建时间
  const bulletLifeTime = 20000; // 20秒
  const gravity = -0.05; // 子弹的重力
  const currentPositionRef = useRef({ ...position });
  const currentVelocityRef = useRef(new THREE.Vector3().copy(direction).multiplyScalar(velocity));

  useEffect(() => {
    const animate = () => {
      if (!meshRef.current) return;

      // 计算时间差
      const currentTime = Date.now();
      const deltaTime = (currentTime - creationTimeRef.current) / 1000; // 转换为秒

      // 应用重力
      currentVelocityRef.current.y += gravity * deltaTime;

      // 更新位置
      currentPositionRef.current.x += currentVelocityRef.current.x * deltaTime;
      currentPositionRef.current.y += currentVelocityRef.current.y * deltaTime;
      currentPositionRef.current.z += currentVelocityRef.current.z * deltaTime;

      // 更新子弹位置
      meshRef.current.position.set(
        currentPositionRef.current.x,
        currentPositionRef.current.y,
        currentPositionRef.current.z
      );

      // 碰撞检测
      if (meshRef.current && meshRef.current.parent) {
        // 遍历场景中的所有对象，检查是否与靶子碰撞
        let targetsFound = 0;
        meshRef.current.parent.traverse((object) => {
          if (object instanceof THREE.Mesh && object.userData.isTarget && object !== meshRef.current) {
            targetsFound++;
            // 简单的球体碰撞检测（针对平面靶子）
            const distance = meshRef.current!.position.distanceTo(object.position);
            const bulletRadius = 0.1; // 子弹半径
            const targetHalfSize = 2; // 靶子半宽（增大碰撞检测范围）
            
            console.log(`Bullet at (${meshRef.current!.position.x.toFixed(2)}, ${meshRef.current!.position.y.toFixed(2)}, ${meshRef.current!.position.z.toFixed(2)})`);
            console.log(`Target at (${object.position.x.toFixed(2)}, ${object.position.y.toFixed(2)}, ${object.position.z.toFixed(2)})`);
            console.log(`Distance: ${distance.toFixed(2)}, Threshold: ${(bulletRadius + targetHalfSize).toFixed(2)}`);
            
            if (distance < bulletRadius + targetHalfSize) {
              console.log('Bullet hit target!');
              // 触发靶子被击中的回调
              if (object.userData.handleHit) {
                console.log('Calling handleHit on target');
                object.userData.handleHit();
              }
              // 子弹消失
              onExpire();
            }
          }
        });
        if (targetsFound === 0) {
          console.log('No targets found in scene');
        } else {
          console.log(`Found ${targetsFound} targets in scene`);
        }
      } else {
        console.log('Bullet has no parent or meshRef is null');
      }

      // 检查子弹是否过期
      if (currentTime - creationTimeRef.current >= bulletLifeTime) {
        onExpire();
      } else {
        requestAnimationFrame(animate);
      }
    };

    const animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [onExpire]);

  return (
    <mesh ref={meshRef} position={[position.x, position.y, position.z]}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshStandardMaterial color="#ffff00" emissive="#ffff00" emissiveIntensity={0.5} />
    </mesh>
  );
};

export default Bullet;
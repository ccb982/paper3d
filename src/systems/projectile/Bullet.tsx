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
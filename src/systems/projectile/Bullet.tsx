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
  const currentPositionRef = useRef({ ...position });
  const currentVelocityRef = useRef(new THREE.Vector3().copy(direction).multiplyScalar(velocity));
  const hasExpiredRef = useRef(false);
  const lastFrameTimeRef = useRef(Date.now());

  const checkCollision = () => {
    if (!meshRef.current || !meshRef.current.parent || hasExpiredRef.current) return;

    const bulletPos = meshRef.current.position;
    const bulletRadius = 0.1;
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

    currentVelocityRef.current.y += gravity * deltaTime;

    currentPositionRef.current.x += currentVelocityRef.current.x * deltaTime;
    currentPositionRef.current.y += currentVelocityRef.current.y * deltaTime;
    currentPositionRef.current.z += currentVelocityRef.current.z * deltaTime;

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
    const animationId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <mesh ref={meshRef} position={[position.x, position.y, position.z]}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshStandardMaterial color="#ffff00" emissive="#ffff00" emissiveIntensity={0.5} />
    </mesh>
  );
};

export default Bullet;

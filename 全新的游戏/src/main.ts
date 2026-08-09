import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { WebAdapter } from './platform/WebAdapter';

// ============================================================
// 启动引导（阶段 0：环境验证）
// 验证：three.js 渲染 + rapier 物理 + 播放器可加载
// ============================================================

async function boot() {
  const adapter = new WebAdapter();
  const canvas = adapter.createCanvas();
  document.body.appendChild(canvas);

  // ---- three.js ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(adapter.info.dpr);
  renderer.setClearColor(0x111122);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0, 0);

  const grid = new THREE.GridHelper(20, 20, 0x333355, 0x222233);
  scene.add(grid);

  // 验证用方块
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x7dd3fc }),
  );
  box.position.y = 3;
  scene.add(box);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(3, 6, 4);
  scene.add(dir);

  // ---- rapier ----
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // 地面
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10), groundBody);

  // 掉落的球（验证物理）
  const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), ballBody);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xe94560 }),
  );
  scene.add(ball);

  // ---- 主循环 ----
  let ballLanded = false;
  const clock = new THREE.Clock();
  let acc = 0;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    // 固定步长物理（1/60）
    acc += dt;
    const FIXED = 1 / 60;
    while (acc >= FIXED) {
      world.step();
      acc -= FIXED;
    }

    // 物理 → 渲染同步
    const pos = ballBody.translation();
    ball.position.set(pos.x, pos.y, pos.z);
    if (!ballLanded && pos.y <= 0.6) {
      ballLanded = true;
      console.log('[boot] rapier 物理验证通过：球落地');
    }

    // 方块浮动（验证 three 渲染循环）
    box.rotation.y += dt;

    renderer.render(scene, camera);
  }
  animate();

  console.log('[boot] three.js + rapier 环境就绪');
  console.log('[boot] 平台:', adapter.info.width + 'x' + adapter.info.height, 'dpr=' + adapter.info.dpr);
}

boot().catch((err) => console.error('[boot] 启动失败:', err));

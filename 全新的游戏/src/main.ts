import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { WebAdapter } from './platform/WebAdapter';
import { FtxAsset } from './vendor/player/FtxAsset';
import { WorldMode } from './modes/WorldMode';
import { DesktopBinding } from './platform/input/DesktopBinding';

// ============================================================
// 启动引导（播放器管线验证 → 正式游戏入口的过渡）
// 加载主角 ftx3 → WorldMode（控制 + 动画 + 渲染 + 相机跟随）
// ============================================================

async function boot() {
  const adapter = new WebAdapter();
  const canvas = adapter.createCanvas();
  document.body.appendChild(canvas);

  // 画布正方形（世界空间 0..1 一致，纹理不变形）
  const size = Math.min(window.innerWidth, window.innerHeight);
  canvas.style.position = 'fixed';
  canvas.style.left = '50%';
  canvas.style.top = '50%';
  canvas.style.transform = 'translate(-50%, -50%)';
  canvas.style.background = '#1a1a2e';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(adapter.info.dpr);
  renderer.setClearColor(0x1a1a2e, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  window.addEventListener('resize', () => {
    const s = Math.min(window.innerWidth, window.innerHeight);
    renderer.setSize(s, s);
  });

  // 加载主角纹理包（gzip 自动解压）
  const asset = await FtxAsset.load(encodeURI('/src/assets/characters/protagonist/维维美.ftx3.gz'));
  console.log('[boot] 主角已加载:', asset.frameNames().join(', '));

  // 输入绑定（桌面，双端解耦：换设备只换 Binding）
  const binding = new DesktopBinding(window);

  // 世界模式（控制 + 动画 + 渲染 + 相机跟随）
  const mode = new WorldMode(scene, camera, asset);

  // ---- rapier 物理世界（2D 玩法：游戏 x/y → 物理 x/z 平面） ----
  const physics = new RAPIER.World({ x: 0, y: 0, z: 0 });

  // 地面（参考碰撞体）
  const groundBody = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physics.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.5, 5), groundBody);

  // ★ 主角物理实体（dynamic 球体，可碰撞；位置由输入驱动，每帧同步）
  const playerBody = physics.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(5, 0, 5)
      .setLinearDamping(8)
      .setCanSleep(false),
  );
  physics.createCollider(RAPIER.ColliderDesc.ball(0.15), playerBody);
  const physicsPlayerId = playerBody.handle;
  console.log('[boot] 主角物理实体已注册 (handle=', physicsPlayerId, ')');

  // ---- 主循环 ----
  const clock = new THREE.Clock();
  let lastFrame = -1;
  let acc = 0;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    // 输入 → 控制（解耦：绑定填语义，游戏消费语义）
    binding.update();

    // 驱动世界模式（含交互消费/相机跟随/动画推进）
    mode.update(dt, binding.input, binding.consumeAttack());

    // ---- 物理步进 + 主角位置同步（游戏坐标 → 物理 x/z 平面） ----
    acc += dt;
    const FIXED = 1 / 60;
    while (acc >= FIXED) {
      // 主角位置由控制层驱动（强制同步到物理体）
      const p = mode.playerPosition;
      playerBody.setTranslation({ x: p.x, y: 0, z: p.y }, true);
      physics.step();
      acc -= FIXED;
    }

    mode.render(renderer);

    // 帧变化日志（低频）
    if (mode.frameIndex !== lastFrame) {
      lastFrame = mode.frameIndex;
      console.log(`[boot] 帧=${lastFrame} 状态=${mode.playerState} 朝向=${mode.playerFacing} flipX=${mode.playerFlipX} 位置=(${mode.playerPosition.x.toFixed(1)}, ${mode.playerPosition.y.toFixed(1)})`);
    }
  }
  animate();

  console.log('[boot] 播放器管线就绪：加载 → 动画 → 渲染 → 相机跟随 → 物理实体');
}

boot().catch((err) => console.error('[boot] 启动失败:', err));

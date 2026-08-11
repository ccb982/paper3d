import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { WebAdapter } from './platform/WebAdapter';
import { FtxAsset } from './vendor/player/FtxAsset';
import { WorldMode } from './modes/WorldMode';
import { DesktopBinding } from './platform/input/DesktopBinding';
import { generateFlatMap } from './services/map/MapGenerator';
import { MapQuery } from './services/map/MapQuery';

// ============================================================
// 启动引导（播放器管线验证 → 正式游戏入口的过渡）
// 加载主角 ftx3 → WorldMode（控制 + 动画 + 渲染 + 相机跟随）
// ============================================================

async function boot() {
  const adapter = new WebAdapter();
  const canvas = adapter.createCanvas();
  document.body.appendChild(canvas);

  // ★ 全屏画布（3D 场景，相机 aspect 自适应）
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(adapter.info.dpr);
  renderer.setClearColor(0x1a1a2e, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(20, 40, 10);
  scene.add(sun);
  // ★ 透视相机（3D 场景：地形立体感 + 斜俯视视角）
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // 加载主角纹理包（gzip 自动解压）
  const asset = await FtxAsset.load(encodeURI('/src/assets/characters/protagonist/维维美.ftx3.gz'));
  console.log('[boot] 主角已加载:', asset.frameNames().join(', '));

  // 输入绑定（桌面，双端解耦：换设备只换 Binding）
  const binding = new DesktopBinding(window);

  // ---- 地图（占位平地，64×64；等地形算法/地面素材就位后扩展） ----
  const mapData = generateFlatMap(Math.floor(Date.now() / 1000) % 100000, 64);
  const map = new MapQuery(mapData);

  // 世界模式（控制 + 动画 + 渲染 + 相机跟随 + 地图）
  const mode = new WorldMode(scene, camera, asset, map);

  // ---- rapier 物理世界（2D 玩法：游戏 x/y → 物理 x/z 平面） ----
  const physics = new RAPIER.World({ x: 0, y: 0, z: 0 });

  // 地面（参考碰撞体，匹配 64×64 地图）
  const groundBody = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  physics.createCollider(RAPIER.ColliderDesc.cuboid(32, 0.5, 32), groundBody);

  // ★ 主角物理实体（dynamic 球体，可碰撞；位置由输入驱动，每帧同步）
  const playerBody = physics.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(32, 0, 32)
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

    // 驱动世界模式（交互消费/相机跟随/动画推进；look = 鼠标视角增量）
    mode.update(dt, binding.input, binding.consumeAttack(), binding.consumeLook(), binding.consumeZoom());

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

boot().catch((err) => {
  console.error('[boot] 启动失败:', err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:8px;left:8px;color:#f66;background:#000;padding:8px;z-index:99;font:12px monospace;white-space:pre;max-width:90vw';
  d.textContent = '启动失败: ' + (err as Error).message + '\n' + String(err);
  document.body.appendChild(d);
});

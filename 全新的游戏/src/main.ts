import * as THREE from 'three';
import { WebAdapter } from './platform/WebAdapter';
import { FtxAsset } from './vendor/player/FtxAsset';
import { Asset } from './vendor/player';
import { WorldMode } from './modes/WorldMode';
import { DesktopBinding } from './platform/input/DesktopBinding';
import { PhysicsWorld } from './services/physics/PhysicsWorld';

// ============================================================
// 启动引导（实体管线驱动的正式入口）
// 加载主角 ftx3 → WorldMode（实体管线 + 相机 + 地图 + 交互）
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

  // 加载主角纹理包（gzip 自动解压；素材随构建复制进 dist/characters）
  const asset = await FtxAsset.load(encodeURI('/characters/protagonist/维维美.ftx3.gz'));
  console.log('[boot] 主角已加载:', asset.frameNames().join(', '));

  // ★ 加载爆裂黎明子弹纹理包（主角射击使用；池中 100 颗子弹共用同一资产）
  const bulletAsset = await FtxAsset.load(encodeURI('/fx/bullets/维什戴尔子弹.ftx3.gz'));
  console.log('[boot] 子弹已加载:', bulletAsset.frameNames().join(', '));

  // ★ 加载测试敌人（普瑞赛斯：特效包，2 帧前/后 + 扭曲参数）
  const enemyAsset = await Asset.load(encodeURI('/characters/enemies/普瑞赛斯.scene.zip'));
  console.log('[boot] 敌人已加载:', enemyAsset.frameNames().join(', '), '帧');

  // 输入绑定（桌面，双端解耦；点击画布 → 指针锁定/隐藏光标，可 360° 转视角）
  const binding = new DesktopBinding(window, canvas);

  // ---- 物理世界（唯一碰 rapier 的封装） ----
  const physics = new PhysicsWorld();

  // ---- 世界模式（实体管线：主角/敌人/物品实体 + 无限 chunk 地图 + 相机 + 交互） ----
  const mode = new WorldMode(scene, camera, asset, physics, enemyAsset, bulletAsset);

  // ★ 碰撞事件已由实体管线接管（EntityManager 按 userData=实体 id 分发 → 实体 onCollision）

  // ---- 主循环 ----
  const clock = new THREE.Clock();
  let acc = 0;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    // 输入 → 控制（解耦：绑定填语义，游戏消费语义）
    binding.update();

    // 世界模式（实体管线驱动 + 相机 + 交互；look/zoom 鼠标输入）
    mode.update(dt, binding.input, binding.consumeAttack(), binding.consumeLook(), binding.consumeZoom());

    // ---- 物理固定步长（角色 velocity 驱动 / 子弹 read，见 EntityBase.syncPhysics）
    //      ★ 防死亡螺旋：物理慢于帧率时最多补 5 步，追不上丢弃（否则 acc 无限累积 → 卡死） ----
    acc += dt;
    const FIXED = 1 / 60;
    let steps = 0;
    while (acc >= FIXED && steps < 5) {
      physics.step();
      acc -= FIXED;
      steps++;
    }
    if (steps >= 5) acc = 0;

    mode.render(renderer);
  }
  animate();

  console.log('[boot] 实体管线就绪：加载 → 实体基类 → 物理/动画/渲染联动');
}

boot().catch((err) => {
  console.error('[boot] 启动失败:', err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:8px;left:8px;color:#f66;background:#000;padding:8px;z-index:99;font:12px monospace;white-space:pre;max-width:90vw';
  d.textContent = '启动失败: ' + (err as Error).message + '\n' + String(err);
  document.body.appendChild(d);
});

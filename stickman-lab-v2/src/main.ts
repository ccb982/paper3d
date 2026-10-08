// ============================================================
// main —— v2 入口：wasm → Ragdoll（★ v1 原版，照搬）→ Viewer → 渲染循环
// ============================================================
// ★★★ 这里**直接用 v1 的 `Ragdoll` 类**（`core/ragdoll.ts` 是 v1 文件的字节级复制，
//   只改了 3 行 import）。执行层 = `Ragdoll.driveMotors` + `enforceLimits`
//   + 引擎电机（柔性足弓）+ `primeVelocities`，全部是 v1 的原实现。
//
//   为什么不再用 v2 自写的 `World`/`Body`/`Drive`：
//     那是我"对着 v1 抄"的产物 —— 抄漏了 `footAngularDamping`、把 `archDamping`
//     抄成旧值 2.0、把 `groundFriction` 降回 1.0 ⇒ **落地全散架**。
//     用户定调：「你为什么不能用复制粘贴，而不是自己对着代码改」——照做。

import RAPIER from '@dimforge/rapier3d';
import { initRapierWasm } from './core/rapierWasm';
import { buildSkeleton, DEFAULT_CONFIG } from './core/skeleton';
import { Ragdoll } from './core/ragdoll';
import { Viewer } from './render/viewer';

const q = new URLSearchParams(location.search);
const GRAV_OFF = q.get('grav') === 'off';
const DRIVE_OFF = q.get('drive') === 'off';

const DT = 1 / 240;          // 物理步长（v1 的 DEFAULT_SIM.physicsHz = 240）

async function boot(): Promise<void> {
  const status = document.getElementById('boot');
  const setStatus = (s: string) => { if (status) status.textContent = s; };

  setStatus('加载 rapier wasm…');
  await initRapierWasm();

  setStatus('装配骨架 / 刚体 / 关节（v1 Ragdoll）…');
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const world = new RAPIER.World({ x: 0, y: GRAV_OFF ? 0 : -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;      // ★ v1：球铰锚点在 16 迭代下才够硬（见 ragdoll 头注释）
  world.numAdditionalFrictionIterations = 8;
  const doll = new Ragdoll(world, sk, {});
  doll.reset(0);

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view canvas');

  setStatus('建渲染层…');
  const viewer = new Viewer(canvas, sk, 1, { assetBase: '' });
  viewer.followShowcase = true;

  let last = performance.now();
  let acc = 0;
  const MAX_STEPS = 8;

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= DT && n < MAX_STEPS) {
      acc -= DT; n++;
      // ★ 严格照 v1 `sim.ts:893-913` 的物理步内核（去掉 gait / 支撑点等迈步系统）：
      //   driveMotors(dt) → world.step() → enforceLimits() → primeVelocities()
      //   v1 是**每个物理步**都驱一次（力矩是连续量），controlTick 才按 controlHz 节流。
      if (!DRIVE_OFF) doll.driveMotors(DT);
      world.step();
      doll.enforceLimits();
      doll.primeVelocities();
    }
    viewer.syncShowcase(doll as never, dt);
    viewer.render();
    updateHud(now);
    requestAnimationFrame(frame);
  }

  const hud = document.getElementById('hud');
  let fpsN = 0, fpsShown = 0, fpsT = 0;
  function updateHud(now: number): void {
    fpsN++;
    if (now - fpsT > 500) {
      fpsShown = Math.round((fpsN * 1000) / (now - fpsT));
      fpsN = 0; fpsT = now;
    }
    if (!hud) return;
    const t = doll.torso().translation();
    hud.textContent =
      `FPS ${fpsShown}  |  t=${(world.timestep > 0 ? 0 : 0)}${''}\n` +
      `胸腔 y = ${t.y.toFixed(4)} m   x = ${t.x.toFixed(4)} m\n` +
      `重力=${GRAV_OFF ? 'off' : 'on'}  驱动=${DRIVE_OFF ? 'off' : 'on'}`;
  }

  setStatus('就绪');
  if (status) status.style.display = 'none';
  requestAnimationFrame((t) => { last = t; fpsT = t; frame(t); });
}

boot().catch((e) => {
  const status = document.getElementById('boot');
  if (status) {
    status.style.display = 'block';
    status.textContent = `启动失败：${e instanceof Error ? e.message : String(e)}`;
    status.style.color = '#b4331f';
  }
  console.error(e);
});

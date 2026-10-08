// ============================================================
// main —— v2 入口：wasm → World（新执行层）→ Viewer → 渲染循环
// ============================================================
// 物理层：src/core/world.ts
//   · 每个自由度 = 一个真实引擎 revolute 铰链（含引擎限位）
//   · 球窝关节 = 3×revolute 串联（Euler 分解起姿态，出生即零点）
//   · 柔性足 arch/mfoot 原样保留（引擎 ForceBased 隐式弹簧）
//   · 驱动：人类式黏弹阻尼 + 激活动力学 + 可以给任意关节下命令

import { initRapierWasm } from './core/rapierWasm';
import { World, DEFAULT_WORLD_OPTIONS } from './core/world';
import { Viewer } from './render/viewer';

const q = new URLSearchParams(location.search);
const GRAV_OFF = q.get('grav') === 'off';
const DRIVE_OFF = q.get('drive') === 'off';

async function boot(): Promise<void> {
  const status = document.getElementById('boot');
  const setStatus = (s: string) => { if (status) status.textContent = s; };

  setStatus('加载 rapier wasm…');
  await initRapierWasm();

  setStatus('装配骨架 / 串联铰链 / 执行器…');
  const sim = new World({ ...DEFAULT_WORLD_OPTIONS, gravityY: GRAV_OFF ? 0 : -9.81 });
  const DT = sim.dt;
  sim.reset();

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view canvas');

  setStatus('建渲染层…');
  const viewer = new Viewer(canvas, sim.sk, 1, { assetBase: '' });
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
      if (DRIVE_OFF) sim.driveEnabled = false;
      sim.advance(1);
    }
    viewer.syncShowcase(sim, dt);
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
    const t = sim.torso().translation();
    hud.textContent =
      `FPS ${fpsShown}\n` +
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

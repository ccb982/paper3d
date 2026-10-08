// ============================================================
// main —— v2 入口：wasm → World（执行层）→ StabilityWarner（平衡）→ Viewer
// ============================================================
// 按钮 = 动作库（actions.ts）里的脚本，全部经手动控制模块（manual.ts）
// 写入执行层；力矩回读在 Executor 账本里。

import { initRapierWasm } from './core/rapierWasm';
import { World, DEFAULT_WORLD_OPTIONS } from './core/world';
import { StabilityWarner } from './core/stability';
import { Sensors } from './core/sensors';
import { ProgramRunner } from './core/program';
import { BOW, PUSH_RISE, singleLegPhases, evalComTrack, type ActionScript } from './core/actions';
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

  setStatus('平衡控制器…');
  const bal = new StabilityWarner(sim, {
    gravityComp: true,
    comKp: 12, comKd: 5, maxForceFrac: 0.35,
    postureTone: 8,          // v1 站立档刚度（低了会慢慢塌，实测）
    lateralControl: true,
  });
  sim.controller = bal;
  sim.reset();

  // ★ 感知 + 相位节目（M1/M5）：单腿站立用**事件驱动**相位（触地保证、重心转移失败不抬腿）
  const sensors = new Sensors(sim);
  const runner = new ProgramRunner({ sensors, bal, body: sim.body });

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view canvas');

  setStatus('建渲染层…');
  const viewer = new Viewer(canvas, sim.sk, 1, { assetBase: '' });
  viewer.followShowcase = true;

  // ── 动作按钮 ──
  let activeAction: ActionScript | null = null;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#actions button'));
  const setActive = (a: ActionScript | null, btn?: HTMLButtonElement | null): void => {
    activeAction = a;
    for (const b of buttons) b.classList.toggle('active', b === btn);
  };

  function act(name: string, btn: HTMLButtonElement): void {
    switch (name) {
      case 'stand':
        runner.stop();
        bal.manual.stop(); bal.manual.clear();
        bal.setComTarget(0, 0);
        sim.controller = bal; sim.driveEnabled = true;
        setActive(null, btn);
        break;
      case 'bow':
        runner.stop();
        bal.manual.play(BOW.frames, { loop: false, holdEnd: true });
        setActive(BOW, btn);
        break;
      case 'oneleg':
        bal.manual.stop(); bal.manual.clear();
        runner.play(singleLegPhases('r', 1.2));
        setActive(null, btn);
        break;
      case 'push':
        runner.stop();
        bal.manual.play(PUSH_RISE.frames, { loop: false, holdEnd: true });
        setActive(PUSH_RISE, btn);
        break;
      case 'limp':
        runner.stop();
        bal.manual.stop(); bal.manual.clear();
        sim.controller = null;              // 松手：平衡/重力补偿全撤
        setActive(null, btn);
        break;
      case 'reset':
        runner.stop();
        bal.manual.stop(); bal.manual.clear();
        sim.controller = bal; sim.driveEnabled = true;
        sim.reset();
        bal.setComTarget(0, 0);
        setActive(null, btn);
        break;
    }
  }
  for (const b of buttons) {
    b.addEventListener('click', () => act(b.dataset.act ?? '', b));
  }

  // ── 渲染 + 物理循环 ──
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
      // 动作的 CoM 轨道（如有）每步喂给平衡控制器
      if (activeAction?.comTrack && bal.manual.isPlaying) {
        const c = evalComTrack(activeAction.comTrack, bal.manual.time);
        bal.setComTarget(c.x, c.z);
      }
      sim.advance(1);
      sensors.update(DT);
      runner.step(DT);
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
    const weight = sim.sk.massTotal * 9.81;
    const fz = (sim.body.footNormalForce('l', DT) + sim.body.footNormalForce('r', DT)) / weight * 100;
    const actName = activeAction ? `${activeAction.name}  t=${bal.manual.time.toFixed(1)}s${bal.manual.isPlaying ? '' : '（完）'}` : '站定';
    const phase = runner.current ? `${runner.current.name}  t=${runner.current.phaseT.toFixed(1)}s` : null;
    hud.textContent =
      `FPS ${fpsShown}\n` +
      `动作: ${actName}\n` +
      (phase ? `阶段: ${phase}\n` : '') +
      `胸腔 y = ${t.y.toFixed(4)} m   x = ${t.x.toFixed(4)} m\n` +
      `地面力 = ${fz.toFixed(0)}% 体重\n` +
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

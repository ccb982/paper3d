// ============================================================
// main —— v2 入口：wasm → World（执行层）→ ControlModule（控制模块）→ Viewer
// ============================================================
// 控制模块只做四件事：收命令 / 整合两提案 / 反射 / 写关节（唯一写手）。
// 按钮 → 动作层（独立系统，出提案）；执行时伺服层默默工作（控制模块每拍照跑）。

import { initRapierWasm } from './core/rapierWasm';
import { World, DEFAULT_WORLD_OPTIONS } from './core/world';
import { ControlModule } from './core/control';
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

  setStatus('控制模块…');
  const control = new ControlModule(sim, { postureTone: 8 });
  sim.controller = control;
  sim.reset();

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view canvas');

  setStatus('建渲染层…');
  const viewer = new Viewer(canvas, sim.sk, 1, { assetBase: '' });
  viewer.followShowcase = true;

  // ── 动作按钮 → 动作层（独立系统）──
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#actions button'));
  const setActive = (btn?: HTMLButtonElement | null): void => {
    for (const b of buttons) b.classList.toggle('active', b === btn);
  };

  function act(name: string, btn: HTMLButtonElement): void {
    switch (name) {
      case 'stand':
        control.actions.play('stand');
        control.manual.clear();
        control.warner.setComTarget(0, 0);
        setActive(btn);
        break;
      case 'bow':
        control.actions.play('bow');
        setActive(btn);
        break;
      case 'oneleg':
        control.actions.play('singleLegR');
        setActive(btn);
        break;
      case 'push':
        control.actions.play('pushRise');
        setActive(btn);
        break;
      case 'limp':
        control.actions.abort();
        control.manual.clear();
        sim.controller = null;              // 松手：控制模块全撤
        setActive(btn);
        break;
      case 'reset':
        control.actions.abort();
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        control.warner.setComTarget(0, 0);
        setActive(btn);
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
      sim.advance(1);                     // 控制模块在 advance 内：感知→整合→反射→写关节
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
    const st = control.actions.status;
    const actName = st.id ? `${st.id}  t=${st.t.toFixed(1)}s${st.active ? '' : '（完）'}` : '站定';
    const prop = control.lastProposal;
    const sup = prop?.support;
    const est = prop?.est;
    const tf = (v: number | undefined) => v === undefined || !isFinite(v) ? '∞' : v.toFixed(2);
    hud.textContent =
      `FPS ${fpsShown}\n` +
      `动作: ${actName}\n` +
      (st.phase ? `阶段: ${st.phase}\n` : '') +
      `预警: level=${prop?.level ?? '-'}  ${prop?.reason ?? ''}\n` +
      (sup ? `支撑: ${sup.mode}/${sup.phase} 负载${sup.loadOk ? 'ok' : 'NO'} 建议${sup.suggest}\n` : '') +
      (est ? `预测: risk=${est.risk} TTB x=${tf(est.ttbX)}s z=${tf(est.ttbZ)}s\n` : '') +
      (est ? `XCoM x=${est.xcomX.toFixed(3)} z=${est.xcomZ.toFixed(3)}\n` : '') +
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

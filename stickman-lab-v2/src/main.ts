// ============================================================
// main —— v2 入口：wasm → World（执行层）→ ControlModule（控制模块）→ Viewer
// ============================================================
// 控制模块只做四件事：收命令 / 整合两提案 / 反射 / 写关节（唯一写手）。
// 按钮 → 动作层（独立系统，出提案）；执行时伺服层默默工作（控制模块每拍照跑）。

import { initRapierWasm } from './core/rapierWasm';
import { World, DEFAULT_WORLD_OPTIONS } from './core/world';
import { ControlModule } from './core/control';
import { loadLumbar, applyLumbar } from './core/lumbarPolicy';
import { balanceScale } from './core/servo/supportReg';
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
  // ★ 腰椎策略：加载训练网页（train.html）写入的训练结果（同源 localStorage）
  const lumbar = q.get('lumbar') === 'off' ? null : loadLumbar();   // ?lumbar=off 旁路训练策略
  if (lumbar) applyLumbar(control.warner.opt, lumbar.p);
  const lumbarTag = lumbar
    ? `训练版(fit ${lumbar.meta.fit.toFixed(1)} @ ${lumbar.meta.iter})`
    : '默认';
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
      case 'squat':
        control.actions.play('squatRise');
        setActive(btn);
        break;
      case 'idle':
        control.actions.idleEnabled = !control.actions.idleEnabled;
        btn.textContent = `空闲行为：${control.actions.idleEnabled ? '开' : '关'}`;
        setActive(control.actions.idleEnabled ? btn : null);
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
  const MAX_STEPS = 32;   // 低帧率也保持实时（8 步在 30fps 下=半速慢动作）
  // ★ §2.250 帧控（用户：慢速/暂停/单帧逐帧查）
  let timeScale = 1;    // 0=暂停
  let stepRemain = 0;   // 单帧剩余物理帧数
  const pbBtn = (id: string): HTMLButtonElement | null => document.getElementById(id) as HTMLButtonElement | null;
  const setSpeed = (v: number): void => {
    timeScale = v; stepRemain = 0;
    for (const [id, val] of [['pb-slow', 0.1], ['pb-half', 0.5], ['pb-norm', 1], ['pb-pause', 0]] as const) {
      pbBtn(id)?.classList.toggle('active', v === val);
    }
  };
  pbBtn('pb-slow')?.addEventListener('click', () => setSpeed(0.1));
  pbBtn('pb-half')?.addEventListener('click', () => setSpeed(0.5));
  pbBtn('pb-norm')?.addEventListener('click', () => setSpeed(1));
  pbBtn('pb-pause')?.addEventListener('click', () => setSpeed(0));
  pbBtn('pb-step1')?.addEventListener('click', () => { setSpeed(0); stepRemain += 1; });
  pbBtn('pb-step10')?.addEventListener('click', () => { setSpeed(0); stepRemain += 10; });

  // ★ §2.253 导出本帧（用户：复制此刻关节数据和 CoP）
  let physFrames = 0;
  const exportFrame = (): void => {
    const body = sim.body as unknown as {
      dofs: Array<{ dofIndex: number; name: string; axis: number; angle: number; vel: number; tauMax: number }>;
    };
    const ctl = control as unknown as { sensors?: { com: number[]; comVel: number[]; feet: Array<Record<string, number | boolean | string>> }; warner?: unknown; drive?: unknown };
    const drv = (ctl.drive ?? (sim as unknown as { drive?: unknown }).drive) as { lastBreakdown?: Array<Record<string, number>> } | undefined;
    const s = ctl.sensors;
    const L: string[] = [];
    L.push(`# 帧导出  physFrame=${physFrames}  t=${(physFrames * DT).toFixed(4)}s`);
    if (s) {
      const mm = (v: number): string => (v * 1000).toFixed(1);
      L.push(`CoM_mm: x=${mm(s.com[0]!)} y=${mm(s.com[1]!)} z=${mm(s.com[2]!)}`);
      L.push(`CoMVel_mm_s: x=${mm(s.comVel[0]!)} y=${mm(s.comVel[1]!)} z=${mm(s.comVel[2]!)}`);
      for (const f of s.feet) {
        L.push(`foot_${f.side}: fz=${Number(f.fz).toFixed(1)}N loaded=${Boolean(f.loaded)} copValid=${Boolean(f.copValid)} copX=${mm(Number(f.copX))} copZ=${mm(Number(f.copZ))} posX=${mm(Number(f.x))} posZ=${mm(Number(f.z))}`);
      }
      try {
        const side: 'l' | 'r' = Number(s.feet[1]!.fz) >= Number(s.feet[0]!.fz) ? 'r' : 'l';
        const bs = balanceScale({ bal: ctl.warner, body, sensors: s } as unknown as Parameters<typeof balanceScale>[0], side);
        const mm2 = (v: number): string => (Number.isFinite(v) ? (v * 1000).toFixed(1) : 'NaN');
        L.push(`天平(${side}): tilt=${mm2(bs.tilt)}mm marginMed=${mm2(bs.marginMed)} marginLat=${mm2(bs.marginLat)} copVz=${mm2(bs.copVz)}mm/s TTBmed=${Number.isFinite(bs.ttbMed) ? bs.ttbMed.toFixed(3) : 'NaN'}s`);
        L.push(`MoS(XcoM): xcomZ=${mm2(bs.xcomZ)}mosMed=${mm2(bs.mosMed)}mosLat=${mm2(bs.mosLat)}mm recoverable=${bs.recoverable}`);
      } catch { /* ignore */ }
    }
    L.push('name/axis\ttau_Nm\tangle_deg\tvel_rad_s\ttauMax');
    for (const d of body.dofs) {
      const b = (drv?.lastBreakdown?.[d.dofIndex] ?? {}) as Record<string, number>;
      const tau = (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
      L.push(`${d.name}/${d.axis}\t${tau.toFixed(2)}\t${(d.angle * 57.29578).toFixed(2)}\t${d.vel.toFixed(4)}\t${d.tauMax}`);
    }
    const text = L.join('\n');
    console.log(text);
    const btn = pbBtn('pb-export');
    const done = (): void => { if (btn) { btn.textContent = '已复制✓'; setTimeout(() => { btn.textContent = '导出本帧(C)'; }, 900); } };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else done();
  };
  pbBtn('pb-export')?.addEventListener('click', exportFrame);
  window.addEventListener('keydown', (ev) => { if (ev.key === 'c' || ev.key === 'C') exportFrame(); });

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (stepRemain > 0) {
      const k = Math.min(stepRemain, MAX_STEPS);
      for (let i = 0; i < k; i++) {
        if (DRIVE_OFF) sim.driveEnabled = false;
        sim.advance(1); physFrames++;
      }
      stepRemain -= k;
      acc = 0;
    } else if (timeScale > 0) {
      acc += dt * timeScale;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) {
        acc -= DT; n++;
        if (DRIVE_OFF) sim.driveEnabled = false;
        sim.advance(1); physFrames++;      // 控制模块在 advance 内：感知→整合→反射→写关节
      }
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
      `腰椎 = ${lumbarTag}\n` +
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

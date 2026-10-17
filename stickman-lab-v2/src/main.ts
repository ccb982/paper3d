// ============================================================
// main —— v2 入口：wasm → World（执行层）→ ControlModule（控制模块）→ Viewer
// ============================================================
// 控制模块只做四件事：收命令 / 整合两提案 / 反射 / 写关节（唯一写手）。
// 按钮 → 动作层（独立系统，出提案）；执行时伺服层默默工作（控制模块每拍照跑）。

import { initRapierWasm } from './core/rapierWasm';
import { World, DEFAULT_WORLD_OPTIONS } from './core/world';
import { ControlModule } from './core/control';
import { setBaseState, baseState } from './core/servo/baseTable';
import { balanceScale } from './core/servo/supportReg';
import { upperOff, setUpperOff, setRigidUpper, rigidUpperOn, freezeUpperStep, lastRescueDbg } from './core/servo/rescue';   // ★ §2.669-671 上身力开关 + 刚体上身 + 方向力矩 UI
import { courtSetup, courtInject, courtStep, type CourtState } from './core/court';
import { supportClean } from './core/servo/supportClean';   // ★ 回正力写手：每帧双腿（正常站立也走它）   // ★ 法庭网页实装（与探针 _tmp-hold10 同流程）
import { Viewer } from './render/viewer';

const q = new URLSearchParams(location.search);
const GRAV_OFF = q.get('grav') === 'off';
const DRIVE_OFF = q.get('drive') === 'off';

// ★ 2026-10-16 浏览器 env shim（用户："无变化啊"——网页是浏览器，process.env 不存在，
//   之前所有 TR_*/SC_*/TENSION_* 环境变量在网页全部无效、一直用代码默认值！）
//   用法：URL 参数 ?TR_B0_LAT=300 或控制台 globalThis.__ENV.TR_B0_LAT=300（实时生效）
const __ENV: Record<string, string> = Object.fromEntries(q.entries());
(globalThis as Record<string, unknown>).__ENV = __ENV;
(globalThis as Record<string, unknown>).process ??= { env: __ENV };

async function boot(): Promise<void> {
  const status = document.getElementById('boot');
  const setStatus = (s: string) => { if (status) status.textContent = s; };

  setStatus('加载 rapier wasm…');
  await initRapierWasm();

  // ★ 2026-10-15 用户："这个回读是不是没种子"——?seed=N 固定随机（预历史可复现；与实验室 mulberry32(N*100+1) 同款）
  const seedQ = q.get('seed');
  if (seedQ !== null) {
    let sa = (Number(seedQ) * 100 + 1) >>> 0;
    Math.random = () => {
      sa = (sa + 0x6d2b79f5) >>> 0;
      let t = Math.imul(sa ^ (sa >>> 15), 1 | sa);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  setStatus('装配骨架 / 串联铰链 / 执行器…');
  const sim = new World({ ...DEFAULT_WORLD_OPTIONS, gravityY: GRAV_OFF ? 0 : -9.81 });
  const DT = sim.dt;

  setStatus('控制模块…');
  const control = new ControlModule(sim, { postureTone: 8 });
  control.actions.idleEnabled = true;   // ★ 2026-10-17 恢复（用户：动作层覆盖伺服——上身小力矩不影响平衡；站立已稳定）
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;   // ★ 2026-10-16 用户："让反射默认关吧"（预测层默认暂停；按钮可开）
  // ★ 2026-10-15 用户："架构不需要这个了"——腰椎训练策略已删（lumbarPolicy/lumbarTrain/train 页）
  sim.controller = control;
  sim.reset();
  let court: CourtState | null = null;
  const stepCtx = { sensors: control.sensors, bal: control.warner, body: sim.body };   // ★ 法庭模式状态（非空 = 法庭运行中）

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view canvas');

  setStatus('建渲染层…');
  const viewer = new Viewer(canvas, sim.sk, 1, { assetBase: '' });
  viewer.followShowcase = true;

  // ── 动作按钮 → 动作层（独立系统）──
  const onlyBaseEl = document.querySelector<HTMLInputElement>('#onlyBase');
  if (onlyBaseEl) {
    onlyBaseEl.addEventListener('change', () => {
      (globalThis as { __SUP_ONLY_BASE?: boolean }).__SUP_ONLY_BASE = onlyBaseEl.checked;
      console.log(`★ 抬腿后只注入基础力：${onlyBaseEl.checked ? '开' : '关'}`);
    });
  }
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#actions button'));
  const setActive = (btn?: HTMLButtonElement | null): void => {
    for (const b of buttons) b.classList.toggle('active', b === btn);
  };

  function act(name: string, btn: HTMLButtonElement): void {
    if (name !== 'court') court = null;   // 任何其他动作退出法庭模式
    switch (name) {
      case 'stand':
        control.actions.play('stand');
        control.manual.clear();
        control.warner.setComTarget(0, 0);
        setActive(btn);
        break;
      case 'bow':
        control.actions.playPart('鞠躬');   // ★ 新动作层（用户：旧关键帧遗留→重写）
        setActive(btn);
        break;
      case 'oneleg':
        // ★ 用户：保留网页随机预状态（idle 随机历史=真实鲁棒性测试）——
        //   探针已同步为随机模式（tools/_tmp-lat-robust.ts），两边一致。
        control.actions.play('singleLegR');
        setActive(btn);
        break;
      case 'push':
        control.actions.play('pushRise');   // ★ 旧路径（新层腿力矩实测侧向失稳——腿发力需蹲的专项）
        setActive(btn);
        break;
      case 'squat':
        control.actions.play('squatRise');
        setActive(btn);
        break;
      case 'g:对折': case 'g:举手': case 'g:叉腰': case 'g:抱胸': case 'g:摸头': case 'g:摸脸':
      case 'g:甩头': case 'g:晃臂': case 'g:转体': case 'g:重心移':
        control.actions.playPart(name.slice(2));
        setActive(btn);
        break;
      case 'posepreview': {
        // ★ 用户：'连重力也不要，浮在天上，只要姿势'——零重力姿势预览
        posePreview = !posePreview;
        if (posePreview) {
          sim.setGravityZero();
          // ★ 只关受力层（控制器留着——手动弹簧在控制器里，关了就没人摆姿势）
          control.warner.opt.gravityComp = false;   // 关重力补偿
          control.actions.abort();                  // ★ 用户：'除了蹲下的姿态以外别再写任何动作'
          control.actions.idleEnabled = false;
          for (const sd of ['l', 'r'] as const) {
            control.manual.setAngle(`hip_${sd}`, 2, 0.3, 2000, 80);
            control.manual.setAngle(`knee_${sd}`, 2, -2.4, 2000, 80);
            control.manual.setAngle(`foot_${sd}`, 2, -0.3, 2000, 80);
            control.manual.setAngle(`hip_${sd}`, 0, sd === 'l' ? 0.15 : -0.15, 2000, 80);   // ★ 收回外撇（膝踝对齐 z≈-15——用户：'别交叉'）
          }
        } else {
          sim.setGravity(-9.81);
          control.warner.opt.gravityComp = true;
          control.actions.idleEnabled = true;
          for (const sd of ['l', 'r'] as const) {
            control.manual.clearAngle(`hip_${sd}`, 2);
            control.manual.clearAngle(`knee_${sd}`, 2);
            control.manual.clearAngle(`foot_${sd}`, 2);
            control.manual.clearAngle(`hip_${sd}`, 0);
          }
        }
        btn.textContent = `姿势预览：${posePreview ? '开' : '关'}`;
        setActive(posePreview ? btn : null);
        break;
      }
      case 'squatstate': {
        // ★ 用户：蹲下状态——'先进入姿势之后再接受受力'（瞬移姿势→释放给三层）
        const on = baseState() === 'squat';
        if (!on) {
          // ① 先姿势：手动直接摆到蹲姿态（强弹簧瞬移；同时标记让位=三层暂不施力）
          for (const sd of ['l', 'r'] as const) {
            control.manual.setAngle(`hip_${sd}`, 2, 1.0, 400, 50);
            control.manual.setAngle(`knee_${sd}`, 2, -1.0, 400, 50);
            control.manual.setAngle(`foot_${sd}`, 2, -0.3, 400, 50);
          }
          // ② 后受力：0.5s 后释放手动→三层架构（squat 表）接管
          window.setTimeout(() => {
            for (const sd of ['l', 'r'] as const) {
              control.manual.clearAngle(`hip_${sd}`, 2);
              control.manual.clearAngle(`knee_${sd}`, 2);
              control.manual.clearAngle(`foot_${sd}`, 2);
            }
            setBaseState('squat');
          }, 700);
        } else {
          setBaseState('stand');
        }
        btn.textContent = `蹲下状态：${on ? '关' : '开'}`;
        setActive(on ? null : btn);
        break;
      }
      case 'idle':
        control.actions.idleEnabled = !control.actions.idleEnabled;
        btn.textContent = `空闲行为：${control.actions.idleEnabled ? '开' : '关'}`;
        setActive(control.actions.idleEnabled ? btn : null);
        break;
      case 'reflex': {
        // ★ 2026-10-16 用户："加按钮，手动开关反射"——__PRED_OFF_RT 运行时开关（预测层整段暂停）
        const g = globalThis as { __PRED_OFF_RT?: boolean };
        g.__PRED_OFF_RT = !(g.__PRED_OFF_RT === true);
        const off = g.__PRED_OFF_RT === true;
        btn.textContent = `反射：${off ? '关' : '开'}`;
        setActive(off ? null : btn);
        break;
      }
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
      case 'court':
        // ★ 法庭：①reset 分腿站 → ②运动学摆左腿 → ③绕踝回正 → ④零速捕获 → ⑤静置2s→放开→判死
        control.actions.abort();
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        court = courtSetup(sim, control, 2.0);
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
  let posePreview = false;   // ★ 姿势预览（零重力悬浮）
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
        L.push(`robot_criteria: Lx=${bs.Lx.toFixed(3)}kgm2/s eOrb=${bs.eOrb.toFixed(4)}m2/s2`);
        L.push(`predicted(tau=0.2s): mosPredMed=${mm2(bs.mosPredMed)}mosPredLat=${mm2(bs.mosPredLat)}mm recoverablePred=${bs.recoverablePred}`);
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
    // ★ §2.670 刚体上身（任何时刻切换都生效：世界冻结+脊柱超刚锁，独立于控制器）
    freezeUpperStep(
      sim.body as unknown as { indexByKey: Map<string, number>; bodies: Array<unknown>; dofByName(j: string, a: number): number },
      control.warner.manual as unknown as { setAngle(j: string, a: number, r: number, kp?: number, kd?: number): void; pin(j: string, a: number, v: boolean): void; clearAngle(j: string, a: number): void },
    );
    if (stepRemain > 0) {
      const k = Math.min(stepRemain, MAX_STEPS);
      for (let i = 0; i < k; i++) {
        if (posePreview) { const rb = sim.body.root(); rb.setLinvel({ x: 0, y: 0, z: 0 }, true); rb.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        if (DRIVE_OFF) sim.driveEnabled = false;
        if (court) courtInject(sim, control);
        if (!posePreview) { supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l'); }
        sim.advance(1); physFrames++;
        if (court) courtStep(sim, control, court);
      }
      stepRemain -= k;
      acc = 0;
    } else if (timeScale > 0) {
      acc += dt * timeScale;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) {
        acc -= DT; n++;
        if (DRIVE_OFF) sim.driveEnabled = false;
        if (court) courtInject(sim, control);
        if (!posePreview) { supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l'); }
        if (posePreview) { const rb = sim.body.root(); rb.setLinvel({ x: 0, y: 0, z: 0 }, true); rb.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        sim.advance(1); physFrames++;      // 控制模块在 advance 内：感知→整合→反射→写关节
        if (court) courtStep(sim, control, court);
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
    // ★ §2.671 方向力矩 UI 回读（受力解剖）：各方向链路净力矩（脊Σ/髋/膝/踝发动机电机）+ 救援量
    const drv = (control.warner as unknown as { drive: { lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number }> } }).drive;
    const tq = (n: string, a: number): number => {
      const i = sim.body.dofByName(n, a);
      if (i < 0) return 0;
      const d0 = sim.body.dofs[i]!;
      if (d0.engineMotor) return (d0 as unknown as { motorTqEst?: number }).motorTqEst ?? 0;
      const b = drv.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      return b.act + b.servo + b.stiff + b.damp;
    };
    const dirRow = (axis: number): string => {
      const spine = tq('spine1', axis) + tq('spine2', axis) + tq('spine3', axis);
      const hip = tq('hip_r', axis), knee = tq('knee_r', axis), ank = tq('foot_r', axis);
      return `脊${spine.toFixed(0).padStart(5)} 髋${hip.toFixed(0).padStart(5)} 膝${knee.toFixed(0).padStart(4)} 踝${ank.toFixed(0).padStart(5)} Σ${(spine + hip + knee + ank).toFixed(0).padStart(5)}`;
    };
    hud.textContent =
      `FPS ${fpsShown}\n` +
      `动作: ${actName}\n` +
      (st.phase ? `阶段: ${st.phase}\n` : '') +
      (court ? (court.released
        ? `法庭: ★★★已放开★★★ 放开于 t=${court.settle.toFixed(1)}s｜当前 t=${court.t.toFixed(2)}s（自由）`
        : `法庭: 静置中(扶) t=${court.t.toFixed(1)}/${court.settle.toFixed(1)}s — ${(court.settle - court.t).toFixed(1)}s 后放开`)
        + ` com=(${(control.sensors.com[0]! * 100).toFixed(1)},${(control.sensors.com[2]! * 100).toFixed(1)})cm tilt=(p${(control.sensors.torsoTilt[0]! * 57.3).toFixed(1)},r${(control.sensors.torsoTilt[1]! * 57.3).toFixed(1)})°${court.fall >= 0 ? `  ✗倒下@${court.fall.toFixed(2)}s ${court.reason}` : '  ✓站住'}\n` : '') +
      `预警: level=${prop?.level ?? '-'}  ${prop?.reason ?? ''}\n` +
      (sup ? `支撑: ${sup.mode}/${sup.phase} 负载${sup.loadOk ? 'ok' : 'NO'} 建议${sup.suggest}\n` : '') +
      (est ? `预测: risk=${est.risk} TTB x=${tf(est.ttbX)}s z=${tf(est.ttbZ)}s\n` : '') +
      (est ? `XCoM x=${est.xcomX.toFixed(3)} z=${est.xcomZ.toFixed(3)}\n` : '') +
      `胸腔 y = ${t.y.toFixed(4)} m   x = ${t.x.toFixed(4)} m\n` +
      `地面力 = ${fz.toFixed(0)}% 体重\n` +
      `方矩左右: ${dirRow(0)}\n` +
      `方矩前后: ${dirRow(2)}\n` +
      `救援[前=${lastRescueDbg.sagD.toFixed(2)} 左=${lastRescueDbg.latRollD.toFixed(2)}] 上身力=${upperOff() ? '关' : '开'} 刚体=${rigidUpperOn() ? '开' : '关'}\n` +
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

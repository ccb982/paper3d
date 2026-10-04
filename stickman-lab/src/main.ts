// ============================================================
// main —— 装配：wasm → 骨架 → 竞技场（进化训练）→ 展示个体 → 渲染
// ============================================================
// 两个 Sim 分工：
//   trainer 里的 population 个 Sim —— 闷头跑分，不渲染（大头开销在这）
//   showcase 这 1 个 Sim            —— 只渲染它，跑完一轮就换上"历史最佳"重跑
// 这样训练吞吐和画面稳定互不干扰：最优个体在进化，你眼前看到的就是"当前的最优"。

import { initRapierWasm } from './core/rapierWasm';
import {
  DEFAULT_CONFIG, assertColliderMass, assertMassBudget, buildSkeleton, type Skeleton,
} from './core/skeleton';
import { shapeForJoints, type BrainShape } from './core/brain';
import { DEFAULT_TRAINER, Trainer } from './core/evolution';
import { Controller, DEFAULT_CONTROLLER, type ControllerConfig } from './core/controller';
import { DEFAULT_LAB, labHash, labFromQuery, labToQuery, type LabState } from './core/lab';
import { DEFAULT_SIM, Sim, type SimConfig, type SimMode } from './core/sim';
import { packGenome, unpackGenome } from './core/genome';
import {
  clearLocal, loadLocal, packSession, saveLocal, sizeKb, unpackSession,
} from './core/persist';
import { Viewer } from './render/viewer';
import { Hud } from './ui/hud';

// ★ state 必须在 new Hud 之前：Hud 构造时会立刻触发一次滑块的初始回调，
//   若 state 还在 TDZ 里就会直接 ReferenceError 崩在启动阶段。
/**
 * ★ 运行配置**只有一份**，在 `core/lab.ts`。网页与探针都从那里取。
 *   （此前这里硬编码 `mode:'walk'`，而 UI 的相位滑块只有 walk/fight 两档，
 *     导致 `stand` —— 也就是平衡的验收口径 —— 在网页上根本选不到。）
 */
const state = {
  ...DEFAULT_LAB,
  paused: false,
  budgetMs: 6,
  speed: 1,
  axisMarkers: true,
  ghost: false,
  joints: false,
  textures: true,
};
/** URL 查询串优先（?mode=stand&driver=teacher…）⇒ 可以直接把探针的链接贴到浏览器 */
{
  const q = labFromQuery(location.search.slice(1));
  if (q) Object.assign(state, q);
}

let sk: Skeleton;
let SHAPE: BrainShape;
let trainer: Trainer;
let showcase: Sim;
let viewer: Viewer;

/** ★ Hud 构造期间的初始回调要挡掉：那时 trainer / viewer 都还没建 */
let booted = false;

const hud = new Hud({
  onPause: () => { if (booted) state.paused = !state.paused; },
  onResetPopulation: () => { if (booted) trainer.resetPopulation(); },
  onRespawn: () => {
    if (!booted) return;
    // ★ teacher 驱动下，光 begin() 不够 —— 会话状态（闩锁/计时）也要清
    if (state.driver === 'teacher') resetSession(); else showcase.begin(trainer.showcase());
  },
  onExport: () => { if (booted) doExport(); },
  onImport: () => { if (booted) doImport(); },
  onGhost: () => { if (booted) { state.ghost = !state.ghost; viewer.showGhost = state.ghost; } },
  // ★ 3D 地面方向标开关（左=+Z / 右=−Z / 前=+X，见 viewer 的 AXIS_CONVENTION）
  onAxisMarkers: (on: boolean) => { state.axisMarkers = on; if (booted) viewer.setAxisMarkers(on); },
  onJoints: () => { if (booted) { state.joints = !state.joints; viewer.showJoints = state.joints; } },
  onTextures: () => { if (booted) { state.textures = !state.textures; viewer.showTextures = state.textures; } },
  onSigma: (v) => { if (booted) trainer.sigma = v; },
  onBudget: (v) => { state.budgetMs = v; },
  onSpeed: (v) => { state.speed = v; },
  onPhase: (m) => { if (booted && m !== state.mode) rebuild(m); },
  // ★ 切驱动源：teacher ⇄ ES 大脑。调平衡维持系统时必须切到 teacher ——
  //   否则网页渲染的是大脑输出，你在 balanceHold.ts 里的改动在网页上看不到。
  onDriver: (d) => {
    if (!booted) return;
    state.driver = d; session = null;
    if (d === 'teacher') resetSession(); else showcase.begin(trainer.showcase());
  },
  onSingleLeg: (side: 'l' | 'r', liftHold: number) => {
    if (!booted) return;
    state.startBearer = side; state.liftHold = liftHold;
    session = null;
    if (state.driver === 'teacher') resetSession(); else showcase.begin(trainer.showcase());
  },
  onDur: (d) => { if (!booted || Math.abs(d - state.dur) < 1e-6) return; state.dur = d; rebuild(state.mode); },
  // ★ 步态奖励可调项：直通到 Trainer（转发给整代 Sim，下一 tick 生效）
  onGaitTune: (o) => { if (booted) trainer.applyWalkWeights(o); },
});

/** 物理步的实测平均耗时（指数滑动平均）——预算按 ms 给，步数靠它换算 */
let perStepMs = 0.03;

function simCfg(s: LabState): SimConfig {
  return { ...DEFAULT_SIM, mode: s.mode as SimMode, duration: s.dur };
}

function boot(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view 画布');

  // ---- 骨架自检（先证伪再做昂贵的初始化） ----
  assertMassBudget();
  sk = buildSkeleton(DEFAULT_CONFIG);
  assertColliderMass(sk);
  // ★ 网络形状跟着骨架走（脊柱分段后关节数不再是 9）
  SHAPE = shapeForJoints(sk.joints.length);

  trainer = new Trainer(sk, SHAPE, simCfg(state), DEFAULT_TRAINER);
  showcase = new Sim(sk, SHAPE, simCfg(state));
  viewer = new Viewer(canvas, sk, trainer.population, { showAxisMarkers: state.axisMarkers });
  {
    // 把 checkbox 的初值同步进 viewer（Hud 构造期的回调被 booted 挡掉了）
    const cb = document.getElementById('own-axis3d') as HTMLInputElement | null;
    if (cb) { cb.checked = state.axisMarkers; viewer.setAxisMarkers(state.axisMarkers); }
  }

  showcase.begin(trainer.showcase());
  booted = true;
  const restored = tryRestore();     // ★ 刷新页面后自动接着训（localStorage 存档）

  hud.setStatus(
    (restored ? '已恢复存档 · ' : '就绪 · ')
    + `${sk.bodies.length} 刚体 ${sk.joints.length} 关节（${sk.joints.length * 3} 转动自由度） ` +
    `体重 ${sk.massTotal.toFixed(1)}kg 身高 ${sk.totalHeight.toFixed(2)}m ` +
    `参数 ${trainer.paramCount} 个`,
  );

  wireKeyboard(canvas);
  wirePointer(canvas);
  window.addEventListener('resize', () => viewer.resize());
  // ★ 首帧补一次 resize：boot 时画布可能还没完成布局，Viewer 构造里那次读到的是 0。
  //   不补的话画面会停在极小的视口（症状：只有 UI，看不到骨骼）。
  viewer.resize();
  requestAnimationFrame(() => viewer.resize());

  // 离屏验收用的调试入口（浏览器控制台 / CDP 都能驱动）
  (window as unknown as Record<string, unknown>).STICKMAN = {
    get trainer() { return trainer; },
    get showcase() { return showcase; },
    get viewer() { return viewer; },
    get skeleton() { return sk; },
    state,
    rebuild,
    exportText: () => packGenome(trainer.showcase(), SHAPE, {
      gen: trainer.gen, fitness: trainer.bestEverFitness, note: `stickman-lab/${state.mode}`,
    }),
  };

  requestAnimationFrame(frame);
}

/** 切换阶段（走路 / 战斗）：重建两套 Sim 并把已学到的基因组带过去 */
function rebuild(mode: SimMode): void {
  state.mode = mode;
  session = null;          // ★ teacher 会话指着旧 showcase，必须作废重建
  const carry = trainer.bestEver.slice();
  const learned = trainer.bestEverFitness > -Infinity;

  trainer = new Trainer(sk, SHAPE, simCfg({ ...state, mode }), DEFAULT_TRAINER);
  tryRestore();          // ★ 有存档就自动恢复（刷新页面不丢）
  if (learned) trainer.inject(carry);

  showcase = new Sim(sk, SHAPE, simCfg({ ...state, mode }));
  showcase.begin(trainer.showcase());
  hud.setHistory(trainer.history);
  hud.setStatus(`切换到「${mode === 'walk' ? '学走路' : '学战斗'}」${learned ? '（已继承之前的基因组）' : ''}`);
}

// ---------------------------------------------------------------- 帧循环

let last = performance.now();
let stepsAccum = 0;
let stepsWindowStart = performance.now();
let stepsPerSec = 0;

/**
 * ★★★ 手写控制器的会话（`driver === 'teacher'` 时用它推进 showcase）。
 *
 *   ⚠ `driver` 的取值 `'teacher'` 是**历史遗留名**：它原本指已删除的
 *   `core/teacher.ts`（`TeacherSession`），现在这里建的是 `Controller` ——
 *   与 `tools/probe-*.ts` 跑的是同一份重构后代码。
 *   取值不能改（它在用户可见的 `?driver=teacher` 与 localStorage 里）。
 *
 *   历史：此前网页只会 `showcase.advance()`，也就是只跑 ES 大脑 ⇒ 网页上
 *   根本看不到手写平衡维持系统；改成由 Controller 分帧推进后才一致。
 */
let session: Controller | null = null;

/**
 * ★ 重建控制器。`Sim` 必须以 `driver:'controller'` 跑，
 *   否则 `controlTick` 会把控制器的马达目标覆盖成零基因组的输出
 *   （历史事故：控制器全程开环，表现为"增益扫描所有行结果一样"）。
 */
function resetSession(): void {
  showcase.begin(trainer.showcase());
  showcase.cfg.driver = 'controller';
  session = new Controller(sk, showcase, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: state.startBearer, liftHold: state.liftHold },
  } as ControllerConfig);
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const t0 = performance.now();

  if (!state.paused) {
    // ---- 训练：按 ms 预算换算成物理步数 ----
    const steps = Math.max(1, Math.round(state.budgetMs / Math.max(1e-4, perStepMs)));
    trainer.tick(steps);
    autosave();          // ★ 内部按代数去重：新代才写一次 localStorage

    // ---- 展示个体：按真实时间推进（受播放速度倍率控制） ----
    const want = Math.max(1, Math.round(dt * DEFAULT_SIM.physicsHz * state.speed));
    if (state.driver === 'teacher') {
      if (!session) resetSession();
      // 每个控制拍跑一次控制器，其余物理步只推进
      const cdt = 1 / showcase.cfg.controlHz;
      const per = Math.max(1, Math.round(1 / showcase.cfg.physicsHz / cdt));
      for (let k = 0; k < Math.max(1, Math.round(want / per)); k++) {
        if (showcase.finished) { resetSession(); break; }
        const out = session!.step(cdt);
        showcase.doll.setMotorTargets(out);
        session!.soleClearance('l'); session!.soleClearance('r');
        for (let q = 0; q < per; q++) showcase.advance(1);
      }
    } else {
      session = null;
      showcase.cfg.driver = 'brain';
      showcase.advance(want);
      if (showcase.finished) showcase.begin(trainer.showcase());
    }
  }

  const frameMs = performance.now() - t0;

  // 实测每步耗时（EWMA），供下一帧换算预算
  const usedSteps = Math.max(1, trainer.stepsLastFrame);
  perStepMs = perStepMs * 0.9 + (frameMs / usedSteps) * 0.1;

  stepsAccum += trainer.stepsLastFrame;
  if (now - stepsWindowStart > 500) {
    stepsPerSec = (stepsAccum * 1000) / (now - stepsWindowStart);
    stepsAccum = 0;
    stepsWindowStart = now;
  }

  viewer.showGhost = state.ghost;
  viewer.showJoints = state.joints;
  viewer.showTextures = state.textures;
  viewer.syncShowcase(showcase.doll, dt);
  viewer.syncGhost(trainer);
  viewer.render();

  hud.setHistory(trainer.history);
  // ★★ 「模块归属」面板：平衡维持 vs 迈步 + 前后腿/承重腿（用户 2026-10-03）。
  //   数据全部来自 teacher 会话自己的 diag，UI 不自己推断归属。
  // ★ 只把 `Controller` 的快照交给 UI —— 冒烟测试读的是同一份对象
  if (state.driver === 'teacher' && session) hud.setOwnership(session.snapshot);
  else hud.setOwnership(null);
  //★★ 配置指纹：状态栏常驻显示，探针也打印同一个串 —— 两边对不上就能一眼看出。
  hud.setStatus(`配置 ${labHash(state)}  ·  ${labToQuery(state)}`);
  hud.update({
    paused: state.paused,
    mode: state.mode,
    driver: state.driver,
    startBearer: state.startBearer,
    gen: trainer.gen,
    evaluated: trainer.evaluated,
    population: trainer.population,
    bestNow: trainer.bestNowFitness,
    bestEver: trainer.bestEverFitness,
    bestDist: trainer.bestDistNow,
    bestFallen: trainer.bestFallenNow,
    hits: trainer.hitsNow,
    hurts: trainer.hurtsNow,
    sigma: trainer.sigma,
    budgetMs: state.budgetMs,
    speed: state.speed,
    stepsPerSec,
    frameMs,
    ghost: state.ghost,
    joints: state.joints,
    textures: state.textures,
  });
}

// ---------------------------------------------------------------- 输入

function wireKeyboard(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    switch (ev.key.toLowerCase()) {
      case ' ': ev.preventDefault(); state.paused = !state.paused; break;
      case 'r': if (state.driver === 'teacher') resetSession(); else showcase.begin(trainer.showcase()); break;
      case 'g': state.ghost = !state.ghost; break;
      case 'j': state.joints = !state.joints; break;
      case 't': state.textures = !state.textures; break;
      case 'e': doExport(); break;
      case 'v': viewer.resetView(); break;
      default: break;
    }
  });
  canvas.addEventListener('dblclick', () => {
    if (state.driver === 'teacher') resetSession(); else showcase.begin(trainer.showcase());
  });
}

/**
 * 指针：拖拽转视角 / 滚轮推拉 / 右键复位。
 * ★ 3D 之后这一条是**必要**的（不是锦上添花）：正面视图的素材与行走步态的最佳
 *   观察角度差 90°，只给一个固定机位必然有一头看不清楚，得让人自己转。
 */
function wirePointer(canvas: HTMLCanvasElement): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (booted) viewer.orbit(dx * 0.007, dy * 0.005);
  });
  const end = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* 已释放 */ }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (booted) viewer.resetView();
  });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (booted) viewer.zoom(ev.deltaY > 0 ? 1.08 : 1 / 1.08);
  }, { passive: false });
}

/**
 * ★★ 自动存档（用户 2026-10-01："刷新一下页面就没了，也存不下来"）。
 *   每个新代写一次 localStorage（含随机数状态 ⇒ 刷新后从原来那一步继续训），
 *   写失败（隐私模式/配额满）只在状态栏提示一次，不打断训练。
 */
let lastSavedGen = -1;
let saveWarned = false;
function autosave(force = false): void {
  if (!booted) return;
  if (!force && trainer.gen === lastSavedGen) return;
  lastSavedGen = trainer.gen;
  const text = packSession({ ...trainer.snapshot(), mode: state.mode, note: `stickman-lab/${state.mode}` });
  if (saveLocal(text)) {
    if (force) hud.setStatus(`已自动存档 · ${sizeKb(text).toFixed(1)} KB · gen ${trainer.gen}`);
  } else if (!saveWarned) {
    saveWarned = true;
    hud.setStatus('⚠ 自动存档失败（浏览器禁用 localStorage？训练仍可继续，请用"导出"手动保存）', true);
  }
}

/** 启动时读档；返回是否成功 */
function tryRestore(): boolean {
  const text = loadLocal();
  if (!text) return false;
  try {
    const s = unpackSession(text, SHAPE, trainer.paramCount, trainer.population);
    if (s.mode !== state.mode) return false;             // 模式不同就不自动加载
    trainer.restore(s);
    if (state.driver === 'teacher') resetSession(); else showcase.begin(trainer.showcase());
    lastSavedGen = trainer.gen;
    hud.setStatus(`已从存档恢复：gen ${trainer.gen} · σ=${trainer.sigma.toFixed(4)}`
      + ` · 历史最优 ${trainer.bestEverFitness.toFixed(2)}`);
    return true;
  } catch (e) {
    clearLocal();                                       // 坏档直接丢掉，别反复报错
    hud.setStatus(`存档已损坏，已丢弃：${(e as Error).message}`, true);
    return false;
  }
}

function doExport(): void {
  const text = packSession({ ...trainer.snapshot(), mode: state.mode, note: `stickman-lab/${state.mode}` });
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stickman-session-${state.mode}-gen${trainer.gen}.json`;
  a.click();
  URL.revokeObjectURL(url);
  hud.setStatus(`已导出训练会话（含种群/σ/RNG）· ${sizeKb(text).toFixed(1)} KB`);
}

function doImport(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    f.text().then((text) => {
      try {
        const s = unpackSession(text, SHAPE, trainer.paramCount, trainer.population);
        trainer.restore(s);
        if (state.driver === 'teacher') resetSession(); else showcase.begin(trainer.showcase());
        lastSavedGen = trainer.gen;
        autosave(true);
        hud.setStatus(`已导入训练会话：gen ${s.gen} · σ=${s.sigma.toFixed(4)}`
          + ` · 历史最优 ${s.bestEverFitness.toFixed(2)}`);
      } catch (e) {
        hud.setStatus(`导入失败：${(e as Error).message}`, true);
      }
    });
  });
  input.click();
}

// ---------------------------------------------------------------- 启动

(async () => {
  try {
    hud.setStatus('正在实例化 rapier wasm…');
    await initRapierWasm();
    hud.setStatus('正在装配骨架…');
    boot();
  } catch (e) {
    const err = e as Error;
    hud.setStatus(`启动失败：${err.message}`, true);
    // 把完整堆栈也打出来，离屏验收时能从 console 里捞到原因
    console.error('[stickman-lab] 启动失败', err);
  }
})();

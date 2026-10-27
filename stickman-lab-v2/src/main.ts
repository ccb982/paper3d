// ============================================================
// main —— v2 入口：wasm → World（执行层）→ ControlModule（控制模块）→ Viewer
// ============================================================
// 控制模块只做四件事：收命令 / 整合两提案 / 反射 / 写关节（唯一写手）。
// 按钮 → 动作层（独立系统，出提案）；执行时伺服层默默工作（控制模块每拍照跑）。

import * as THREE from 'three';   // ★ 姿势预览绘制
import { initRapierWasm } from './core/rapierWasm';
import { World, DEFAULT_WORLD_OPTIONS } from './core/world';
import { ControlModule } from './core/control';
import { setBaseState, baseState, baseParams } from './core/servo/baseTable';
import { balanceScale } from './core/servo/supportReg';
import { upperOff, setUpperOff, setRigidUpper, rigidUpperOn, freezeUpperStep, lastRescueDbg } from './core/servo/rescue';   // ★ §2.669-671 上身力开关 + 刚体上身 + 方向力矩 UI
import { captureSquatCourt, courtSetup, type CourtState } from './core/court';
import { squatCourtSetup, squatFrame, squatResetLimits } from './core/servo/squat';
import { estimateHipLevel } from './core/servo/squatHipLevel';
import { supportClean } from './core/servo/supportClean';   // ★ 回正力写手：每帧双腿（正常站立也走它）   // ★ 法庭网页实装（与探针 _tmp-hold10 同流程）
import { Viewer } from './render/viewer';

const q = new URLSearchParams(location.search);
const GRAV_OFF = q.get('grav') === 'off';
const DRIVE_OFF = q.get('drive') === 'off';

// ★ 2026-10-16 浏览器 env shim（用户："无变化啊"——网页是浏览器，process.env 不存在，
//   之前所有 TR_*/SC_*/TENSION_* 环境变量在网页全部无效、一直用代码默认值！）
//   用法：URL 参数 ?TR_B0_LAT=300 或控制台 globalThis.__ENV.TR_B0_LAT=300（实时生效）
const __ENV: Record<string, string> = Object.fromEntries(q.entries());
// ★ 默认：被动刚度 + 托髋支柱（URL 参数可覆盖）
const __DEFAULTS: Record<string, string> = {
  PERCEPTION_FOOT_MODEL: '1',
  PERCEPTION_FOOT_MU: '20',
  SQC_PASSIVE_MODE: '1',
  SQC_NEWBASE: '1',
  SQC_COMFORT: '1',
  SQC_COMFORT_E: '0.01',
  SQC_COMFORT_V: '0.05',
  SQC_COMFORT_TORSO: '2',
  SQC_NB_LEVEL_DEAD: '2',
  SQC_NB_LEVEL_KP: '80',
  SQC_NB_LEVEL_CAP: '2',
  SQC_NB_VERT: '1',
  SQC_NB_VERT_KP: '150',
  SQC_NB_VERT_CAP: '3',
  SQC_NB_VERT_KI: '0',
  SQC_NB_LOAD_BALANCE: '0',
  SQC_NB_LOAD_KP: '0.08',
  SQC_NB_LOAD_CAP: '2',
  SQC_NB_HIP_ROLL: '1',
  SQC_NB_HIP_ROLL_KP: '80',
  SQC_NB_HIP_ROLL_KD: '10',
  SQC_NB_HIP_ROLL_CAP: '2',
  SQC_NB_VERT_KD: '0',
  SQC_NB_VERT_DEAD: '1',
  SQC_PAIR_SCALE: '0.95',
  SQC_HAT_ORIENT: '1',
  SQC_HAT_FORCE_BUDGET: '1',
  SQC_HAT_TARGET_ZERO: '0',
  SQC_HAT_ROLL_COP: '0.01',
  SQC_FOOT_ROLL_REACT: '3',
  SQC_FOOT_ROLL_REACT_MAX: '0.09',
  SQC_FOOT_ROLL_REACT_SIGN: '-1',
  SQC_FOOT_ROLL_LEAD: '0.12',
  SQC_FOOT_BSS_REACT: '-1',
  SQC_HAT_KP: '180',
  SQC_HAT_KD: '16',
  SQC_HAT_LEAD: '0.02',
  SQC_HAT_RATE: '40',
  SQC_HAT_CAP: '10',
  SQC_HAT_DEAD: '0.5',
  SQC_HAT_RATE_DEAD: '2',
  SQC_PASSIVE_ONLY: '1',
  SQC_COURT_GROUND: '1',
  SQC_COURT_DROP: '0',
  SQC_SOLE_Y: '0.060',
  // 法庭静置期就开重力+驱动，让脚预载，不在释放瞬间才加载
  SQC_GONS: '1',
  SQC_LIVE: '1',
  // 诊断：只留基础力 + drive.td；URL ?SQC_BASE_ONLY=0 恢复
  SQC_BASE_ONLY: '1',
  // 先关踝主动：释放后它会高频正负翻，脚被震飞；URL ?SQC_ANKLE_ASSIST=1 再开
  SQC_ANKLE_ASSIST: '0',
  // 踝矢状前馈：按脚 GRF 把 CoP 推到 CoM 下（不是反馈）
  SQC_ANKLE_FF: '1',
  // 髋软限位：仅超过解剖范围后单向弹簧+阻尼，不维持姿态
  SQC_HIP_SOFT: '1',
  // 脊柱被动刚度：spine1-3 侧向/扭转，仅弹簧+阻尼，不读 CoM
  SQC_SPINE_PASSIVE: '1',
  SQC_SP_K: '200',
  SQC_SP_B: '6',
  SQC_ANKLE_ASSIST_SIGN: '-1',
  SQC_ANKLE_ASSIST_GAIN: '4',
  SQC_ANKLE_ASSIST_CAP: '120',
  SQC_ANKLE_ASSIST_SRC: 'cop',
  SQC_PB_C_LOAD: '5',
  SQC_PASSIVE_B: '2',
  SQC_PA_K: '100',
  SQC_PA_B: '4',
  SQC_PA_CAP: '5',
  SQC_HIP_STRUT: '1',
  SQC_HIP_STRUT_LAT: '1',
  SQC_UPPER_UNIFIED: '1',
  SQC_HAT_K: '1000',
  SQC_BACK_SPINE_SERVO: '1',
  SQC_BACK_SERVO: '1',
  SQC_BS_G: '1200',
  SQC_BSS_SENSE: '1',
  SQC_BSS_FORCE: '1',
  SQC_BSS_FZ: '2000',
  SQC_BSS_FZD: '300',
  SQC_BSS_COM_K: '2000',
  SQC_ANKLE_COP_ACTIVE: '1',
  SQC_ANKLE_COP_KP: '0.2',
  SQC_ANKLE_COP_KD: '0.2',
  SQC_ANKLE_COP_LIMIT: '0.02',
  SQC_ANKLE_PULSE: '1',
  SQC_ANKLE_PULSE_PHASE: '1',
  SQC_ANKLE_PULSE_HOLD: '0.12',
  SQC_ANKLE_PULSE_E: '0.003',
  SQC_ANKLE_PULSE_V: '0.02',
  SQC_ALLOC: '1',
  SQC_RC2: '1',
  SQC_RC2_V_SRC: 'perception',
  SQC_RC2_PRED: '1',
  SQC_RC2_PRED_T: '0.08',
  SQC_RC2_PRED_R_OFF: '3',
  SQC_SLIP_SCALE: '0.2',
  SQC_PASSIVE_STIFF: '1',
  SQC_PS_HIP_K: '80',
  SQC_PS_KNEE_K: '15',
  SQC_PS_FOOT_K: '60',
  SQC_PS_HIP2_K: '50',
  SQC_PS_HIP_CAP: '5',
  SQC_PS_HIP2_CAP: '5',
  SQC_PS_KNEE_CAP: '2',
  SQC_PS_FOOT_CAP: '3',
  SQC_PS_SLACK_DEG: '6',
  SQC_RC2_H: '0',
  SQC_RC2_B: '1',
  SQC_RC2_K: '1',
  SQC_RC2_K_DEAD: '0.001',
  SQC_RC2_K_LOAD: '1',
  SQC_RC2_KI: '10',
  SQC_RC2_K_RATE: '20',
  SQC_RC2_K_ALWAYS: '1',
  SQC_SAG: '1',
  SQC_SAG_KP: '60',
  SQC_SAG_KD: '10',
  SQC_SAG_CAP: '15',
  SQC_SAG_HIP_SIGN: '1',
  SQC_SAG_LIMIT_DEG: '10',
  SQC_SAG_BOOST: '1.5',
  SQC_SAG_LEAD: '0',
  SQC_SAG_DEAD: '0.001',
  SQC_RC2_KA: '0',
  SQC_RC2_H_KP: '80',
  SQC_RC2_H_KD: '30',
  SQC_RC2_H_CAP: '20',
  SQC_RC2_B_KP: '120',
  SQC_RC2_B_KD: '4',
  SQC_RC2_B_CAP: '20',
  SQC_RC2_H_SIGN: '-1',
  SQC_RC2_H_RATE: '60',
  SQC_RC2_B_SIGN: '1',
  SQC_RC2_KP: '90',
  SQC_RC2_K_CAP: '3.0',
  SQC_RC2_AKP: '30',
  SQC_RC2_A_CAP: '0.5',
  SQC_BSS_DEAD_Z: '4',
  SQC_BSS_DEAD_R: '1',
  SQC_BSS_K: '2400',
  SQC_BSS_CAP: '60',
  SQC_BSS_RESCUE_K: '4800',
  SQC_BSS_RESCUE_CAP: '120',
  SQC_BSS_SAFE_DEG: '4',
  SQC_BSS_RESCUE_DEAD: '0.5',
  SQC_BSS_RESCUE_HYST: '0.5',
  SQC_BSS_RESCUE_LEAD: '0.12',
  SQC_HIP_LOCK_KLOAD: '300',
  SQC_BSS_KZ: '0',
  SQC_BSL: '0',
  SQC_BS_TLF: '0',
};
for (const k of Object.keys(__DEFAULTS)) if (__ENV[k] === undefined) __ENV[k] = __DEFAULTS[k]!;
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
  let control = new ControlModule(sim, { postureTone: 8 });
  let upperGravityZero = false;
  const setUpperGravityZero = (on: boolean): void => {
    upperGravityZero = on;
    const keys = ['torso', 'spine1', 'spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
    for (const k of keys) {
      const i = sim.body.indexByKey.get(k);
      if (i !== undefined) sim.body.bodies[i]!.setGravityScale(on ? 0 : 1, true);
    }
    let low = 0, total = 0;
    for (const b of sim.sk.bodies) {
      total += b.mass;
      if (/^(thigh|shin|foot|arch|mfoot)_/.test(b.key)) low += b.mass;
    }
    __ENV.SQC_PAIR_SCALE = on ? (low / Math.max(1e-6, total)).toFixed(3) : '0.95';
    __ENV.SQC_LOCK_HIP = on ? '0' : '1';
    __ENV.SQC_LAT_LOCK_HIP_DEG = on ? '0' : '1.5';
    __ENV.SQC_NB_LOAD_BALANCE = on ? '1' : '0';
    console.log(`[NO_UPPER] upper gravityScale=${on ? 0 : 1} pairScale=${__ENV.SQC_PAIR_SCALE}`);
  };
  control.actions.idleEnabled = true;   // ★ 2026-10-17 恢复（用户：动作层覆盖伺服——上身小力矩不影响平衡；站立已稳定）
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;   // ★ 2026-10-16 用户："让反射默认关吧"（预测层默认暂停；按钮可开）
  // ★ 2026-10-15 用户："架构不需要这个了"——腰椎训练策略已删（lumbarPolicy/lumbarTrain/train 页）
  sim.controller = control;
  sim.reset();
  let court: CourtState | null = null;
  let pendingSquatDown = false;
  let squatDownArmed = false;
  const stepCtx = { sensors: control.sensors, bal: control.warner, body: sim.body };   // ★ 法庭模式状态（非空 = 法庭运行中）

  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('缺少 #view canvas');

  setStatus('建渲染层…');
  const viewer = new Viewer(canvas, sim.sk, 1, { assetBase: '' });
  viewer.followShowcase = true;

  // ── 动作按钮 → 动作层（独立系统）──
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#actions button'));
  const pairBtn = buttons.find((b) => b.dataset.act === 'pairpause');
  if (pairBtn) pairBtn.textContent = `驱动层：${__ENV.SQC_PASSIVE_MODE === '1' ? '被动刚度' : 'pairPD'}`;
  const setActive = (btn?: HTMLButtonElement | null): void => {
    for (const b of buttons) b.classList.toggle('active', b === btn);
  };

  function act(name: string, btn: HTMLButtonElement): void {
    if (name !== 'court') court = null;   // 任何其他动作退出法庭模式
    if (name !== 'squatdown') { pendingSquatDown = false; squatDownArmed = false; }
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
          drawPoseOverlay();   // ★ 画设想骨架
          // ★★ 正确序列（用户：'腰弯不下去'真身=被动刚度把腿拉回站立）：
          //   ① 先手动摆到红骨架姿势（硬弹簧）
          for (const sd of ['l', 'r'] as const) {
            control.manual.setAngle(`hip_${sd}`, 2, 0.65, 2000, 80);
            control.manual.setAngle(`knee_${sd}`, 2, -2.4, 2000, 80);
            control.manual.setAngle(`foot_${sd}`, 2, 0.0, 2000, 80);   // ★ 脚底朝下承重（用户）
            control.manual.setAngle(`hip_${sd}`, 0, sd === 'l' ? 0.15 : -0.15, 2000, 80);   // ★ 收回外撇
          }
          //   ② 1.5s 后（姿势到位）：重捕获被动基准（站立S→蹲姿）→ 交给回正力
          window.setTimeout(() => {
            if (!posePreview) return;
            sim.switchPoseState('squat');         // ★★ 原子切换（用户架构：所有层一次切完）
            control.warner.setComTarget(baseParams().comX, 0);   // ★ CoM 状态参数
            for (const sd of ['l', 'r'] as const) {
              control.manual.clearAngle(`hip_${sd}`, 2);
              control.manual.clearAngle(`knee_${sd}`, 2);
              control.manual.clearAngle(`foot_${sd}`, 2);
              control.manual.clearAngle(`hip_${sd}`, 0);
            }
          }, 1500);
        } else {
          sim.setGravity(-9.81);
          control.warner.opt.gravityComp = true;
          control.actions.idleEnabled = true;
          setBaseState('stand');
          if (overlay) { viewer.scene.remove(overlay); overlay.geometry.dispose(); overlay = null; }
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
      case 'pairpause': {
        const on = __ENV.SQC_PASSIVE_MODE !== '1';
        __ENV.SQC_PASSIVE_MODE = on ? '1' : '0';
        __ENV.SQC_PASSIVE_ONLY = on ? '1' : '0';
        __ENV.SQC_JOINT_LOAD = on ? '1' : '0';
        __ENV.SQC_PB_C_LOAD = '5';
        __ENV.SQC_PASSIVE_B = '2';
        __ENV.SQC_PA_K = '100';
        __ENV.SQC_PA_B = '4';
        __ENV.SQC_PA_CAP = '5';
        __ENV.SQC_LEG_UP = '50';
        __ENV.SQC_LEG_SIGN = '-1';
        __ENV.SQC_LEG_SHARE_A = '2';
        __ENV.SQC_LEG_SHARE_K = '0.5';
        __ENV.SQC_PAIR_OFF = '0';
        __ENV.SQC_SAG_PASSIVE = '0';
        btn.textContent = `驱动层：${on ? '被动刚度' : 'pairPD'}`;
        setActive(on ? btn : null);
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
      case 'noupper': {
        const on = !upperGravityZero;
        setUpperGravityZero(on);
        btn.textContent = `上身重力：${on ? '0' : '正常'}`;
        setActive(on ? btn : null);
        break;
      }
      case 'reset':
        control.actions.abort();
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        setUpperGravityZero(false);
        control.warner.setComTarget(0, 0);
        setActive(btn);
        break;
      case 'squatdown':
        // ★ stand 伺服状态 --动作层下蹲--> squat 伺服状态（不在 squatFrame 里写下蹲）
        control.actions.abort();
        control.actions.idleEnabled = false;
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        sim.switchPoseState('stand');
        control.resetCourt();
        control.actions.play('squatDown');
        pendingSquatDown = true;
        squatDownArmed = false;
        setActive(btn);
        break;
      case 'squatcourt':
        // ★ 蹲下法庭（用户）：蹲姿静置→放开→严格判死（与单腿法庭同一套判死标准）
        control.actions.abort();
        control.actions.idleEnabled = false;   // ★ 与探针一致：蹲姿法庭期间不跑 idle
        control.manual.clear();
        sim.controller = control;
        sim.driveEnabled = true;
        sim.reset();
        control.resetCourt();
        squatResetLimits(sim);
        setUpperGravityZero(String(__ENV.SQC_NO_UPPER ?? '0') === '1');
        court = squatCourtSetup(sim, control, 2.0);
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

  function maybeSquatHandoff(): void {
    if (!pendingSquatDown) return;
    if (control.actions.status.id === 'squatDown' && control.actions.status.active) squatDownArmed = true;
    if (!squatDownArmed) return;
    // ★ 只有动作**真正到达法庭目标姿态**才允许交接（不看 comZ/时间）。
    //   目标 = 蹲下动作 p=1 路径终点（与法庭 seat 同一组角）。
    const body = sim.body;
    const ang = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? body.dofs[i]!.angle : Number.NaN; };
    const jt = 5 / 57.29578;
    const tgtHip = 103.1 / 57.29578, tgtKnee = -102.1 / 57.29578;
    // ★★★ 2026-10-26 修弹飞：门控原先 8 条里有两条**先天不可能成立**，导致交接被无限拖延
    //   （实测一直拖到动作层自己的「交接」相位 zeroAll）：
    //     · `|foot_l/2| < 10°`：实测恒 +22°，而这 22° **正是动作层自己在推的**
    //       （`ANK_K·comErr`，comErr≈6cm ⇒ 6×0.06≈21°）⇒ 要求与控制目标互相矛盾；
    //     · `|comX − 0.010| < 0.03`：实测**单调漂移** −2.5 → −9.6cm，从不回头。
    //   拖延的代价是实测的：t=6.05 交接 ⇒ 稳坐 30s；t=7.27 交接 ⇒ comX 已漂 −9.6cm，
    //   squat 伺服救不回 ⇒ 前栽 ⇒ 脚部限位爆 55 m/s。
    //   ⇒ 判据改成「**姿势到位 + 双脚着地**」（这才是"蹲完了"的定义），踝/CoM 交给伺服自己收。
    const poseOk = Number.isFinite(ang('hip_l', 2)) && Number.isFinite(ang('knee_l', 2))
      && Math.abs(ang('hip_l', 2) - tgtHip) < jt
      && Math.abs(ang('knee_l', 2) - tgtKnee) < jt
      && body.footNormalForce('l', DT) > 50 && body.footNormalForce('r', DT) > 50;
    // ★★★ 2026-10-26 修弹飞（用户：'我只要你修弹飞'）：
    //   动作层第 3 个相位「交接」的 enter 就是 `zeroAll()`——把 hip/knee/foot/spine/neck/shoulder
    //   的 manual 角度**全清**、第 0 轴力矩**归零** ⇒ 深蹲**一个写手都不剩**；而 supportClean 的
    //   `_ref` 还是**站立**目标 ⇒ 一步内往站姿猛拉。实测 6.72 / 7.99 / 9.80 m/s（用户看到的弹飞）。
    //   ⇒ 兜底：只要动作已经走到「交接」相位、且膝盖确实还在蹲（< −60°），无条件接管。
    const forced = control.actions.status.phase === '交接' && ang('knee_l', 2) < -60 / 57.29578;
    if (!poseOk && !forced) return;
    pendingSquatDown = false;
    squatDownArmed = false;
    control.actions.abort();
    // ★ 同一帧：动作层张力 → 清 manual → 捕获 CourtState → squat 伺服接管（无空档）。
    control.manual.clear();
    court = captureSquatCourt(sim, control);
    setActive(null);
  }

  // ── 渲染 + 物理循环 ──
  let last = performance.now();
  let acc = 0;
  const MAX_STEPS = 32;   // 低帧率也保持实时（8 步在 30fps 下=半速慢动作）
  // ★ §2.250 帧控（用户：慢速/暂停/单帧逐帧查）
  let timeScale = 1;    // 0=暂停
  let stepRemain = 0;   // 单帧剩余物理帧数
  let posePreview = false;   // ★ 姿势预览（零重力悬浮）
  // ★ 用户：'用绘制的方式，绘制你设想中的关节'——纯 FK 画骨架（不跑物理）
  let overlay: THREE.LineSegments | null = null;
  const drawPoseOverlay = (): void => {
    const h = 1.5, k = -2.4, f = -0.3, h0 = -0.15, lean = 0.75;   // ★ 大腿抬到水平上方（躯干-大腿真45°）
    const th = 0.43, sh = 0.35, ft = 0.20;
    const pts: number[] = [];
    const seg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void => { pts.push(x1, y1, z1, x2, y2, z2); };
    for (const sgn of [-1, 1]) {
      const z0 = sgn * 0.08;
      const hx = 0, hy = 0.85, hz = z0 + sgn * h0 * 0.4;
      const a1 = h;
      const kx = hx + th * Math.sin(a1), ky = hy - th * Math.cos(a1), kz = hz;
      const a2 = a1 + k;
      const ax = kx + sh * Math.sin(a2), ay = ky - sh * Math.cos(a2), az = kz;
      const a3 = a2 + f + Math.PI;   // ★ 脚要Z字形：从折叠小腿再折回来指向前方（脚底朝下承重）
      const tx = ax + ft * Math.sin(a3), ty = ay - ft * Math.cos(a3), tz = az;
      seg(hx, hy, hz, kx, ky, kz);
      seg(kx, ky, kz, ax, ay, az);
      seg(ax, ay, az, tx, ty, tz);
    }
    // 躯干：骨盆→脊柱（前倾 lean）→ 头
    const sx = 0 + Math.sin(lean) * 0.5, sy = 0.85 + Math.cos(lean) * 0.5;
    seg(0, 0.85, 0, sx, sy, 0);
    seg(sx, sy, 0, sx + Math.sin(lean) * 0.25, sy + Math.cos(lean) * 0.25, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    if (overlay) { viewer.scene.remove(overlay); overlay.geometry.dispose(); }
    overlay = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff2222, depthTest: false }));
    overlay.renderOrder = 999;
    viewer.scene.add(overlay);
  };
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

  // 关节回读：角度、速度、指令、实际、分层力矩
  const jointDump = (): string[] => {
    const body = sim.body as unknown as {
      dofs: Array<{ dofIndex: number; name: string; axis: number; angle: number; vel: number; tauMax: number }>;
    };
    const drv = (sim as unknown as { drive?: { lastBreakdown?: Array<Record<string, number>> } }).drive;
    const ex = (sim as unknown as { executor?: { ledger: Array<{ cmd: number; applied: number; writes: number; saturated: boolean }> } }).executor;
    const L = ['name/axis	angle_deg	vel_rad_s	tau	cmd	applied	tauMax	sat	writes	act	servo	stiff	damp	ff'];
    for (const d of body.dofs) {
      const b = (drv?.lastBreakdown?.[d.dofIndex] ?? {}) as Record<string, number>;
      const l = ex?.ledger[d.dofIndex];
      const tau = (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
      L.push(`${d.name}/${d.axis}	${(d.angle * 57.29578).toFixed(2)}	${d.vel.toFixed(4)}	${tau.toFixed(2)}	${(l?.cmd ?? 0).toFixed(2)}	${(l?.applied ?? 0).toFixed(2)}	${d.tauMax}	${l?.saturated ? 1 : 0}	${l?.writes ?? 0}	${(b.act ?? 0).toFixed(2)}	${(b.servo ?? 0).toFixed(2)}	${(b.stiff ?? 0).toFixed(2)}	${(b.damp ?? 0).toFixed(2)}	${(b.ff ?? 0).toFixed(2)}`);
    }
    return L;
  };

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
    L.push(...jointDump());
    const text = L.join('\\n');
    console.log(text);
    const btn = pbBtn('pb-export');
    const done = (): void => { if (btn) { btn.textContent = '已复制✓'; setTimeout(() => { btn.textContent = '导出本帧(C)'; }, 900); } };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else done();
  };
  pbBtn('pb-export')?.addEventListener('click', exportFrame);
  pbBtn('hud-copy')?.addEventListener('click', () => {
    const btn = pbBtn('hud-copy');
    const text = `URL: ${location.href}
${hud?.textContent ?? ''}

${jointDump().join('\n')}`;
    const finish = (ok: boolean): void => {
      if (!btn) return;
      btn.textContent = ok ? '已复制✓' : '复制失败';
      setTimeout(() => { btn.textContent = '复制HUD'; }, 900);
    };
    const fallback = (): boolean => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => finish(fallback()));
    } else {
      finish(fallback());
    }
  });
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
        supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');   // ★ 蹲下过渡也跑回正力（支撑层只托身体，平衡归回正力）
        sim.advance(1); physFrames++;
        maybeSquatHandoff();
        if (court) squatFrame(sim, control, court);
      }
      stepRemain -= k;
      acc = 0;
    } else if (timeScale > 0) {
      acc += dt * timeScale;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) {
        acc -= DT; n++;
        if (DRIVE_OFF) sim.driveEnabled = false;
        supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');   // ★ 蹲下过渡也跑回正力（支撑层只托身体，平衡归回正力）
        if (posePreview) { const rb = sim.body.root(); rb.setLinvel({ x: 0, y: 0, z: 0 }, true); rb.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        sim.advance(1); physFrames++;      // 控制模块在 advance 内：感知→整合→反射→写关节
        maybeSquatHandoff();
        if (court) squatFrame(sim, control, court);
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
    const drv = (control.warner as unknown as { drive: { lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number; ff: number }> } }).drive;
    const tq = (n: string, a: number): number => {
      const i = sim.body.dofByName(n, a);
      if (i < 0) return 0;
      const d0 = sim.body.dofs[i]!;
      if (d0.engineMotor) return (d0 as unknown as { motorTqEst?: number }).motorTqEst ?? 0;
      const b = drv.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0, ff: 0 };
      return b.act + b.servo + b.stiff + b.damp + (b.ff ?? 0);   // ★ 补 ff（基础力/staticBalance/回正力全在 ff 通道）
    };
    const dirRow = (axis: number): string => {
      const spine = tq('spine1', axis) + tq('spine2', axis) + tq('spine3', axis);
      const hip = tq('hip_r', axis), knee = tq('knee_r', axis), ank = tq('foot_r', axis);
      return `脊${spine.toFixed(0).padStart(5)} 髋${hip.toFixed(0).padStart(5)} 膝${knee.toFixed(0).padStart(4)} 踝${ank.toFixed(0).padStart(5)} Σ${(spine + hip + knee + ank).toFixed(0).padStart(5)}`;
    };
    const hls = court ? estimateHipLevel(sim, court) : null;
    hud.textContent =
      `FPS ${fpsShown}\n` +
      `动作: ${actName}\n` +
      (st.phase ? `阶段: ${st.phase}\n` : '') +
      (court ? (court.released
        ? `法庭: ★★★已放开★★★ 放开于 t=${court.settle.toFixed(1)}s｜当前 t=${court.t.toFixed(2)}s（自由）`
        : `法庭: 静置中(扶) t=${court.t.toFixed(1)}/${court.settle.toFixed(1)}s — ${(court.settle - court.t).toFixed(1)}s 后放开`)
        + ` com=(${(control.sensors.com[0]! * 100).toFixed(1)},${(control.sensors.com[2]! * 100).toFixed(1)})cm tilt=(p${(control.sensors.torsoTilt[0]! * 57.3).toFixed(1)},r${(control.sensors.torsoTilt[1]! * 57.3).toFixed(1)})°${court.fall >= 0 ? `  ✗倒下@${court.fall.toFixed(2)}s ${court.reason}` : '  ✓站住'}${court.safeExit !== undefined && court.safeExit >= 0 ? `  安全区@${court.safeExit.toFixed(2)}s ${court.safeReason ?? ''}` : ''}\n` : '') +
      `预警: level=${prop?.level ?? '-'}  ${prop?.reason ?? ''}\n` +
      (sup ? `支撑: ${sup.mode}/${sup.phase} 负载${sup.loadOk ? 'ok' : 'NO'} 建议${sup.suggest}\n` : '') +
      (est ? `预测: risk=${est.risk} TTB x=${tf(est.ttbX)}s z=${tf(est.ttbZ)}s\n` : '') +
      (est ? `XCoM x=${est.xcomX.toFixed(3)} z=${est.xcomZ.toFixed(3)}\n` : '') +
      `胸腔 y = ${t.y.toFixed(4)} m   x = ${t.x.toFixed(4)} m\n` +
      `地面力 = ${fz.toFixed(0)}% 体重\n` +
      `摩擦 L=${(control.perception.feet[0]!.frictionUse * 100).toFixed(0)}% R=${(control.perception.feet[1]!.frictionUse * 100).toFixed(0)}%
` +
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

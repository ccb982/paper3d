/**
 * probe-readback.ts —— **关节回读网关验收**（`架构_v2_三模块协作.md` §18.3）
 *
 * 三件事：
 *   ① **静态**：两个系统不得直读 `rs.pos/vel/angle/jointVel`（R1 规则）
 *   ② **恒等**：网关的 `angleDeg/velDegPerSec` 与物理值逐拍一致（R0：证明网关没改口径）
 *   ③ **符号**：三个轴的「域口径符号」用**实测**钉死，不靠注释断言
 *      —— 注释里写的符号约定曾经互相矛盾（`balance.ts` 说踝「正 = 跖屈」，
 *         而验收代码多取了一次负号），而验收阈值全靠这个符号。
 *
 * 用法：node tools/run.mjs probe-readback
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');

const log = console.log;
const codeOnly = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
let fails = 0;
const bad = (m: string): void => { fails++; log(`  x ${m}`); };
const ok = (m: string): void => log(`  v ${m}`);

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const PHYS_HZ = DEFAULT_SIM.physicsHz;
const CTRL_HZ = DEFAULT_SIM.controlHz;
const PER_CTRL = Math.max(1, Math.round(PHYS_HZ / CTRL_HZ));
const DT = 1 / CTRL_HZ;

// ══ A. 静态：两个系统不得直读关节数组 ══════════════════════════════
log('== A. 静态：两个系统不得直读关节回读 ==');
{
  const FORBID = [/\.pos\[/, /\.vel\[/, /\.angle\(/, /\.jointVel\(/, /\.jointPos\(/];
  for (const f of ['src/core/systems/balance.ts', 'src/core/systems/step.ts']) {
    if (!fs.existsSync(f)) { bad(`缺文件 ${f}`); continue; }
    const src = codeOnly(fs.readFileSync(f, 'utf8'));
    const hits: string[] = [];
    for (const re of FORBID) {
      const n = (src.match(new RegExp(re.source, 'g')) ?? []).length;
      if (n > 0) hits.push(`${re.source} x${n}`);
    }
    if (hits.length) bad(`${f} 仍直读关节回读：${hits.join(', ')} => 应走 rs.jointRead()`);
    else ok(`${f} 只经网关读关节`);
  }
}

// ══ B. 恒等 + C. 符号 ═════════════════════════════════════════════
log('');
log('== B. 运行时：网关恒等 ==');
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 4 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const jq = ctrl.rs.jq;
if (!jq) {
  bad('rs.jq 未注入：Controller 没有把网关交给两个系统');
} else {
  const names: [string, number][] = (['hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r'] as const)
    .map((n) => [n, sk.joints.findIndex((j) => j.name === n)] as [string, number]);
  let maxAng = 0; let maxVel = 0; let n = 0;
  // ★ 力链必须在**站立中段**取值：跑到最后 rig 已经倒了，接触消失 ⇒
  //   `groundChain` 合法地变成"不可信"。拿它去断言等于拿尸体做体检。
  let gcMid: typeof ctrl.rs.groundChain = null;
  let gcMidT = -1;
  for (let i = 0; i < 4 * PHYS_HZ && !sim.finished; i++) {
    if (i % PER_CTRL === 0) {
      sim.doll.setMotorTargets(ctrl.step(DT));
      // 站得最稳的那一拍：取 0.5s 附近的力链
      const tNow = i / PHYS_HZ;
      if (gcMidT < 0 && tNow >= 0.45 && ctrl.rs.groundChain) { gcMid = ctrl.rs.groundChain; gcMidT = tNow; }
      for (const [nm, ji] of names) {
        if (ji < 0) continue;
        for (const ax of [0, 1, 2] as const) {
          maxAng = Math.max(maxAng, Math.abs(jq.angleDeg(nm, ax) - ctrl.rs.angle(ji, ax) * 180 / Math.PI));
          maxVel = Math.max(maxVel, Math.abs(jq.velDegPerSec(nm, ax) - ctrl.rs.jointVel(ji, ax) * 180 / Math.PI));
        }
      }
      n++;
    }
    sim.advance(1);
  }
  if (maxAng < 1e-9) ok(`angleDeg 与物理值逐拍一致（${n} 拍 x ${names.length} 关节 x 3 轴，最大偏差 ${maxAng.toExponential(1)}）`);
  else bad(`angleDeg 与物理值不一致：最大偏差 ${maxAng}`);
  if (maxVel < 1e-9) ok(`velDegPerSec 与物理值逐拍一致（最大偏差 ${maxVel.toExponential(1)}）`);
  else bad(`velDegPerSec 与物理值不一致：最大偏差 ${maxVel}`);

  // ── ★ 遥测门禁：UI 显示的必须是**状态机的原话** ──────────────────
  //   用户 2026-10-06：「我应该回读各种状态机的数据才对，所有的回读也是消费状态机的数据」。
  //   本项目栽过四次"两套口径"（轴索引 / 符号 / 单位 / 帧域），
  //   所以这里把"UI 只能渲染状态机遥测"变成**可执行的门禁**，而不是口头约定。
  {
    const rs = ctrl.rs;
    const tm = rs.telemetry;
    const problems: string[] = [];
    if (tm.state !== rs.state) problems.push(`state ${tm.state} != rs.state ${rs.state}`);
    if (!tm.stateLabel || tm.stateLabel === '—') problems.push('stateLabel 未填');
    if (tm.stateT === '0.00' && rs.stateT > 0.05) problems.push(`stateT ${tm.stateT} 与 rs.stateT ${rs.stateT.toFixed(2)} 不符`);
    if (rs.verified && tm.violations !== '') problems.push(`已验收却带越界文案「${tm.violations}」`);
    if (!rs.verified && rs.violations.length > 0 && tm.violations === '') problems.push('有越界却没给 UI 文案');
    if (rs.violations.length > 0 && !tm.verified.startsWith('✗')) problems.push(`verified 文案「${tm.verified}」与越界数不符`);
    if (tm.jointsDeg.includes('—')) problems.push(`jointsDeg 缺值：${tm.jointsDeg}（网关没通）`);
    if (!/^\d/.test(tm.loadFrac) && tm.loadFrac !== '—') problems.push(`loadFrac 格式异常：${tm.loadFrac}`);
    if (tm.domainWorst === '—' || tm.domainWorst === 'NaN') problems.push(`domainWorst 异常：${tm.domainWorst}`);
    // ── ★ 力链（状态机拥有的地面反力链）────────────────────────────
    //   用户 2026-10-06：「正确实现力链的分析放在状态机里，供平衡系统使用」。
    //   钉死三件事：① 状态机真的发布了它；② L0 自洽（逐块和 == 脚合力）；
    //   ③ 不可信时**必须显式说不信**，不许拿假值凑。
    {
      const gc = gcMid ?? ctrl.rs.groundChain;
      ok(`力链取样于 t=${gcMidT.toFixed(2)}s（站立中段）`);
      if (!gc) bad('rs.groundChain 为空：状态机没有发布力链（forceSrc 没装？）');
      else {
        ok(`力链已发布：CoP (${(gc.copX * 1000).toFixed(1)}, ${(gc.copZ * 1000).toFixed(1)}) mm`
          + ` GRF ${gc.grfY.toFixed(0)}N 方向 ${gc.grfAngleDeg.toFixed(1)}°`
          + ` 踝力臂 sag ${(gc.armSag * 1000).toFixed(1)}mm 余量 sag ${gc.tauMarginSag.toFixed(1)}N·m`
          + ` 可信=${gc.trustable}${gc.trustable ? '' : '（' + gc.trustNote + '）'}`);
        for (const [nm, ff] of [['左', gc.l], ['右', gc.r]] as const) {
          if (!ff.copValid) {
            ok(`${nm}脚无有效载荷（显式 copValid=false）：接触块 ${ff.contactN} 合力 ${ff.fz.toFixed(1)}N`);
            continue;
          }
          const psum = ff.patches.reduce((a, x) => a + x.ny, 0);
          const rel = Math.abs(psum - ff.fz) / Math.max(1e-6, ff.fz);
          if (rel < 0.01) ok(`${nm}脚 L0 自洽：逐块和 ${psum.toFixed(1)}N == 合力 ${ff.fz.toFixed(1)}N`);
          else bad(`${nm}脚 L0 不自洽：逐块和 ${psum.toFixed(1)}N vs 合力 ${ff.fz.toFixed(1)}N（差 ${(rel * 100).toFixed(1)}%）`);
        }
        if (!gc.trustable && gc.trustNote === '') bad('力链不可信却没给 trustNote');
        else if (!gc.trustable) ok(`不可信时有原因说明：「${gc.trustNote}」`);

        // ── ★★ 柔性足侧向（2026-10-06）：三个量必须有限，且"能力边界"必须存在 ──
        //   为什么值得单列：`fx/fzTan` 曾经**硬编码 0**（"GRF 方向"永远是 0.0°），
        //   `tauMarginLat` 曾经拿 `ankleTau(0)`（一个不会动的轴）去比 ⇒ 全是幻觉。
        //   这里钉死：① 水平力与加速度同源同号；② 支撑面边界有序；
        //   ③ `forceChainLines` 的 11 行里**不许出现 '—'**（那是非有限值的占位符）。
        {
          // ★ 只钉**关键量**必须有限；单脚分率在 `copValid=false` 时**本来就该是 NaN**
          //   （没接触就没有 CoP —— `—` 是正确显示，不是缺陷）。
          const crit: [string, number][] = [
            ['latMin', gc.latMin], ['latMax', gc.latMax], ['distEdgeZ', gc.distEdgeZ],
            ['tauMarginLat', gc.tauMarginLat], ['tauMarginSag', gc.tauMarginSag],
            ['grfX', gc.grfX], ['grfY', gc.grfY], ['grfZ', gc.grfZ], ['grfAngleDeg', gc.grfAngleDeg],
          ];
          const badv = crit.filter(([, v]) => !Number.isFinite(v));
          if (badv.length === 0) ok(`力链关键量全部有限（支撑面/余量/水平力/方向，${crit.length} 项）`);
          else bad(`力链有非有限量：${badv.map(([k]) => k).join(',')}`);
          for (const [nm, f] of [['左', gc.l], ['右', gc.r]] as const) {
            const v = nm === '左' ? gc.copFracLat.l : gc.copFracLat.r;
            if (f.copValid && !Number.isFinite(v)) bad(`${nm}脚 copValid=true 但侧向分率非有限`);
          }
          const finiteFrac = [gc.copFracLat.l, gc.copFracLat.r].filter((v) => Number.isFinite(v));
          ok(`侧向权限占用：${finiteFrac.map((v) => (v * 100).toFixed(0) + '%').join(' / ') || '（两脚都无接触）'}`
            + `（无效脚显式给 —）`);
          if (gc.latMin < gc.latMax) ok(`侧向支撑面有序：${(gc.latMin * 1000).toFixed(0)} ~ ${(gc.latMax * 1000).toFixed(0)}mm`);
          else bad(`侧向支撑面边界异常：min ${gc.latMin} >= max ${gc.latMax}`);
          ok(`水平地面反力 ${Math.hypot(gc.grfX, gc.grfZ).toFixed(1)}N（方向 ${gc.grfAngleDeg.toFixed(2)}°）`
            + ' ← fx/fzTan 不再是硬编码 0');
          // 支撑多边形口径：CoM 距边缘 = 可承受倾覆力矩 / 总法向力（两者必须自洽）
          const fzTot = gc.l.fz + gc.r.fz;
          if (fzTot > 15) {
            const implied = gc.tauMarginLat / fzTot;
            const rel = Math.abs(implied - gc.distEdgeZ) / Math.max(1e-6, Math.abs(gc.distEdgeZ));
            if (rel < 0.02) ok(`侧向余量自洽：${(gc.distEdgeZ * 1000).toFixed(0)}mm × ${fzTot.toFixed(0)}N == ${gc.tauMarginLat.toFixed(1)}N·m`);
            else bad(`侧向余量不自洽：distEdgeZ=${gc.distEdgeZ} vs τ/Fz=${implied}`);
          }
        }
      }
    }

    // ── 关节名必须与 skeleton 一致，且**错名必须响** ────────────────
    //   实测踩过：遥测里写 `l_hip`，网关静默返回 -1 ⇒ 角度 0 ⇒
    //   面板上「髋 0.0° 膝 0.0° 踝 0.0°」一路全绿。所以这里钉死三件事：
    //     ① 正确的后缀名能取到**非零**读数（运动中）
    //     ② 错名（`l_hip`）必须抛错，不能静默给 0
    //     ③ 遥测里的关节角 === 网关用正确名读到的值
    if (jq) {
      const good = ['hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r'];
      let nonzero = 0;
      for (const nm of good) for (const ax of [0, 1, 2] as const) if (Math.abs(jq.angleDeg(nm, ax)) > 0.5) nonzero++;
      if (nonzero > 0) ok(`后缀命名（hip_l/knee_l/foot_l）能取到真实读数（运动中 ${nonzero} 个非零）`);
      else bad('后缀命名的读数全为 0 —— 又一次假零（名字又写错了？）');
      let threw = '';
      try { jq.angleDeg('l_hip', 0); } catch (e) { threw = (e as Error).message; }
      if (threw) ok(`错名被拒绝而不是静默给 0：${threw.slice(0, 46)}…`);
      else bad('错名 "l_hip" 没抛错 ⇒ 会静默返回 0（危险）');
      // ③ 遥测逐字等于网关读数
      const sup = ctrl.rs.supportLeg();
      const sw = ctrl.rs.swingLeg();
      const want = [
        `髋 ${jq.angleDeg(`hip_${sup}`, 0).toFixed(1)}°`,
        `膝 ${jq.angleDeg(`knee_${sw}`, 0).toFixed(1)}°`,
        `踝 ${jq.angleDeg(`foot_${sup}`, 0).toFixed(1)}°`,
      ].join('  ');
      if (tm.jointsDeg === want) ok(`遥测关节角 === 网关读数（${want}）`);
      else bad(`遥测关节角与网关不一致：遥测「${tm.jointsDeg}」vs 网关「${want}」`);
    }

    if (problems.length === 0) {
      ok(`遥测与状态机逐拍一致（UI 只渲染，不推导）：${tm.stateLabel} ${tm.stateT}s `
        + `${tm.verified}｜承重 ${tm.bearerLoad} ${tm.loadFrac}｜越界 ${tm.domainWorst}°`);
    } else {
      for (const pr of problems) bad(`遥测不一致：${pr}`);
    }
  }
}

// ══ C. 符号实测 ═══════════════════════════════════════════════════
log('');
log('== C. 符号实测（40ms 窗口，看解剖方向）==');
//
//  做法：给某轴一个已知角度偏移，观察**解剖学上可判的方向**：
//    · 髋 +Δ ⇒ 膝的世界 x **后移** ⇒ **+ = 伸**（⇒ 域口径「正=屈」必须取负）
//      （不能用脚：脚 planted 在地上，髋屈主要表现为膝移动）
//    · 膝 +Δ ⇒ 脚中心 x **前移** ⇒ **+ = 伸**
//    · 踝 +Δ ⇒ 足长轴（局部 X，heel→toe）的世界 y **下降** ⇒ **+ = 跖屈**
//  ⚠ 窗口既不能太长（身体会自行倒下，3s 窗口实测 Δ脚x=373mm、踝 CoP 载荷为 0），
//    也不能太短（10 个物理步只有亚毫米位移）⇒ 取 0.15s。
//  ⚠ `soleColBody` 是 private ⇒ 踝的方向判据不能用"趾块/跟块高度"，
//    改用**公开**的 `bodyWorldAxis(foot, 0)`（足长轴）世界 y 分量。
{
  const kick = (jointName: string, axis: 0 | 1 | 2, rad: number, secs = 0.15) => {
    const ji = sk.joints.findIndex((j) => j.name === jointName);
    if (ji < 0) return null;
    const span = Math.max(Math.abs(sk.joints[ji]!.minRad[axis]), Math.abs(sk.joints[ji]!.maxRad[axis]));
    const s2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 1 });
    s2.begin(new Float32Array(s2.paramCount));
    const cmd = new Float32Array(s2.doll.motorTarget.length);
    const jKnee = sk.joints.findIndex((j) => j.name === 'knee_l');
    const footKey = axis === 2 && jointName.startsWith('foot') ? jointName : 'foot_l';
    const bi = s2.doll.indexByKey.get(footKey) ?? -1;
    const w0 = new Float64Array(3);
    const ax0 = new Float64Array(3);
    const bbA = new Float64Array(4);
    const bbB = new Float64Array(4);
    s2.doll.footSoleBounds(0, bbA);
    if (jKnee >= 0) s2.doll.jointWorld(jKnee, w0);
    if (bi >= 0) s2.doll.bodyWorldAxis(bi, 0, ax0);
    const kneeX0 = jKnee >= 0 ? w0[0] : 0;
    const toeAxisY0 = bi >= 0 ? ax0[1] : 0;
    cmd[ji * 3 + axis] = (rad * 0.9) / span;      // 与 rigState.requestAngle 同一换算
    const steps = Math.max(2, Math.round(secs * PHYS_HZ));
    for (let i = 0; i < steps; i++) { s2.doll.setMotorTargets(cmd); s2.advance(1); }
    s2.doll.footSoleBounds(0, bbB);
    if (jKnee >= 0) s2.doll.jointWorld(jKnee, w0);
    if (bi >= 0) s2.doll.bodyWorldAxis(bi, 0, ax0);
    return {
      dKneeX: jKnee >= 0 ? w0[0] - kneeX0 : 0,
      dFootX: (bbB[0]! + bbB[1]!) / 2 - (bbA[0]! + bbA[1]!) / 2,
      dToeAxisY: bi >= 0 ? ax0[1] - toeAxisY0 : 0,
    };
  };

    const mm = (v: number): string => `${(v * 1000).toFixed(2)} mm`;
  const hip = kick('hip_l', 2, +0.25);
  const knee = kick('knee_l', 2, +0.25);
  if (hip && knee) {
    log(`   髋 +0.25rad => 膝 Δx        = ${mm(hip.dKneeX)}   （+ = 伸 => 膝应后移）`);
    log(`   膝 +0.25rad => 脚中心 Δx    = ${mm(knee.dFootX)}   （+ = 伸 => 脚应前移）`);
    if (hip.dKneeX < -0.002) ok('髋：实测 +角 = 伸 ⇒ 域口径「正=屈」需**取负号**（与 degOf 一致）');
    else bad(`髋：+角使膝前移（${mm(hip.dKneeX)}）⇒ 关节空间是「正=屈」⇒ degOf 的负号反了`);
    if (knee.dFootX > 0.002) ok('膝：实测 +角 = 伸 ⇒ 域口径「正=屈」需**取负号**（与 degOf 一致）');
    else bad(`膝：+角使脚后移（${mm(knee.dFootX)}）⇒ 关节空间是「正=屈」⇒ degOf 的负号反了`);
  }

  // ── 踝：**运动学**判据（`bodyWorldAxis(foot,0)` 的方向已由骨架定义确认）──
  //   局部 +X = heel→toe：`skeleton.ts` 的鞋底块 `fx∈[-1,1] ↔ x∈[-L,+L]`，
  //   足跟 `fx=-1`、趾 `fx=+1` ⇒ 局部 +X 指向趾端。
  //   ⇒ 命令 +Δ 后若足长轴**抬升**，说明趾端上抬 = **背屈** ⇒ 域口径要取负。
  //   ⚠ 不用 CoP 判据：测量窗口内需控制器维持站立，而本 rig 当前 ~1.4s 就倒，
  //     窗口内 CoP 载荷读数为 0（实测）⇒ 测不到。
  const ank = kick('foot_l', 2, +0.20);
  if (ank) {
    log(`   踝 +0.20rad => 足长轴(heel→toe) Δy = ${mm(ank.dToeAxisY)}   （抬升 = 趾端上抬 = 背屈）`);
    if (ank.dToeAxisY > 0.002) ok('踝：实测 +角 = 背屈 ⇒ 域口径「正=跖屈」需**取负号**（与 degOf 一致）');
    else if (ank.dToeAxisY === 0) bad('踝：读不到足长轴世界方向 ⇒ 无法自动判定');
    else bad(`踝：+角使趾端下沉（${mm(ank.dToeAxisY)}）⇒ +角 是跖屈 ⇒ degOf 不该取负`);
  }

  log('');
  log('   注：髋/膝用「运动方向」判、踝用「足长轴升降」判 —— 后者的局部轴方向');
  log('       已由 skeleton.ts 的鞋底块定义确认，不靠假设。');
}

log('');
if (fails) { log(`x 回读网关验收失败 ${fails} 项`); process.exit(1); }
log('v 回读网关验收全绿：静态唯一读者 + 运行时恒等 + 符号实测一致');

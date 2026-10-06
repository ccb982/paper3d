/**
 * probe-grf.ts —— **λ-QP（接触力 QP）离线验收**
 *
 * 验的是本项目此前**完全没有**的那一路：
 *   · 竖向力 `f_y` 是不是被 QP 自己算出来（而不是"不管它"）
 *   · CoP / ZMP 在有 `f_y` 之后**能不能判**（此前竖向不进等式 ⇒ 数学上是空的）
 *   · 摩擦锥 `|f_h| ≤ μ f_y` 在有 `f_y` 之后**能不能判**
 *   · 双支撑时载荷分配（force distribution ratio）是不是自由度用出来的
 *
 * 参照文献：Kuindersma 2013（Atlas）/ Herzog 2016（Sarcos）/ WBDC 2018 /
 *           Cisneros 2020。核心结构：浮动基座那 6 行（牛顿-欧拉）是等式，
 *           接触力 λ 是决策变量，τ 在之后由驱动行定死。
 *
 * 用法：node tools/run.mjs probe-grf
 */
import { solveGrfQp, type Contact } from '../src/core/systems/grfQp';
import { newCentroidalState, type CentroidalState } from '../src/core/centroidal';

const log = console.log;
const G = 9.81;
const M = 70;                      // kg
let fails = 0;
const bad = (m: string): void => { fails++; log(`  ✗ ${m}`); };
const ok = (m: string): void => log(`  ✓ ${m}`);

/**
 * 造一个质心状态。
 *
 * ⚠ 为什么可以手造而不是跑物理：牛顿-欧拉那 6 行**只用到**
 * `m`、`c`、`I_c` 三个量，而 λ-QP 是这三个量的**线性函数**。
 * 所以离线手造完全够验数学性质 —— 这是这个 QP 值得单独离线验的原因。
 */
function mkCs(m = M, comY = 0.95): CentroidalState {
  const s = newCentroidalState();
  s.m = m;
  s.cx = 0; s.cy = comY; s.cz = 0;
  s.vx = 0; s.vy = 0; s.vz = 0;
  // `I_c`：一个人形绕质心的惯量量级（绕 y ≈ 6、绕 x ≈ 4、绕 z ≈ 4 kg·m²）
  s.Ic.fill(0);
  s.Ic[0] = 4.0; s.Ic[4] = 6.0; s.Ic[8] = 4.0;
  s.hx = 0; s.hy = 0; s.hz = 0;
  s.dhx = 0; s.dhy = 0; s.dhz = 0;
  s.dhReady = true;   // 手造状态下 `ḣ_c = 0` 且视为「已知」
  return s;
}

/** 足底接触点：世界位置 + 支撑多边形（单脚 z 偏移 0.167m，见 wholeBodyQp 的注释） */
function foot(x: number, z: number, active = true): Contact {
  return {
    x, y: 0, z,
    copX: [x - 0.14, x + 0.14],
    copZ: [z - 0.09, z + 0.09],
    active,
  };
}

const bothFeet = (): Contact[] => [foot(0, 0.167), foot(0, -0.167)];

log('══ λ-QP（接触力）离线验收 ══');
log('   参考：浮动基座那 6 行是等式；λ 是决策变量；τ 之后由驱动行定死');
log('');

// ══ A. 静态站立：竖向必须自己算出来 ≈ mg ═══════════════════════════════
log('══ A. 静态站立：F_y 必须 ≈ m·g，且不是"没人管它"══');
{
  const cs = mkCs();
  const o = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 0, aDesY: 0, aDesZ: 0, dhDes: null });
  const fy = o.fTotal[1];
  const want = M * G;
  log(`   期望 F_y = m·g = ${want.toFixed(1)} N`);
  log(`   实得 F_y = ${fy.toFixed(1)} N   (误差 ${(100 * (fy - want) / want).toFixed(2)}%)`);
  log(`   等式残差：线性 ${o.residual[0].toFixed(3)} N   角动量 ${o.residual[1].toFixed(3)} N·m/s`);
  log(`   ZMP = (${o.zmp[0].toFixed(4)}, ${o.zmp[1].toFixed(4)})   合成 F = (`
    + `${o.fTotal[0].toFixed(2)}, ${fy.toFixed(1)}, ${o.fTotal[2].toFixed(2)})`);
  if (Math.abs(fy - want) / want > 0.02) bad(`静态站立 F_y 偏差 >2%`);
  else ok(`静态站立 F_y 自动落到 m·g（偏差 ${(100 * (fy - want) / want).toFixed(2)}%）`);

  // ★ 这就是本项目此前完全没有的那一路
  if (!o.checks.friction) bad('有 f_y 之后摩擦锥仍判不过 —— 约束接线有问题');
  else ok(`摩擦锥可判且通过（|F_h|=${Math.hypot(o.fTotal[0], o.fTotal[2]).toFixed(2)} N ≤ μ·${fy.toFixed(0)}）`);
  if (!o.checks.cop) bad('有 f_y 之后 CoP 仍判不过');
  else ok(`CoP 可判且在支撑多边形内`);
  if (!o.checks.unilateral) bad('单边约束未过');
  else ok('单边约束 fy ≥ 0 通过');

  // 载荷分配：两脚应该各拿一半
  const l = o.lambda;
  const fyL = l[1]!, fyR = l[6]!;   // 布局 5 变量/接触 ⇒ 第 k 个 f_y 在 5k+1
  log(`   载荷分配：左 ${fyL.toFixed(1)} N (${(100 * fyL / fy).toFixed(1)}%)`
    + `   右 ${fyR.toFixed(1)} N (${(100 * fyR / fy).toFixed(1)}%)`);
  if (fy > 1 && Math.abs(fyL - fyR) / fy < 0.02) ok('对称站姿下两脚各半（冗余自由度被正确用来分配）');
  else bad(`两脚载荷不均：${fyL.toFixed(1)} vs ${fyR.toFixed(1)}（对称输入应各半）`);
}

// ══ B. 要水平力 ⇒ CoP 必须搬位（这是竖向带来的因果）═══════════════════
log('');
log('══ B. 水平力的代价：CoP 必须搬进支撑多边形内 ══');
{
  const cs = mkCs();
  const inpAx1 = 1.0;
  const o = solveGrfQp({ contacts: bothFeet(), cs, aDesX: inpAx1, aDesY: 0, aDesZ: 0 });
  log(`   a_des = (+1.0, 0, 0) m/s²  ⇒  F_x = ${o.fTotal[0].toFixed(1)} N`
    + `（期望 ${(M * 1.0).toFixed(1)}）  F_y = ${o.fTotal[1].toFixed(1)} N`
    + `  ZMP_x = ${o.zmp[0].toFixed(4)} m`);
  if (Math.abs(o.fTotal[0]! - M) / M > 0.03) bad(`F_x 没跟上期望（${o.fTotal[0]! .toFixed(1)} vs ${M}）`);
  else ok('F_x 跟上了 m·a_des');

  // ★★ 符号：产生**正向**加速度，CoP 必须**后移**。LIPM：`x_com − x_zmp = ẍ·z_c/g`
  //   ⇒ x_com = 0、`ẍ = +1` ⇒ `x_zmp = −z_c·ẍ/g = −96.8 mm`。
  //   （像划船：推力点在**后面**，船才往前。2026-10-06 我把这条写成"CoP 前移"，
  //     是**符号搞反**了 —— 断言在错的方向上，恰好能"通过"一个没接上的实现。）
  const zmpLipp = -(inpAx1 * 0.95) / G;
  const zmpGot = o.zmp[0]!;
  log(`   LIPM 期望 ZMP_x = −a·z_c/g = ${(zmpLipp * 1000).toFixed(1)} mm   实得 ${(zmpGot * 1000).toFixed(1)} mm`);
  if (zmpGot < -0.05 && Math.abs(zmpGot - zmpLipp) / Math.abs(zmpLipp) < 0.1) {
    ok(`CoP 后移到 ${(zmpGot * 1000).toFixed(1)} mm，与 LIPM 一致（10% 内）—— 水平力的物理代价成立`);
  } else {
    bad(`CoP 未按 LIPM 后移：实得 ${(zmpGot * 1000).toFixed(1)} mm，期望 ${(zmpLipp * 1000).toFixed(1)} mm`);
  }

  // 水平力过大 ⇒ CoP 跑出支撑面 ⇒ 必须报 infeasible 而不是硬给
  const big = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 30, aDesY: 0, aDesZ: 0, dhDes: null });
  log(`   a_des = (+30, 0, 0) m/s² ⇒  F_x = ${big.fTotal[0].toFixed(0)} N`
    + `  ZMP_x = ${big.zmp[0].toFixed(3)} m  feasible=${big.feasible ? '✓' : '✗'}`
    + `  checks=${JSON.stringify(big.checks)}`);
  if (!big.feasible) ok('需求超出支撑面时如实报 infeasible（CoP 约束生效）');
  else bad(`F_x 需求 2100N 竟判可行 —— CoP 约束没生效`);
}

// ══ C. 单边：脚离地 ⇒ f_y = 0，摩擦锥不适用 ═════════════════════════════
log('');
log('══ C. 单支撑：摆动脚必须 f_y ≡ 0，不能"分到一点载荷"══');
{
  const cs = mkCs();
  const c = bothFeet();
  c[1]!.active = false;                 // 右脚离地
  const o = solveGrfQp({ contacts: c, cs, aDesX: 0, aDesY: 0, aDesZ: 0, dhDes: null });
  const fySwing = o.lambda[6]!;   // 右脚 f_y = lambda[5*1+1]
  log(`   摆动脚 f_y = ${fySwing.toFixed(6)} N   支撑脚 f_y = ${o.lambda[1]!.toFixed(1)} N`);
  if (Math.abs(fySwing) < 1e-6) ok('摆动脚 f_y ≡ 0（单边约束硬生效）');
  else bad(`摆动脚拿到了 ${fySwing.toFixed(2)} N 载荷 —— 单边没生效`);
  if (o.lambda[1]! > M * G * 0.99) ok(`支撑脚独自撑住全部体重（${o.lambda[1]!.toFixed(1)} N）`);
  else bad(`支撑脚只撑了 ${o.lambda[1]!.toFixed(1)} N < m·g`);
}

// ══ D. 摩擦锥：需求超出 μ 时必须报出来 ═════════════════════════════════
log('');
log('══ D. 摩擦锥：|F_h| ≤ μ·F_y 真的在起作用 ══');
{
  const cs = mkCs();
  for (const mu of [0.3, 0.8]) {
    const o = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 20, aDesY: 0, aDesZ: 0, mu });
    const fh = Math.hypot(o.fTotal[0]!, o.fTotal[2]!);
    const cap = mu * o.fTotal[1]!;
    log(`   μ=${mu}  a_des_x=20 ⇒  |F_h| = ${fh.toFixed(0)} N   μ·F_y = ${cap.toFixed(0)} N`
      + `  friction=${o.checks.friction ? '✓' : '✗'}`);
    // ★ 期望行为**不是** friction=false，而是：**摩擦锥把 F_h 压到锥壁上，
    //   然后等式残差变大并如实报 infeasible**。
    //   「压住 + 报残差」= 物理上限生效；「friction=false」= 输出越界，更糟。
    const satOk = Math.abs(fh - cap) < 1e-2 * Math.max(1, cap);
    log(`     ${satOk ? '✓' : '✗'} 压到锥壁（|F_h| ${fh.toFixed(0)} vs 锥壁 ${cap.toFixed(0)}）`
      + `   等式残差 ${o.residual[0].toFixed(0)} N   equality=${o.checks.equality ? '✓' : '✗（已如实报出）'}`
      + `   feasible=${o.feasible ? '✓' : '✗'}`);
    //   ★ `friction` 描述的是**输出**是否在锥内（应当是 true —— 输出必须合法），
    //     「需求没被满足」由 `equality=false` + `feasible=false` 报告。
    //     这三者必须分开：把 friction 当成"够不够"的指标就会判反。
    if (!satOk) bad(`μ=${mu} 下 F_h 落在 ${fh.toFixed(0)} N，既不在锥内（${cap.toFixed(0)}）也不在锥壁`);
    else if (!o.checks.friction) bad(`μ=${mu} 下输出越出摩擦锥（非法输出比不满足需求更糟）`);
    else if (o.checks.equality) bad(`被摩擦锥挡住却仍报等式成立 —— 残差没报出来`);
    else if (o.feasible) bad(`需求未满足却报 feasible`);
    else ok(`μ=${mu}：输出合法（压到锥壁）+ 残差 ${o.residual[0].toFixed(0)}N + infeasible，三者一致`);
  }
  // 小需求应当通过
  const o2 = solveGrfQp({ contacts: bothFeet(), cs, aDesX: 2, aDesY: 0, aDesZ: 0, mu: 0.8 });
  if (o2.checks.friction) ok(`小需求（a_x=2 ⇒ 140N）在 μ=0.8 锥内（上限 549N）`);
  else bad(`小需求被摩擦锥误杀`);
}

// ══ E. ZMP 在 f_y ≈ 0 时必须是 NaN，不能给 0 ═══════════════════════════
log('');
log('══ E. 退化必须显式报出：f_y ≈ 0 ⇒ ZMP 无定义 ══');
{
  const cs = mkCs();
  const c = bothFeet();
  c[0]!.active = false; c[1]!.active = false;    // 双脚都离地（腾空）
  const o = solveGrfQp({ contacts: c, cs, aDesX: 0, aDesY: -G, aDesZ: 0, dhDes: null });
  log(`   腾空（a_des_y = −g ⇒ 自由落体）⇒  F_y = ${o.fTotal[1].toFixed(3)} N`
    + `   ZMP = (${o.zmp[0]}, ${o.zmp[1]})`);
  if (Number.isNaN(o.zmp[0])) ok('ZMP 报 NaN（无 f_y ⇒ CoP 无定义），而不是静默给 0');
  else bad(`ZMP 给出了 ${o.zmp[0]} —— 无 f_y 时 CoP 无定义，给数字就是编造`);
}

log('');
if (fails) { log(`✗ λ-QP 验收失败 ${fails} 项`); process.exit(1); }
log('★ λ-QP 验收全绿：竖向自动落到 mg、CoP 与摩擦锥可判、单边生效、退化显式报出');
# -*- coding: utf-8 -*-
"""probe-domain：姿态列 → **时间窗门禁**（用户 2026-10-06：
   「腰应该尽可能挺直」「就这么弯着和蹲下一样就别过门禁」「门禁别瞬间验证，要回读一小段时间」）"""
import io
P = 'tools/probe-domain.ts'
s = io.open(P, encoding='utf-8').read()

# ① Trace：加"腰最弯的那个关节"（3 个脊柱关节的 |矢状角| 取最大）
A = "  pitch: number; roll: number; spine1: number; ubY: number;"
assert A in s, 'A'
s = s.replace(A, """  pitch: number; roll: number; spine1: number; ubY: number;
  /** ★★★ **腰最弯的关节**（spine1/2/3 的 |矢状角| 最大值）—— 「腰应尽可能挺直」的判据 */
  spineMax: number;
  /** ★ 上身质心水平漂移速度（m/s，诊断"稳住"） */
  comV: number;""", 1)

B = "        pitch: rs.pitchDeg ?? 0, roll: rs.rollDeg ?? 0,\n        spine1: (rs.angleOf('spine1', 2) * 180) / Math.PI,\n        ubY: rs.com.y,"
assert B in s, 'B'
s = s.replace(B, """        pitch: rs.pitchDeg ?? 0, roll: rs.rollDeg ?? 0,
        spine1: (rs.angleOf('spine1', 2) * 180) / Math.PI,
        spineMax: Math.max(
          Math.abs((rs.angleOf('spine1', 2) * 180) / Math.PI),
          Math.abs((rs.angleOf('spine2', 2) * 180) / Math.PI),
          Math.abs((rs.angleOf('spine3', 2) * 180) / Math.PI)),
        comV: Math.hypot(rs.com.vx ?? 0, rs.com.vz ?? 0),
        ubY: rs.com.y,""", 1)

# ② 姿态列 → 时间窗门禁
C = "  tool@@@"
i0 = s.index("  // ★★★ §22.12.4：**姿态列**")
i1 = s.index("  log('  归因：钉死 DOUBLE 也一样倒")
BLK = """  // ══════════════════════════════════════════════════════════════
  // ★★★ **站立门禁（时间窗版）** —— 用户 2026-10-06 定调：
  //   「**腰应该尽可能挺直状态啊**。如果腰就这么弯着，和蹲下一样，那就别过门禁」
  //   「**门禁别瞬间验证，需要回读一小段时间的状态，确定是真的能稳住身体了**」
  //
  //   ⇒ 判据**不是**末帧，也不是"最差值"，而是：
  //     **连续满足"腰挺直 + 躯干直立 + 上身没塌"的最长时长**，达不到窗长不算过。
  //     （之前用"存活时间"当判据，被"折腰熬满 12s"骗过整整一轮，见 §22.12.3）
  // ══════════════════════════════════════════════════════════════
  const WIN = Number(process.env.PD_WIN ?? 1.0);       // 需要连续挺直多久才算过（s）
  const LIM = Number(process.env.PD_LIM ?? 10);        // 挺直上限（度）
  const YMIN = Number(process.env.PD_YMIN ?? 0.85);    // 上身 CoM 最低高度（m）
  log(`\\n  ══ 站立门禁（时间窗 ${WIN}s：|pitch|<${LIM}° 且 腰最弯<${LIM}° 且 CoM.y>${YMIN}m）══`);
  log('     用例              最长挺直窗口   其中"稳住"窗口  末帧腰最弯  判定');
  for (const [nm, r] of [['默认（迈步开）', a], ['迈步系统停手', b], ['关发力门禁', capOff],
    ['关力链低通', fltOff], ['关上身架构', upOff], ['停手+关架构', upOffStepOff],
    ['钉死 DOUBLE', c]] as const) {
    const tr = r.trace;
    if (!tr.length) { log(`     ${nm.padEnd(16)} 无数据`); continue; }
    const hz = tr.length / (tr[tr.length - 1] ? secs(r.ticks) : 1);
    let best = 0, run = 0, bestSteady = 0, steady = 0;
    for (const t of tr) {
      const upright = Math.abs(t.pitch) < LIM && t.spineMax < LIM && t.ubY > YMIN;
      run = upright ? run + 1 : 0;
      if (run > best) best = run;
      // "稳住"= 挺直 **且** 上身几乎不漂（<0.15 m/s）
      const ok = upright && t.comV < 0.15;
      steady = ok ? steady + 1 : 0;
      if (steady > bestSteady) bestSteady = steady;
    }
    const dur = (n: number): number => (hz > 0 ? n / hz : 0);
    const pass = dur(best) >= WIN;
    log(`     ${nm.padEnd(16)} ${dur(best).toFixed(2).padStart(8)}s`
      + `      ${dur(bestSteady).toFixed(2).padStart(8)}s`
      + `      ${tr[tr.length - 1]!.spineMax.toFixed(1).padStart(7)}°`
      + `    ${pass ? '★ 过门禁' : '✗ 不过（腰弯/在倒）'}`);
  }
"""
s = s[:i0] + BLK + s[i1:]
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('probe-domain 门禁改为时间窗 ok')

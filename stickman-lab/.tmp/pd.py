# -*- coding: utf-8 -*-
import io
P = 'tools/probe-domain.ts'
s = io.open(P, encoding='utf-8').read()

A = "  cycles: number;\n  clearance: number;"
assert A in s, 'A'
s = s.replace(A, A + "\n  /** ★★★ 姿态（2026-10-06 加，§22.12.4）：**“不倒”不等于“站住”** —— 必须同时看姿态 */\n  pitch: number; roll: number; spine1: number; ubY: number;", 1)

B = "        cycles: rs.cycleCount, clearance: rs.swingClearance,"
assert B in s, 'B'
s = s.replace(B, B + "\n        pitch: rs.pitchDeg ?? 0, roll: rs.rollDeg ?? 0,\n        spine1: (rs.angleOf('spine1', 2) * 180) / Math.PI,\n        ubY: rs.com.y,", 1)

C = "  log('  归因：钉死 DOUBLE 也一样倒"
assert C in s, 'C'
BLK = """  // ★★★ §22.12.4：**姿态列** —— 「不倒」≠「站住」（那个 12.00s 曾是折腰熬满的）
  log('\n  ══ 姿态列（§22.12.4：不倒 ≠ 站住）══');
  for (const [nm, r] of [['默认（迈步开）', a], ['迈步系统停手', b], ['关发力门禁', capOff],
    ['关力链低通', fltOff], ['关上身架构', upOff], ['停手+关架构', upOffStepOff],
    ['钉死 DOUBLE', c]] as const) {
    const tr = r.trace;
    const last = tr[tr.length - 1];
    if (!last) { log(`  ${nm.padEnd(16)} 无数据`); continue; }
    let wp = 0, ws = 0;
    for (const t of tr) {
      if (Math.abs(t.pitch) > Math.abs(wp)) wp = t.pitch;
      if (Math.abs(t.spine1) > Math.abs(ws)) ws = t.spine1;
    }
    log(`  ${nm.padEnd(16)} 末帧 pitch ${last.pitch.toFixed(1).padStart(6)}° spine1 ${last.spine1.toFixed(1).padStart(6)}°`
      + ` CoM.y ${(last.ubY * 1000).toFixed(0)}mm  ｜ 最差 |pitch| ${Math.abs(wp).toFixed(1)}° |spine1| ${Math.abs(ws).toFixed(1)}°`
      + `  ${Math.abs(wp) < 10 && Math.abs(ws) < 10 ? '★ 站住' : '✗ 折腰/倒'}`);
  }
"""
s = s.replace(C, BLK + C, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('probe-domain ok')

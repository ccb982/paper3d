# -*- coding: utf-8 -*-
import io

# ---- selftest [12p] ----
p = 'rts/scripts/engine-selftest.ts'
s = io.open(p, encoding='utf-8').read()
old = "import { coverPoint, threePoint } from '../src/systems/swarm/CoverGeom.ts';"
assert old in s, 'imp'
s = s.replace(old, old + "\nimport { stepHoldCover, newHoldCoverState } from '../src/systems/swarm/squad/HoldCover.ts';", 1)
mark = "// ---------- \u5de5\u5175\u91cd\u505a"
assert mark in s, 'mark'
block = (
"// ---------- \u9a7b\u5b88=\u961f\u957f\u72b6\u6001\uff1a\u81ea\u4e3b\u63a9\u4f53\u5faa\u73af\uff08\u7528\u6237\u5b9a 2026-09-29\uff09 ----------\n"
"console.log('[12p] \u9a7b\u5b88\u72b6\u6001\uff1a\u81ea\u4e3b\u63a9\u4f53\u5faa\u73af\uff08\u85cf\u2192\u6bc1\u2192\u64a4\u2192\u518d\u8fdb\uff09');\n"
"{\n"
"  const ship = { x: 0, z: 0 };\n"
"  const st = newHoldCoverState(0);\n"
"  const covers = [{ x: 98, z: 0 }, { x: 110, z: 0 }, { x: 88, z: 0 }];\n"
"  const t1 = stepHoldCover(st, 0, { x: 120, z: 0 }, ship, covers);\n"
"  ok(st.phase === 'hide' && st.cover?.x === 88 && Math.abs(t1.x - 89.6) < 0.1, '\u2605 \u85cf\uff1a\u9009\u66f4\u9760\u8230\u7684\u63a9\u4f53\u3001\u8eb2\u5176\u80cc\u8230\u4fa7');\n"
"  const t2 = stepHoldCover(st, 1, { x: 89.6, z: 0 }, ship, [{ x: 98, z: 0 }, { x: 110, z: 0 }]);\n"
"  ok(st.phase === 'hide' && st.cover?.x === 110 && Math.abs(t2.x - 111.6) < 0.1, '\u2605 \u6bc1\uff1a\u6539\u8eb2\u66f4\u8fdc\uff08\u66f4\u5b89\u5168\uff09\u63a9\u4f53');\n"
"  const t3 = stepHoldCover(st, 20, { x: 111.6, z: 0 }, ship, [{ x: 98, z: 0 }, { x: 110, z: 0 }]);\n"
"  ok(st.phase === 'hide' && st.cover?.x === 98 && Math.abs(t3.x - 99.6) < 0.1, '\u2605 \u8fdb\uff1a\u85cf\u591f 15s \u2192 \u518d\u5411\u8230\u524d\u79fb\u4e00\u4e2a\u63a9\u4f53');\n"
"  const t4 = stepHoldCover(st, 50, { x: 99.6, z: 0 }, ship, []);\n"
"  ok(st.phase === 'retreat' && t4.x > 109, '\u2605 \u65e0\u63a9\u4f53 \u2192 \u80cc\u8230\u8131\u79bb\uff08\u540e\u64a4\uff09');\n"
"}\n\n"
)
s = s.replace(mark, block + mark, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok selftest')

# ---- 文档：canon ----
p = '蜂群架构定稿.md'
s = io.open(p, encoding='utf-8').read()
old = "| `hold` | `target` | 到点停；持续执行到被新命令覆盖 |"
assert old in s, 'doc row'
s = s.replace(old, "| `hold` | `target`（可选锚） | **队长状态**：自主掩体循环（藏→毁→撤→再进）；持续到被新命令覆盖 |", 1)
old2 = "- **标签执行实现保留**（用户定 2026-09-27）：管理器简洁 ≠ 删行为实现——"
assert old2 in s, 'doc keep'
s = s.replace(old2, old2 + "\n  **驻守=队长状态**（用户定 2026-09-29）：不钉死一点——自主找更靠舰的掩体背后藏、掩体被毁则撤到更安全掩体、过段时间再向前（`squad/HoldCover.ts`）。", 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok doc')

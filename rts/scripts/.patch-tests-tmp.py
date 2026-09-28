# -*- coding: utf-8 -*-
import io

p = 'scripts/engine-selftest.ts'
s = io.open(p, encoding='utf-8').read()

# 删块（先删前面的，索引会变化 → 每删一次重新 index）
def cut(start_marker, end_marker):
    global s
    a = s.index(start_marker)
    b = s.index(end_marker, a)
    s = s[:a] + s[b:]

cut(u"// ---------- \u590d\u5408 \u2192 \u539f\u5b50\uff08\u961f\u957f\u5c42\u6761\u4ef6\u8868\uff09", u"// ---------- \u65bd\u5de5\u76ee\u6807\u83b7\u53d6\u5951\u7ea6")
cut(u"// ---------- Spread / OrderValidator ----------", u"// ---------- OrderWriter ----------")
cut(u"// ---------- DecisionChain \u663e\u5f0f\u4f18\u5148\u94fe ----------", u"// ---------- \u6218\u672f\u4fa7\uff1a\u6247\u533a\u6784\u5efa")
cut(u"// ---------- advancePoint \u53ef\u884c\u6027 + \u951a\u56de\u9000\uff08\u7528\u6237\u5b9a 2026-09-27\uff09 ----------", u"// ---------- \u5230\u4e8b\u6001\u4e0a\u9650")
cut(u"// ---------- \u5230\u4e8b\u6001\u4e0a\u9650", u"// ---------- \u5de5\u5175\u91cd\u505a")

# 删相关 import
for line in list(s.split('\n')):
    if ('interpretLeader' in line or 'validateOrder' in line or 'spreadFix' in line or 'decideChain' in line
            or 'DecisionChain' in line or 'wellFormed' in line or 'interpretEngine' in line
            or 'OrderValidator' in line or 'Spread' in line) and line.startswith('import'):
        s = s.replace(line + '\n', '', 1)

# [12] 段：替换 spread/emit/refresh 断言
a = s.index(u"  // \u8fd1\u6218 2 \u961f\u540c\u5175\u79cd\u592a\u8fd1 \u2192 \u4e0b\u53d1\u76ee\u6807")
b = s.index(u"  // \u73a9\u5bb6\u547d\u4ee4\uff1a\u968f\u968f\u4fbf\u4fbf\u5c31\u80fd\u4e0b", a)
s = s[:a] + (
    u"  // \u2605 \u552f\u4e00\u515c\u5e95\uff08\u5b9a\u7a3f\u7b2c 8 \u6761\uff09\uff1a\u65e0\u7ba1\u7406\u5668\u76ee\u6807 \u2192 \u884c\u519b\u6bb5\uff08\u671d\u8230\u63a8\u4e00\u6bb5 \u226430m\uff09\n"
    u"  const o1 = bridge.writer.store.get(1)!.order;\n"
    u"  const o2 = bridge.writer.store.get(2)!.order;\n"
    u"  ok(o1.state === 'march' && o1.target.x > 50 && o1.target.x <= 81, '\u2605 \u515c\u5e95\uff1a\u9996\u62cd\u884c\u519b\u6bb5\uff08\u671d\u8230 \u226430m\uff09');\n"
    u"  ok(o2.state === 'march', '\u2605 \u515c\u5e95\uff1a\u6240\u6709\u961f\u540c\u53e3\u5f84\uff08\u65e0\u9009\u4f4d/\u95f4\u8ddd\u673a\u5236\uff09');\n"
) + s[b:]

old = (
    u"  // \u5b9e\u673a\u6a21\u5f0f\uff1aemit \u771f\u4e0b\u53d1\n"
    u"  bridge.shadow = false;\n"
    u"  bridge.tick(0.6, 2.2);\n"
    u"  ok(emitted.length >= 1, '\u5b9e\u673a\u6a21\u5f0f emit \u4e0b\u53d1');\n"
    u"  ok(bridge.writer.dbg.issued >= 1, '\u53d1\u4ee4\u5668\u53f0\u8d26');"
)
new = (
    u"  // \u5b9e\u673a\u6a21\u5f0f\uff1a\u73a9\u5bb6\u4ee4\u76f4\u8fbe\u961f\u957f\uff08emit\uff09\n"
    u"  bridge.shadow = false;\n"
    u"  bridge.tick(0.6, 2.2);\n"
    u"  const pOk2 = bridge.playerOrder(2, 'garrison', { x: 5, z: 5 });\n"
    u"  ok(pOk2 && emitted.length >= 1, '\u5b9e\u673a\u6a21\u5f0f emit \u4e0b\u53d1\uff08\u73a9\u5bb6\u4ee4\u76f4\u8fbe\u961f\u957f\uff09');\n"
    u"  ok(bridge.writer.dbg.issued >= 1, '\u53d1\u4ee4\u5668\u53f0\u8d26');"
)
assert old in s, 'emit'
s = s.replace(old, new, 1)

old = (
    u"  // \u2605 \u6267\u884c\u677f\u7eed\u671f\uff08\u65e7\u94fe\u5df2\u5220\uff09\uff1a\u73a9\u5bb6\u4ee4\u5728\u8eab \u2192 \u51b3\u7b56\u4e3a\u7a7a\uff0c\u4f46\u6267\u884c\u677f\u6bcf\u62cd\u4ecd\u540c\u6b65\u73b0\u4ee4\uff08\u4e0d\u6389\u4ee4\uff09\n"
    u"  bridge.tick(0.6, 2.8);\n"
    u"  ok(bridge.dbg.refreshed >= 1, '\u6267\u884c\u677f\u7eed\u671f\u8ba1\u6570\uff08\u65e0\u65b0\u4ee4\u4e5f\u4e0d\u4e22\u6267\u884c\u4ee4\uff09');"
)
new = (
    u"  // \u2605 \u7a33\u6001\u4e0d\u91cd\u53d1\uff08\u5b9a\u7a3f\u7b2c 3 \u6761\uff09\uff1a\u73a9\u5bb6\u4ee4\u5728\u8eab \u2192 \u5f15\u64ce\u4e0d\u8986\u76d6\u3001\u4e0d\u9010\u62cd\u91cd\u53d1\n"
    u"  bridge.tick(0.6, 2.8);\n"
    u"  ok(bridge.writer.store.get(2)?.order.source === 'player', '\u2605 \u73a9\u5bb6\u4ee4\u4e0d\u8fc7\u671f\uff08\u6267\u884c\u677f\u4e0d\u518d\u9010\u62cd\u91cd\u53d1\uff09');"
)
assert old in s, 'refresh'
s = s.replace(old, new, 1)

# [12d] 总攻：mission → state==='assault'
s = s.replace(
    u"ok(o1.kind === 'patrol' && o2.kind === 'patrol' && o3.kind === 'patrol' && o1.mission === 'patrol', '\u2605 \u603b\u653b\uff1a\u5168\u5175\u79cd\u5747\u4e3a patrol\uff08\u5230\u9876\u7ef4\u6301\u5de1\u903b\uff1b\u53bb\u6389\u5176\u4ed6\u6307\u4ee4\uff09');",
    u"ok(o1.kind === 'patrol' && o2.kind === 'patrol' && o3.kind === 'patrol' && o1.state === 'assault', '\u2605 \u603b\u653b\uff1a\u5168\u5175\u79cd\u6807\u7b7e=assault\uff08\u5230\u8230\u544a\u7ec8\uff09');",
    1)

# [12g]/[12h]：mission='patrol' → state==='patrol'
s = s.replace(u"br.writer.store.get(1)!.order.mission === 'patrol'", u"br.writer.store.get(1)!.order.state === 'patrol'")
s = s.replace(u"a2.mission === 'patrol'", u"a2.state === 'patrol'")
s = s.replace(u"a3.mission === 'patrol' && Math.abs(a3.target.x - 105) < 1.5", u"a3.state === 'patrol' && Math.abs(a3.target.x - 105) < 1.5")

# [12f]：删 forceRepath/anchorOf 注入
s = s.replace(u"    forceRepath: (id: number) => calls.push(id),\n", u"")
s = s.replace(u"    anchorOf: () => ({ x: 150, z: 20 }),\n", u"")
s = s.replace(u"  void calls;\n", u"")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok selftest')

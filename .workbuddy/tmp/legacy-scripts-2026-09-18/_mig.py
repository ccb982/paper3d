import re, os
ROOT = r"C:\Users\22641\Desktop\架构重置\全新的游戏\src"
wm = open(os.path.join(ROOT, "modes/WorldMode.ts"), encoding="utf-8", errors="replace").read()
lines = wm.split("\n")

TARGETS = ["scanAndSpawnWaves","spawnBoss","onBossDefeated","spawnDirectorWave","spawnWaveNear",
           "pickMob","demoteFarEnemies","agentMelee","spawnStressAgents","mobAgentStats",
           "spawnOne","quotaAllows","promoteAgent","rollDropsFromDef","onAgentKilled"]

# 找所有方法定义行（2 空格缩进 + 可选修饰 + 名字 + 参数括号 + {）
defs = []
for i, l in enumerate(lines):
    m = re.match(r"  (?:private\s+|public\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(", l)
    if m and m.group(1) not in ("if","for","while","switch","catch","return","constructor"):
        defs.append((m.group(1), i))
defs.sort(key=lambda x: x[1])

print("=== 目标方法：行数 / 依赖字段 / 依赖方法 ===")
total = 0
for name, start in defs:
    if name not in TARGETS:
        continue
    # 结束 = 下一个方法定义 or 下一个顶层注释块前的 "  }"
    nxt = next((s for (n2, s) in defs if s > start), len(lines))
    body = "\n".join(lines[start:nxt])
    # 截到第一个行首 "  }"
    end_rel = None
    for j, l in enumerate(lines[start:nxt]):
        if l == "  }":
            end_rel = j; break
    n = (end_rel + 1) if end_rel else (nxt - start)
    total += n
    body = "\n".join(lines[start:start+n])
    fields = sorted(set(re.findall(r"this\.([a-zA-Z_]\w*)", body)))
    # 区分字段 vs 方法调用（后面跟 "("）
    meths = sorted({f for f in re.findall(r"this\.([a-zA-Z_]\w*)\s*\(", body)})
    props = sorted(set(fields) - set(meths))
    print(f"\n-- {name}  {n} 行")
    print("   this.字段:", ", ".join(props))
    print("   this.方法:", ", ".join(meths))
print(f"\n合计 {total} 行")

print("\n=== 这些方法在 WorldMode 内被调用的位置 ===")
for name in TARGETS:
    hits = [i+1 for i, l in enumerate(lines) if re.search(r"this\." + name + r"\s*\(", l)]
    print(f"  {name:22s} {hits}")

print("\n=== 全仓对 WorldMode 这些方法的外部引用（应为 0）===")
for p, d, f in os.walk(ROOT):
    for fn in f:
        if not fn.endswith(".ts"): continue
        fp = os.path.join(p, fn)
        if fp.endswith("WorldMode.ts"): continue
        t = open(fp, encoding="utf-8", errors="replace").read()
        for name in TARGETS:
            if re.search(r"\." + name + r"\s*\(", t):
                print(f"  {name} <- {os.path.relpath(fp, ROOT)}")

import re, os
ROOT = r"C:\Users\22641\Desktop\架构重置\全新的游戏\src"
wm = open(os.path.join(ROOT, "modes/WorldMode.ts"), encoding="utf-8", errors="replace").read()
lines = wm.split("\n")
defs = []
for i, l in enumerate(lines):
    m = re.match(r"  (?:private\s+|public\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(", l)
    if m and m.group(1) not in ("if","for","while","switch","catch","return","constructor"):
        defs.append((m.group(1), i+1))

print("=== 1900-2500 行区间的方法（刷怪相关可能还有遗漏）===")
for n, ln in defs:
    if 1850 <= ln <= 2500:
        print(f"  {ln:5d}  {n}")

print("\n=== 全仓 systems/swarm 目录 ===")
d = os.path.join(ROOT, "systems/swarm")
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f)
    if os.path.isfile(p):
        print(f"  {f}  {sum(1 for _ in open(p, encoding='utf-8', errors='replace'))} 行")

print("\n=== spawn/createEnemy 相关的其它方法 ===")
for n, ln in defs:
    if any(k in n.lower() for k in ["spawn", "enemy", "mob", "wave", "quota", "kill", "drop"]):
        print(f"  {ln:5d}  {n}")

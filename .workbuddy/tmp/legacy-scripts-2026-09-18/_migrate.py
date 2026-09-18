import re, os, json
ROOT = r"C:\Users\22641\Desktop\架构重置\全新的游戏\src"
WM = os.path.join(ROOT, "modes/WorldMode.ts")
lines = open(WM, encoding="utf-8", errors="replace").read().split("\n")
SEG = (1916, 2471)
seg_text = "\n".join(lines[SEG[0]-1:SEG[1]])
# 所有标识符（含小写函数名）
idents = set(re.findall(r"\b([A-Za-z_]\w*)\b", seg_text))
# 额外：deps 字段的类型名
extra = "EnemyBase MobDef Player ShipEntity EntityManager SwarmSystem Director ChunkManager RasterMap "\
        "GameSession EnemyScale ThreatProfile DroneEntity WorldUIManager FtxAsset THREE Scene PerspectiveCamera "\
        "WeakMap Asset".split()
idents |= set(extra)
import_block = [l for l in lines[:130] if l.startswith("import ")]
kept, dropped = [], []
for l in import_block:
    names = set(re.findall(r"[A-Za-z_]\w*", l.split(" from ")[0]))
    (kept if names & idents else dropped).append(l)
print("=== 保留 ===")
for l in kept: print("  ", l.replace("'../", "'../../"))
print("\n=== 丢弃（人工复核有没有漏）===")
for l in dropped[:40]: print("  ", l)

print("\n=== scalingInputs 类型（390 行起）===")
for i in range(388, 400):
    print(f"{i+1}: {lines[i]}")

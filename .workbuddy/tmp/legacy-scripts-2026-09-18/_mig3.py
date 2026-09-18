import re, os
ROOT = r"C:\Users\22641\Desktop\架构重置\全新的游戏\src"
wm = open(os.path.join(ROOT, "modes/WorldMode.ts"), encoding="utf-8", errors="replace").read()
lines = wm.split("\n")

# 刷怪段区间（含）与其它区间
SEG = (1916, 2479)
fields = ["enemies","bossEntity","bossRun","threat","spawnedChunks","spawnChunkKey",
          "mobDefs","enemyDefs","enemyScale","scalingInputs","enemyScaleInputs",
          "spawner","bossAsset","onReturn"]
for f in fields:
    inSeg = outSeg = 0
    out_samples = []
    for i, l in enumerate(lines, start=1):
        if re.search(r"this\." + f + r"\b", l):
            if SEG[0] <= i <= SEG[1]:
                inSeg += 1
            else:
                outSeg += 1
                if len(out_samples) < 6:
                    out_samples.append(f"{i}: {l.strip()[:90]}")
    print(f"\n== {f}: 段内 {inSeg} / 段外 {outSeg}")
    for s in out_samples:
        print("     ", s)

# 段内用到的外部 import 类型（搬到新文件要带上的 import）
seg = "\n".join(lines[SEG[0]-1:SEG[1]])
print("\n=== 需要确认的来源：段内出现的标识符（大写开头 = 类型/类）===")
idents = sorted(set(re.findall(r"\b([A-Z][A-Za-z0-9_]{2,})\b", seg)))
print(", ".join(idents))

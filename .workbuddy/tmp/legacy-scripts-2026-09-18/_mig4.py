import re, os
ROOT = r"C:\Users\22641\Desktop\架构重置\全新的游戏\src"
lines = open(os.path.join(ROOT, "modes/WorldMode.ts"), encoding="utf-8", errors="replace").read().split("\n")
SEG = (1916, 2472)
CONSTS = ["MAX_ALIVE","ENEMY_CULL_RADIUS","AMBIENT_PRELOAD_RATIO","SHIP_GROUP_RADIUS",
          "SHIP_GROUP_COUNT","SHIP_GROUP_SUSTAIN","SHIP_GROUP_HIDE_COUNT",
          "SHIP_INTENT_COUNT","SHIP_INTENT_SUSTAIN","SHIP_INTENT_HIDE"]
for c in CONSTS:
    inSeg, outSeg, samples = 0, 0, []
    for i, l in enumerate(lines, start=1):
        if re.search(r"WorldMode\." + c + r"\b", l) or re.search(r"(?:static\s+readonly\s+)" + c + r"\b", l):
            if SEG[0] <= i <= SEG[1]: inSeg += 1
            else:
                outSeg += 1
                if len(samples) < 4: samples.append(f"{i}: {l.strip()[:80]}")
    print(f"{c:24s} 段内 {inSeg} / 段外 {outSeg}")
    for s in samples: print("      ", s)

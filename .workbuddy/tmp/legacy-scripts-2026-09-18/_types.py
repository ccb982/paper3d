import re
p = r"C:\Users\22641\Desktop\架构重置\全新的游戏\src\modes\WorldMode.ts"
lines = open(p, encoding="utf-8", errors="replace").read().split("\n")
need = ["enemies","enemyDefs","bossRun","spawnChunkKey","scalingInputs","groupWarnAccum",
        "groupWarnShown","player","ship","entities","swarm","swarmDirector","testChunk","shipDestroyed"]
for n in need:
    print(f"--- {n}")
    for i, l in enumerate(lines, 1):
        if re.match(r"^\s{2}(?:private\s+|public\s+|protected\s+|readonly\s+)*" + n + r"\s*[!?]?\s*[:=]", l):
            # 多行类型：直到出现 ; 或 = 或 {
            s = l.strip()
            j = i
            while j < len(lines) and not re.search(r"[;{=]\s*$", s) and (j - i) < 5:
                j += 1
                s += " " + lines[j-1].strip()
            print(f"   {i}: {s[:160]}")
            break
    else:
        print("   (未找到)")

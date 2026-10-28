#!/bin/bash
# 逐文件回退 bisect：每次只回退一个 src 文件，跑 A/B 看判死
set -e
cd "c:/Users/22641/Desktop/架构重置/stickman-lab-v2"
mkdir -p .tmp/bak
for f in src/core/servo/squat.ts src/core/court.ts src/core/servo/baseTable.ts src/core/servo/hipStrategy.ts; do
  cp "$f" ".tmp/bak/$(basename $f)"
done
for f in src/core/servo/squat.ts src/core/court.ts src/core/servo/baseTable.ts src/core/servo/hipStrategy.ts; do
  git checkout -- "$f"
  echo "════ 回退 $f ════"
  node tools/run.mjs _tmp-ab 2>&1 | grep -E "^ (当前默认|KEEP|关)" || true
  cp ".tmp/bak/$(basename $f)" "$f"
done
echo "════ 全部还原完毕 ════"

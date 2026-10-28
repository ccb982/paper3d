#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""踝被动刚度默认 KA 30 → 60（实测扫描 tools/_tmp-ka2.ts）：
   KA=30  踝额状 9.4°  扭转 −5.4°
   KA=60  踝额状 5.1°  扭转 −11.2°  左右不对称 0.02cm  不判死  ★最优
   KA=120 踝额状 2.6°  扭转 −13.5°  但膝额状升到 16.1°（偏差转移到膝）
"""
import io

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

OLD = "  const KA = Math.abs(Number(env.SQC_LT_K_ANKLE ?? 30));"
NEW = """  // ★ KA 实测扫描（tools/_tmp-ka2.ts）：30→60 让踝额状 9.4°→5.1°、扭转 −5.4°→−11.2°、
  //   左右不对称 0.13→0.02cm；再往上（120）踝更好但膝额状升到 16°（偏差转移到膝）⇒ 60 是拐点。
  const KA = Math.abs(Number(env.SQC_LT_K_ANKLE ?? 60));"""
assert OLD in src, 'KA not found'
src = src.replace(OLD, NEW)

io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""被动张力只写踝（额状 + 扭转）。髋/膝的扭转轴留给专门的限位机制。"""
import io

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

OLD = """      // 踝：额状轴(0)=内翻/外翻 + 扭转轴(1)=轴转，都归被动刚力
      // 膝：只取扭转轴（逻辑0；世界轴 [0.263,0.965,0.004] ≈ 纯竖直 ⇒ 纯扭转）
      // 髋：**不写** —— 髋扭转轴（逻辑1）世界轴 [0.464,0.886,0] 偏离竖直 27.6°
      //     ⇒ 绕它转会带出矢状/额状分量 ⇒ 实测它自己就是扭转来源
      //     （关掉被动张力 Δ大腿yaw 40.9° → 1.7°）
      const isTwist = part === 'hip' ? false : part === 'knee' ? ax === 0 : true;
      if (!isTwist) continue;"""

NEW = """      // ★ 只写**踝**（额状轴0=内翻/外翻、扭转轴1=轴转）。
      //   髋/膝的扭转轴**不写** —— 实测（tools/_tmp-sag.ts）：
      //     写髋扭转轴 → Δ大腿yaw 40.9°（它自己就是扭转来源；世界轴偏离竖直 27.6°）
      //     写膝扭转轴 → Δ大腿yaw 32.5°（世界轴 [0.263,0.965,0.004] 偏离竖直 15.3°，
      //       且该轴的 rest=8° 已被 preRing 外八偏置占用 ⇒ 不是干净的扭转自由度）
      //     只写踝 → Δ大腿yaw 1.6° ✔
      //   ⇒ 大腿/小腿的「别拧过头」由**解剖限位**负责（限位通道），不由被动张力负责；
      //     被动张力负责**踝**（内翻/外翻 + 轴转）——踝的额状轴 [0.873,−0.488,0]
      //     才是干净的额状自由度，且踝是唯一能改 CoP 的执行器。
      if (part !== 'foot') continue;"""

assert OLD in src, 'not found'
src = src.replace(OLD, NEW)
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

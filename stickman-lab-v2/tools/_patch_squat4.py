#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""被动张力只写「轴向纯」的轴：膝扭转轴（世界轴≈纯竖直）+ 踝两轴。
   髋扭转轴的世界轴 x 分量 0.464（偏离竖直 27.6°）⇒ 绕它转会带出矢状/额状分量
   ⇒ 实测它自己就是扭转的来源（关掉被动张力 Δ大腿yaw 40.9° → 1.7°）。"""
import io

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

OLD = """      // 踝：额状轴(0)=内翻/外翻 + 扭转轴(1)=轴转，都归被动刚力
      // 髋/膝：只取扭转轴 —— 髋 逻辑1=扭转、膝 逻辑0=扭转（见 jointPlane.ts 实测表）
      const isTwist = part === 'hip' ? ax === 1 : part === 'knee' ? ax === 0 : true;
      if (!isTwist) continue;"""

NEW = """      // 踝：额状轴(0)=内翻/外翻 + 扭转轴(1)=轴转，都归被动刚力
      // 膝：只取扭转轴（逻辑0；世界轴 [0.263,0.965,0.004] ≈ 纯竖直 ⇒ 纯扭转）
      // 髋：**不写** —— 髋扭转轴（逻辑1）世界轴 [0.464,0.886,0] 偏离竖直 27.6°
      //     ⇒ 绕它转会带出矢状/额状分量 ⇒ 实测它自己就是扭转来源
      //     （关掉被动张力 Δ大腿yaw 40.9° → 1.7°）
      const isTwist = part === 'hip' ? false : part === 'knee' ? ax === 0 : true;
      if (!isTwist) continue;"""

assert OLD in src, 'not found'
src = src.replace(OLD, NEW)
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

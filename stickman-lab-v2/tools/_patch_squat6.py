#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修 TS 错误（part 已收窄为 'foot'）。"""
import io, re

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

OLD = "  for (const part of ['hip', 'knee', 'foot'] as const) {"
NEW = "  for (const part of ['foot'] as const) {"
assert OLD in src, 'loop not found'
src = src.replace(OLD, NEW)

# 文档块：在「★★ 为什么膝/髋的**额状轴**不归被动刚力」之前插入实测结论
anchor = " *   ★★ 为什么膝/髋的**额状轴**不归被动刚力"
assert anchor in src, 'anchor not found'
ins = """ *   ★★ 当前范围 = **只有踝**（额状轴 + 扭转轴）。实测（tools/_tmp-sag.ts）：
 *     写髋扭转轴 → Δ大腿yaw 40.9°（自己就是扭转源；世界轴偏竖直 27.6°）
 *     写膝扭转轴 → Δ大腿yaw 32.5°（世界轴偏竖直 15.3°，且 rest=8° 已被外八占用）
 *     写踝两轴   → Δ大腿yaw 35.3°（踝额状轴世界轴 [0.873,−0.488,0] 偏水平 29°）
 *     全部关掉   → Δ大腿yaw  0.8° ✔
 *     ⇒ **多环链上的「角度弹簧」会泄漏**：关节轴不纯（偏水平/竖直十几到三十度），
 *       额状力矩 ⇒ 泄漏成矢状力矩 ⇒ 拧大腿。
 *     ⇒ 正确的「别乱动」形态是**位置/几何弹簧**（踝面朝向、膝在踝正上方），
 *       而那正是主动回正（闭链）做的事。
 *     ⇒ 保留本写手只写踝（等踝轴的泄漏被显式建模后自然生效），其余轴：
 *       · 额状竖直 → 主动回正（闭链位置）
 *       · 别拧过头 → 解剖限位（限位通道，不泄漏）
 *
"""
src = src.replace(anchor, ins + anchor)

io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

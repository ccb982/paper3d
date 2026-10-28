#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修主动回正的左右对称：膝残差是位置量（膝z−踝z，两侧同号约定），
   但物理镜像要求左右 τ **反号**（实测标定 tools/_tmp-signcal2.ts：
   反号 τ = 镜像效果；同号 τ = 同向效果）。
   ⇒ 右腿残差取反后再算力矩。"""
import io

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\hipStrategy.ts'
src = io.open(p, encoding='utf-8').read()

OLD = """  const tauKneeL = sgn * (kpKneeL * kneeL - kd * rate.kneeL);
  const tauKneeR = sgn * (kpKneeR * kneeR - kd * rate.kneeR);"""

NEW = """  // ★ 左右镜像（实测 tools/_tmp-signcal2.ts）：
  //   膝额状轴左右世界轴**不是简单镜像**（x 分量同号、z 分量反号）⇒
  //     同号 τ ⇒ 两膝 z 同向移动（破对称）；**反号 τ ⇒ 镜像效果** ✔
  //   而 `kneeResidual` 是位置量（膝z − 踝z，两侧**同号**约定：正 = 外撇）
  //   ⇒ 必须把**右腿残差取反**，才能得到反号 τ。
  //   ★ 之前两侧用同一个 sgn ⇒ 同号 τ ⇒ 实测左右不对称（膝vs踝 L+1.31 / R−4.51cm）。
  const tauKneeL = sgn * (kpKneeL * kneeL - kd * rate.kneeL);
  const tauKneeR = sgn * (kpKneeR * -kneeR - kd * -rate.kneeR);"""

assert OLD in src, 'not found'
src = src.replace(OLD, NEW)
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

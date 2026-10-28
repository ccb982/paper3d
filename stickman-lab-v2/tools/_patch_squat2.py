#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回退「左右镜像归一」：实测证明反号 τ 才是镜像效果（标定 _tmp-signcal2.ts）"""
import io

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

OLD_DOC = """ * ── ★★★ 左右镜像归一（实测标定 tools/_tmp-signcal2.ts）──────────────────
 *   读数被 `mirrorSymmetric` 强制成镜像（左 = −右）⇒ `ref − d.angle` 左右反号
 *   ⇒ 发出**反号 τ** ⇒ 物理效果**同向**（实测 Δ膝z L=−2.81 / R=+3.91cm，不对称）。
 *   而**同号 τ** 才是镜像效果（实测 Δ膝z L=−8.61 / R=−9.28cm ✔）。
 *   ⇒ 只用**左腿**读数算 dev，左右发**同号 τ**。
"""
NEW_DOC = """ * ── ★★★ 左右力矩符号（实测标定 tools/_tmp-signcal2.ts）──────────────────
 *   膝额状轴的世界轴左右**不是简单镜像**：
 *     knee_l/1 = [−0.955, 0.261, −0.140]   knee_r/1 = [−0.955, 0.261, +0.141]
 *   （x 分量同号、只有 z 分量反号）⇒
 *     · **同号 τ** ⇒ 两膝 z **同向**移动（实测 Δ膝z L=−8.61 / R=−9.28cm）= 破对称 ✘
 *     · **反号 τ** ⇒ 两膝 z **反向**移动（实测 Δ膝z L=−2.81 / R=+3.91cm）= 对称 ✔
 *   而读数被 `mirrorSymmetric` 强制成镜像（左 = −右）⇒ `ref − d.angle` 左右天然反号
 *   ⇒ **左右各自算 dev、发反号 τ ⇒ 物理效果对称**（这是本写手一直用的写法，正确）。
"""

OLD_BODY = """  // 逐「部位·逻辑轴」处理；左右镜像归一（只用左腿读数算 dev，同号 τ）
  for (const part of ['hip', 'knee', 'foot'] as const) {
    for (const ax of [0, 1] as const) {
      const dl = w.body.dofByName(`${part}_l`, ax);
      if (dl < 0) continue;
      const d0 = w.body.dofs[dl]!;
      if (d0.preRing || d0.engineMotor) continue;
      // 目标：zero = 几何零（读数 0，腿竖直）；pose = 摆姿快照
      const ref = target === 'pose' ? squatStandardAngle(`${part}_l`, ax) : 0;
      if (ref === undefined) continue;                        // 没捕获标准姿势 → 不出力
      const dev = ref - d0.angle;
      const isAnkle = part === 'foot';
      if (Math.abs(dev) < (isAnkle ? deadA : dead)) continue;
      // 解剖软边界：髋用解剖值；膝/踝用当前关节限位（蹲姿已放宽）
      const soft = part === 'hip'
        ? (ax === 0 ? hipAbd : hipRot)
        : Math.max(Math.abs(d0.min), Math.abs(d0.max));
      const over = Math.abs(dev) - soft;
      const kk = isAnkle ? KA : (over > 0 ? kOut : K);
      const bb = isAnkle ? BA : B;
      const cc = isAnkle ? capA : (over > 0 ? capOut : cap);
      for (const side of ['l', 'r'] as const) {
        const di = w.body.dofByName(`${part}_${side}`, ax);
        if (di < 0) continue;
        const d = w.body.dofs[di]!;
        if (d.preRing || d.engineMotor) continue;
        // 阻尼项用各自的速度（速度是物理量，未被镜像强制）
        let tau = kk * dev - bb * d.vel;
        tau = Math.max(-cc, Math.min(cc, tau));
        if (Math.abs(tau) < 1e-6) continue;
        propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.legTension', channel: 'passive' });
      }
    }
  }
}"""

NEW_BODY = """  // 逐「部位·逻辑轴」处理；左右各自算 dev（读数已镜像 ⇒ dev 反号 ⇒ τ 反号 ⇒ 效果对称）
  for (const part of ['hip', 'knee', 'foot'] as const) {
    for (const ax of [0, 1] as const) {
      for (const side of ['l', 'r'] as const) {
        const di = w.body.dofByName(`${part}_${side}`, ax);
        if (di < 0) continue;
        const d = w.body.dofs[di]!;
        if (d.preRing || d.engineMotor) continue;
        // 目标：zero = 几何零（读数 0，腿竖直）；pose = 摆姿快照
        const ref = target === 'pose' ? squatStandardAngle(`${part}_${side}`, ax) : 0;
        if (ref === undefined) continue;                      // 没捕获标准姿势 → 不出力
        const dev = ref - d.angle;
        const isAnkle = part === 'foot';
        if (Math.abs(dev) < (isAnkle ? deadA : dead)) continue;
        // 解剖软边界：髋用解剖值；膝/踝用当前关节限位（蹲姿已放宽）
        const soft = part === 'hip'
          ? (ax === 0 ? hipAbd : hipRot)
          : Math.max(Math.abs(d.min), Math.abs(d.max));
        const over = Math.abs(dev) - soft;
        const kk = isAnkle ? KA : (over > 0 ? kOut : K);
        const bb = isAnkle ? BA : B;
        const cc = isAnkle ? capA : (over > 0 ? capOut : cap);
        let tau = kk * dev - bb * d.vel;
        tau = Math.max(-cc, Math.min(cc, tau));
        if (Math.abs(tau) < 1e-6) continue;
        propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.legTension', channel: 'passive' });
      }
    }
  }
}"""

assert OLD_DOC in src, 'doc not found'
assert OLD_BODY in src, 'body not found'
src = src.replace(OLD_DOC, NEW_DOC).replace(OLD_BODY, NEW_BODY)
io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

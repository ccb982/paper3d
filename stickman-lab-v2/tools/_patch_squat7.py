#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""简化被动张力写手：只写踝（清理 TS 收窄后的死分支）。"""
import io

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

OLD = """      if (part !== 'foot') continue;
      for (const side of ['l', 'r'] as const) {
        const di = w.body.dofByName(`${part}_${side}`, ax);
        if (di < 0) continue;
        const d = w.body.dofs[di]!;
        if (d.preRing || d.engineMotor) continue;
        // 目标：zero = 解剖中立位（读数 0）；pose = 摆姿快照
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
      }"""

NEW = """      for (const side of ['l', 'r'] as const) {
        const di = w.body.dofByName(`foot_${side}`, ax);
        if (di < 0) continue;
        const d = w.body.dofs[di]!;
        if (d.preRing || d.engineMotor) continue;
        // 目标：zero = 解剖中立位（读数 0）；pose = 摆姿快照
        const ref = target === 'pose' ? squatStandardAngle(`foot_${side}`, ax) : 0;
        if (ref === undefined) continue;                      // 没捕获标准姿势 → 不出力
        const dev = ref - d.angle;
        if (Math.abs(dev) < deadA) continue;
        // 解剖软边界 = 当前关节限位（蹲姿已放宽）
        const soft = Math.max(Math.abs(d.min), Math.abs(d.max));
        const over = Math.abs(dev) - soft;
        const kk = over > 0 ? kOut : KA;
        const cc = over > 0 ? capOut : capA;
        let tau = kk * dev - BA * d.vel;
        tau = Math.max(-cc, Math.min(cc, tau));
        if (Math.abs(tau) < 1e-6) continue;
        propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.legTension', channel: 'passive' });
      }"""

assert OLD in src, 'body not found'
src = src.replace(OLD, NEW)

# 清理不再使用的常量（K/B/cap/dead/hipAbd/hipRot 现在只用于踝分支之外 → 全部未使用）
src = src.replace(
    "  const K = Math.abs(Number(env.SQC_LT_K ?? 60));            // N·m/rad（髋/膝）\n"
    "  const B = Math.abs(Number(env.SQC_LT_B ?? 3));             // N·m·s/rad\n"
    "  const cap = Math.abs(Number(env.SQC_LT_CAP ?? 60));         // N·m\n"
    "  const dead = Math.abs(Number(env.SQC_LT_DEAD_DEG ?? 0.5)) / 57.3;\n",
    "")
src = src.replace(
    "  const hipAbd = Math.abs(Number(env.SQC_HIP_SOFT_ABD_DEG ?? 20)) / 57.3;   // 髋外展\n"
    "  const hipRot = Math.abs(Number(env.SQC_HIP_SOFT_ROT_DEG ?? 15)) / 57.3;   // 髋轴转\n",
    "")

io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

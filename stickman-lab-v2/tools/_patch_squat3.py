#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""被动张力写手：按「两种东西」分工 —— 被动刚力只管解剖中立（扭转 + 踝额状），
   额状竖直交给主动回正（闭链位置）。"""
import io

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

OLD = """  // 逐「部位·逻辑轴」处理；左右各自算 dev（读数已镜像 ⇒ dev 反号 ⇒ τ 反号 ⇒ 效果对称）
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

NEW = """  // ★★★ 分工（用户 2026-10-28：「踝的被动刚力和回正力属于两种东西」）：
  //   被动刚力 = **解剖被动组织** ⇒ 目标是「解剖中立位」，只管**扭转**（外八）
  //              与**踝的内翻/外翻**（踝是唯一能改 CoP 的执行器）。
  //   主动回正 = **位置空间**（闭链：膝在踝正上方 / 髋水平）⇒ 由 squatHipStrategy 管。
  //   ⇒ 膝/髋的**额状轴**不归本写手：实测把膝额状从 14.5° 收到 0° 会让膝踝间距
  //     （32.6cm）收不拢 ⇒ 膝往中线挤 ⇒ 大腿被推开 8.8cm ⇒ 拧转反而更大
  //     （冻结期 Δ大腿yaw 4.3° → 26.5°）。「腿竖直」是**位置**问题，不是角度问题。
  for (const part of ['hip', 'knee', 'foot'] as const) {
    for (const ax of [0, 1] as const) {
      // 踝：额状轴(0)=内翻/外翻 + 扭转轴(1)=轴转，都归被动刚力
      // 髋/膝：只取扭转轴 —— 髋 逻辑1=扭转、膝 逻辑0=扭转（见 jointPlane.ts 实测表）
      const isTwist = part === 'hip' ? ax === 1 : part === 'knee' ? ax === 0 : true;
      if (!isTwist) continue;
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
      }
    }
  }
}"""

assert OLD in src, 'body not found'
src = src.replace(OLD, NEW)

# 文档块同步更新分工说明
OLD_DOC = """ * ═══ 用户定调（2026-10-28）══════════════════════════════════════════════
 *   「踝的被动刚力和回正力属于两种东西」
 *   「但是小腿腿偏了都要发力」
 *
 *   ⇒ **两种东西，两个写手，两个通道，但都作用在偏了的小腿上**：
 *     · 本写手 = **被动刚力**（解剖被动组织：韧带/肌腱/结缔组织的弹性力）
 *       通道 = passive，目标 = **解剖中立位（几何零）**
 *     · squatHipStrategy = **回正力**（主动策略，位置空间）
 *       通道 = active，目标 = **闭链位置基准**（脚落点推出来的膝/髋位置）
 *     两条通道在 executor 里**分开记账、最后相加**（`executor.ts:204,236`）
 *     ⇒ 物理上就是论文里的「主动肌肉 + 被动组织」并联承载，不是二选一、不是对拉。"""

NEW_DOC = """ * ═══ 用户定调（2026-10-28）══════════════════════════════════════════════
 *   「踝的被动刚力和回正力属于两种东西」
 *   「但是小腿腿偏了都要发力」
 *
 *   ⇒ **两种东西，两个写手，两个通道，但都作用在偏了的小腿上**：
 *     · 本写手 = **被动刚力**（解剖被动组织：韧带/肌腱/结缔组织的弹性力）
 *       通道 = passive，目标 = **解剖中立位**
 *       管的轴 = **扭转轴**（外八）+ **踝的额状轴**（内翻/外翻）
 *     · squatHipStrategy = **回正力**（主动策略，位置空间）
 *       通道 = active，目标 = **闭链位置基准**（脚落点推出来的膝/髋位置）
 *       管的轴 = 膝/髋的**额状轴**（膝竖直、髋水平）
 *     两条通道在 executor 里**分开记账、最后相加**（`executor.ts:204,236`）
 *     ⇒ 物理上就是论文里的「主动肌肉 + 被动组织」并联承载，不是二选一、不是对拉。
 *
 *   ★★ 为什么膝/髋的**额状轴**不归被动刚力（实测 _tmp-freeze-pose2.ts）：
 *     「腿竖直」是**位置**问题（膝在踝正上方），不是角度问题。
 *     实测把膝额状从 14.5° 收到 0°：膝踝间距只有 32.6cm，收 14.5° 必然把膝往中线挤
 *     ⇒ 膝被推离踝 8.8cm ⇒ 大腿倾 37.9° ⇒ 拧转反而更大
 *     （冻结期 Δ大腿yaw 4.3° → 26.5°）。
 *     ⇒ 额状竖直必须走**闭链位置目标**（主动回正），不能走角度弹簧。"""

assert OLD_DOC in src, 'doc not found'
src = src.replace(OLD_DOC, NEW_DOC)

io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

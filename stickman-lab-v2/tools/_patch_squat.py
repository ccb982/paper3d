#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 squat.ts 的被动张力写手改造为「髋/膝/踝 统一 + 左右镜像归一」"""
import io, re, sys

p = r'c:\Users\22641\Desktop\架构重置\stickman-lab-v2\src\core\servo\squat.ts'
src = io.open(p, encoding='utf-8').read()

NEW = '''/**
 * ★★ 蹲姿腿部被动张力（2026-10-28）—— 髋/膝/踝 的**额状面 + 纵向扭转**下限刚度。
 *
 * ═══ 用户定调（2026-10-28）══════════════════════════════════════════════
 *   「踝的被动刚力和回正力属于两种东西」
 *   「但是小腿腿偏了都要发力」
 *
 *   ⇒ **两种东西，两个写手，两个通道，但都作用在偏了的小腿上**：
 *     · 本写手 = **被动刚力**（解剖被动组织：韧带/肌腱/结缔组织的弹性力）
 *       通道 = passive，目标 = **解剖中立位（几何零）**
 *     · squatHipStrategy = **回正力**（主动策略，位置空间）
 *       通道 = active，目标 = **闭链位置基准**（脚落点推出来的膝/髋位置）
 *     两条通道在 executor 里**分开记账、最后相加**（`executor.ts:204,236`）
 *     ⇒ 物理上就是论文里的「主动肌肉 + 被动组织」并联承载，不是二选一、不是对拉。
 *
 * ── 为什么需要（实测 tools/_tmp-freeze-left.ts / _tmp-web-check.ts）───────
 *   ① 冻结期大腿相对躯干拧了 47.6°（左腿在 +Z 侧 ⇒ 大腿正面转向中线
 *      ⇒ 视觉上就是「膝盖朝内/内收」）；而这几个轴施加力矩**全程 0 N·m** ⇒ 纯自由漂移。
 *   ② 网页实测（放开 t=2.07s）：`knee_l/1 = 13.25°`（膝额状张开 13°⇒内收）
 *      `foot_l/0 = 14.73°`（踝额状 14.7°，**限位只有 ±14° ⇒ 连踝都超限**）
 *      ⇒ 「踝随便偏移」「膝盖和踝不严格竖直」。
 *   ③ 根因：被动刚度的 ref 取自 `baseAng`，而 `captureAngFrom` 原来写的是
 *      **带侧别的全名键**（`foot_l0`/`knee_l1`），而 BASE_TABLE 里写死的是
 *      **不带侧别的基名键**（`foot0:0`/`knee1:0`=几何零）；
 *      `baseAng` 查表全名键优先 ⇒ **几何零从来没生效过**，
 *      被动刚度一直在拉那个歪的实测值（踝 12.09°、膝 14.50°）。
 *      ⇒ 已修：captureAngFrom 改写基名键 + baseAng 基名键优先 + 表里几何零改正。
 *
 * ── 物理平面 ≠ 逻辑轴号（见 jointPlane.ts 实测表）────────────────────────
 *   膝 逻辑0=扭转(Y) 逻辑1=额状(X) 逻辑2=矢状(Z)
 *   髋 逻辑0=额状(X) 逻辑1=扭转(Y) 逻辑2=矢状(Z)
 *   踝 逻辑0=额状(X) 逻辑1=扭转(Y) 逻辑2=矢状(Z)
 *
 * ── ★★★ 左右镜像归一（实测标定 tools/_tmp-signcal2.ts）──────────────────
 *   读数被 `mirrorSymmetric` 强制成镜像（左 = −右）⇒ `ref − d.angle` 左右反号
 *   ⇒ 发出**反号 τ** ⇒ 物理效果**同向**（实测 Δ膝z L=−2.81 / R=+3.91cm，不对称）。
 *   而**同号 τ** 才是镜像效果（实测 Δ膝z L=−8.61 / R=−9.28cm ✔）。
 *   ⇒ 只用**左腿**读数算 dev，左右发**同号 τ**。
 *
 * ── 论文依据 ────────────────────────────────────────────────────────────
 *   ① 被动张力是真实存在的力源：非收缩成分（titin/结缔组织）的弹性力随肌肉
 *      拉长单调增长，是姿势稳定的**下限刚度**（Privett et al. 2024 实测被动模量；
 *      疲劳会降低它 ⇒ 是持续的、不可忽略的项）。
 *   ② 被动不足（passive insufficiency）：跨双关节肌被两端同时拉长到极限时
 *      被动张力飙升 ⇒ 天然限制 ROM ⇒ 「别让大腿拧过头」的物理依据。
 *   ③ 动态膝外翻（dynamic knee valgus）= 股骨内旋+髋内收+胫骨外展+踝外翻
 *      （Joseph 2008；Claiborne 2006）——纠正它靠**主动**控制；
 *      被动组织只提供下限刚度。
 */
function squatLegPassiveTension(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LEG_TENSION ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const target = String(env.SQC_LT_TARGET ?? 'zero');
  const K = Math.abs(Number(env.SQC_LT_K ?? 60));            // N·m/rad（髋/膝）
  const B = Math.abs(Number(env.SQC_LT_B ?? 3));             // N·m·s/rad
  const cap = Math.abs(Number(env.SQC_LT_CAP ?? 60));         // N·m
  const dead = Math.abs(Number(env.SQC_LT_DEAD_DEG ?? 0.5)) / 57.3;
  // 超解剖范围 ⇒ 刚度加大（原 squatHipSoftLimit 的职责）
  const kOut = Math.abs(Number(env.SQC_LT_K_OUT ?? 120));
  const capOut = Math.abs(Number(env.SQC_LT_CAP_OUT ?? 120));
  const hipAbd = Math.abs(Number(env.SQC_HIP_SOFT_ABD_DEG ?? 20)) / 57.3;   // 髋外展
  const hipRot = Math.abs(Number(env.SQC_HIP_SOFT_ROT_DEG ?? 15)) / 57.3;   // 髋轴转
  // 踝（额状轴 = 内翻/外翻）：单独增益——踝是 CoP 执行器，需要更硬
  const KA = Math.abs(Number(env.SQC_LT_K_ANKLE ?? 30));
  const BA = Math.abs(Number(env.SQC_LT_B_ANKLE ?? 2));
  const capA = Math.abs(Number(env.SQC_LT_CAP_ANKLE ?? 40));
  const deadA = Math.abs(Number(env.SQC_LT_DEAD_ANKLE_DEG ?? 0.5)) / 57.3;

  // 逐「部位·逻辑轴」处理；左右镜像归一（只用左腿读数算 dev，同号 τ）
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
}
'''

# 1) 删除 PLACEHOLDER + 旧的 squatLegPassiveTension 注释块 + 函数体
start = src.index('PLACEHOLDER_DELETE_ME')
end = src.index('/** 踝矢状前馈')
src = src[:start] + NEW + '\n' + src[end:]

# 2) 删除 squatFrame 里的 squatFrontalPassive 调用（已并入）
src = src.replace('  squatFrontalPassive(w);\n', '')

# 3) baseAng / frontalAxis 的导入：frontalPassive 不再需要 frontalAxis
src = src.replace("import { frontalAxis } from './jointPlane';\n", '')

io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OK')

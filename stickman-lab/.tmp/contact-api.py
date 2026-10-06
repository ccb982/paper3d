# -*- coding: utf-8 -*-
"""Ragdoll：暴露接触参数读/写（rocking 研究的唯一入口）"""
import io
P = 'src/core/ragdoll.ts'
s = io.open(P, encoding='utf-8').read()
before = len(s)

anchor = "  get jointCount(): number { return this.joints.length; }"
assert anchor in s
NEW = '''  /**
   * ★★★ **接触参数（研究用）** —— 读 Rapier 的 `integrationParameters`。
   *
   *   为什么需要它（2026-10-06，用户「先把这个链路打通」）：
   *   `probe-footpush` 实测**脚在共面接触块之间逐拍翻号**（内 509 N <-> 外 305 N），
   *   ⇒ 单脚 CoP 每 1/60 s 跳 ~180 mm ⇒ 对 CoM 的力矩 ±300 N·m 白噪声
   *   ⇒ 「脚发力带动全身倾斜」在**信息论上**就不可能。
   *
   *   机理假设：**共面刚性接触的载荷分配是静不定的** —— 由 LCP 求解器挑一个解，
   *   微小的数值差就翻面；若接触变软（`contact_natural_frequency` 降低），
   *   分配改由**穿透深度**（连续量）决定 ⇒ 应当稳定。
   */
  contactTuning(): { freq: number; damping: number; iters: number } {
    const ip = this.world.integrationParameters as unknown as {
      contactNaturalFrequency: number; contactDampingRatio: number; numSolverIterations: number;
    };
    return { freq: ip.contactNaturalFrequency, damping: ip.contactDampingRatio, iters: ip.numSolverIterations };
  }

  /** 写接触参数（`undefined` = 不动那一项）。返回写入后的实况。 */
  setContactTuning(o: { freq?: number; damping?: number; iters?: number }):
  { freq: number; damping: number; iters: number } {
    const ip = this.world.integrationParameters as unknown as {
      contactNaturalFrequency: number; contactDampingRatio: number; numSolverIterations: number;
    };
    if (o.freq !== undefined) ip.contactNaturalFrequency = o.freq;
    if (o.damping !== undefined) ip.contactDampingRatio = o.damping;
    if (o.iters !== undefined) ip.numSolverIterations = o.iters;
    return this.contactTuning();
  }

  get jointCount(): number { return this.joints.length; }'''
s = s.replace(anchor, NEW, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('ragdoll: %d -> %d' % (before, len(s)))

# -*- coding: utf-8 -*-
"""修正接触参数 API（snake_case）+ 加小步长求解器开关"""
import io
P = 'src/core/ragdoll.ts'
s = io.open(P, encoding='utf-8').read()

i0 = s.index('  contactTuning(): { freq: number; damping: number; iters: number } {')
i1 = s.index('  get jointCount(): number { return this.joints.length; }')
NEW = '''  contactTuning(): { freq: number; erp: number; iters: number; small: boolean } {
    const ip = this.world.integrationParameters as unknown as Record<string, unknown>;
    const num = (k: string): number => (typeof ip[k] === 'number' ? (ip[k] as number) : Number.NaN);
    return {
      freq: num('contact_natural_frequency'),
      erp: num('contact_erp'),
      iters: num('numSolverIterations'),
      small: (this.smallSteps ?? false),
    };
  }

  /** 小步长 PGS 求解器开关（Rapier：堆叠接触更准，专治静不定分配） */
  private smallSteps = false;

  /** 写接触参数（`undefined` = 不动那一项）。返回写入后的实况。 */
  setContactTuning(o: {
    freq?: number; erp?: number; iters?: number; small?: boolean; linearErr?: number;
  }): { freq: number; erp: number; iters: number; small: boolean } {
    const ip = this.world.integrationParameters as unknown as Record<string, unknown>;
    // ★★ 键名必须是 Rapier 的 **snake_case**（`probe-rocking` 枚举原型得到；
    //   写成 camelCase 会**静默无效** —— 实测 4 个 freq 配置逐位相同就是这么来的）。
    if (o.freq !== undefined) ip['contact_natural_frequency'] = o.freq;
    if (o.erp !== undefined) ip['contact_erp'] = o.erp;
    if (o.iters !== undefined) ip['numSolverIterations'] = o.iters;
    if (o.linearErr !== undefined) ip['normalizedAllowedLinearError'] = o.linearErr;
    if (o.small !== undefined) {
      this.smallSteps = o.small;
      const m = this.world.integrationParameters as unknown as Record<string, () => void>;
      if (o.small && typeof m['switchToSmallStepsPgsSolver'] === 'function') m['switchToSmallStepsPgsSolver']();
      else if (!o.small && typeof m['switchToStandardPgsSolver'] === 'function') m['switchToStandardPgsSolver']();
    }
    return this.contactTuning();
  }

'''
s = s[:i0] + NEW + s[i1:]
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('ragdoll API 修正完成')

# 扫描用例扩到真实旋钮
P = 'tools/probe-rocking.ts'
s = io.open(P, encoding='utf-8').read()
s = s.replace("""function run(ov: Record<string, unknown>, tune: { freq?: number; damping?: number; iters?: number }): Stat {""",
"""function run(ov: Record<string, unknown>, tune: {
  freq?: number; erp?: number; iters?: number; small?: boolean; linearErr?: number;
}): Stat {""", 1)
s = s.replace("""  const ip = ((): { freq: number; damping: number; iters: number } => {""",
"""  const ip = ((): { freq: number; erp: number; iters: number; small: boolean } => {""", 1)
s = s.replace("""  log(`   实测默认值：freq=${ip.freq} damping=${ip.damping} iters=${ip.iters}`);""",
"""  log(`   实测默认值：freq=${ip.freq}Hz  erp=${ip.erp}  iters=${ip.iters}  smallSteps=${ip.small}`);""", 1)
s = s.replace("""const CASES: [string, Record<string, unknown>, { freq?: number; damping?: number; iters?: number }][] = [
  ['基准（默认接触）', {}, {}],
  ['freq=15Hz', {}, { freq: 15 }],
  ['freq=8Hz', {}, { freq: 8 }],
  ['freq=4Hz', {}, { freq: 4 }],
  ['freq=8Hz + iters=8', {}, { freq: 8, iters: 8 }],
  ['iters=16（仅收敛）', {}, { iters: 16 }],
  ['脚角阻尼=30', { footAngularDamping: 30 }, {}],
  ['freq=8Hz + 脚阻尼30', { footAngularDamping: 30 }, { freq: 8 }],
];""",
"""const CASES: [string, Record<string, unknown>, {
  freq?: number; erp?: number; iters?: number; small?: boolean; linearErr?: number;
}][] = [
  ['基准（默认接触）', {}, {}],
  ['freq=15Hz', {}, { freq: 15 }],
  ['freq=8Hz', {}, { freq: 8 }],
  ['freq=4Hz', {}, { freq: 4 }],
  ['freq=2Hz', {}, { freq: 2 }],
  ['★小步长求解器', {}, { small: true }],
  ['★小步长+freq=8', {}, { small: true, freq: 8 }],
  ['线性误差 1e-3', {}, { linearErr: 1e-3 }],
  ['iters=32', {}, { iters: 32 }],
  ['freq=4 + 小步长 + 阻尼30', { footAngularDamping: 30 }, { freq: 4, small: true }],
];""", 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('probe 用例扩展完成')

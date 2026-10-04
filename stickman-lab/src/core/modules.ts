// ═══════════════════════════════════════════════════════════════════════
//  ★★★ 算法模块注册表（用户 2026-10-02："左腿就是左腿，右腿就是右腿，
//      脊椎就是脊椎；需要代码操控什么时候什么模块起作用，什么不起作用"）
// ═══════════════════════════════════════════════════════════════════════
//  之前的问题（实测）：
//   ① 状态机 `gp.step()` 被 `if (nGround === 1)` 包着 ⇒ 只在单支撑帧走，
//      从来看不到双支撑相 ⇒ 永远进不了 `adjust`。
//   ② MoS / 参考角 / 髋角速度都是**全局单值**（`lastMosX` / `lastRefHip`），
//      左腿右腿共用 ⇒ "左腿的成绩"和"右腿的成绩"被混在一起，
//      调试时根本说不清"是左腿没过还是右腿没过"。
//   ③ 各奖励项各自写 `if (nGround === 1)`，门控条件散落十几处，
//      改一处忘一处 ⇒ 门控行为无法整体审阅。
//
//  这一层把三件事集中成**唯一出处**：
//   A. **归属**（part）：模块属于 身体 / 脊椎 / 左腿 / 右腿 —— 不许串。
//   B. **何时起作用**（active）：由「状态机相 + 哪条腿 + 单/双支撑」统一决定。
//   C. **调试可见**：rightNow() 直接打印当前每个模块 开/关 + 为什么。
// ═══════════════════════════════════════════════════════════════════════

import type { GaitPhase, Leg } from './gaitPhase';

/** 模块归属：**左腿就是左腿，右腿就是右腿，脊椎就是脊椎** */
export type Part = 'body' | 'spine' | Leg;

/** 模块 id（新增模块时同时在这里登记，漏了会在 TS 报错） */
export type ModuleId =
  | 'loadShift'      // 载荷转移（身体）
  | 'altSwitch'      // 换支撑脚（身体）
  | 'singleSupport'  // 单支撑时长（身体）
  | 'cycle'          // 迈步→调整 顺序循环（身体）
  | 'stillSwing'     // 摆动相身体冻结（身体）
  | 'balance'        // WBAM / MoS 平衡（身体）
  | 'distance'       // 脚净位移（身体）
  | 'spineSync'      // 骨盆-脊椎反相旋转（脊椎）
  | 'cmBalance'      // CMP 质心力矩（脊椎）
  | 'pelvisFirst'    // 盆骨/髋优先（**分腿**）
  | 'refShape'       // 文献髋膝参考形状（**分腿**）
  | 'placement'      // 落点/捕获点（**分腿**）
  | 'stepClearance'  // 离地高度（**分腿**）
  | 'stepLength';    // 步长（**分腿**）

interface Def {
  id: ModuleId;
  label: string;
  part: Part;
  /** 该模块在哪些**相**起作用（'both' = 双脚着地也算） */
  phases: GaitPhase[];
  /** 该模块只在**单支撑**时起作用（true）/ 双支撑也可以（false） */
  singleOnly: boolean;
}

/** ★ 模块登记表。新增模块必须在这里登记，`active()` 才认它。 */
export const MODULES: readonly Def[] = [
  { id: 'loadShift', label: '载荷转移', part: 'body', phases: ['both', 'step', 'adjust'], singleOnly: false },
  { id: 'altSwitch', label: '换支撑脚', part: 'body', phases: ['both', 'step', 'adjust'], singleOnly: false },
  // ★★ 相位放开为 **全部三相**（2026-10-02，站立模式必需）。
  //   原来只 `['step','adjust']`，于是**站立模式下 `gp.now` 几乎永远是 `both`**
  //   ⇒ `mod.active('singleSupport', ...)` 恒 false ⇒ `accSingle` 恒 −0.001
  //   ⇒ 站立模式的**主项是死的** ⇒ 12 代收敛到"两脚着地 359/360 帧"的退化解
  //   （实测：把 `single` 权重提到 3.0、把 `quiet` 归零，数字**一位不变**）。
  //   单腿站立本来就不属于任何"迈步相位"，它的判据就是几何接触（一脚离地），
  //   与相位无关 ⇒ 相位门控在这里没有意义，反而把奖励关掉了。
  { id: 'singleSupport', label: '单支撑时长', part: 'body', phases: ['both', 'step', 'adjust'], singleOnly: true },
  { id: 'cycle', label: '迈步→调整循环', part: 'body', phases: ['both', 'step', 'adjust'], singleOnly: false },
  { id: 'stillSwing', label: '摆动相身体冻结', part: 'body', phases: ['step'], singleOnly: true },
  { id: 'balance', label: 'WBAM/MoS 平衡', part: 'body', phases: ['both', 'step', 'adjust'], singleOnly: false },
  { id: 'distance', label: '脚净位移', part: 'body', phases: ['both', 'step', 'adjust'], singleOnly: false },
  // ★★ 脊椎/CMP 默认**只在「稳住中」相**出力（实测 2026-10-02）：
  //   三相都开着时，单支撑 MoS 从 −487mm 拉到 +79mm（站得住），
  //   但换脚从 4 次掉到 2 次 —— 它在**拿停止前进换稳定**。
  //   ⇒ 摆动相不许脊椎介入（否则躯干跟着摆腿晃，破坏"迈步时身体别动"），
  //     只在落地后的调整相用来纠正身体。
  // ★ 2026-10-02 修正：原来写 `phases: ['adjust']`，但 adjust 相实测 **0 帧**
  //   （连续单支撑攒不够 ADJUST_MIN）⇒ `mod.active('spineSync', ...)` 永远 false
  //   ⇒ **腰一次都没被驱动**，却又是个"看起来在起作用"的假开关（用户："腰部的移动不太对"）。
  //   腰按 Perry 分期应该在**整个支撑相**都能反相旋转（Takemura 2007），不必等 adjust。
  // ★★ 相位收窄为 **`['step']`（仅摆动/迈腿相）**（2026-10-02，文献依据）：
  //   `spineSync` 是**步态反相旋转**机制（Takemura 2007, Sci Rep 2019：
  //   胸廓与骨盆反相旋转，抵消摆动腿的垂直轴角动量）—— 它的**服务对象是摆动腿**，
  //   在没有摆动腿的**静态平衡保持**下没有任何力学理由要开。
  //   而单腿站立的文献结论正相反（Riemann, Myers & Lephart 2003,
  //   *Arch Phys Med Rehabil* 84:36-42）：
  //     · "The **trunk**... appeared to be the **least important** source of
  //       corrective action"
  //     · "significantly **more corrective action occurred between the pelvis and thigh
  //       than between the pelvis and trunk**"
  //     · "the **higher inertia** associated with the trunk may **preclude it from
  //       contributing to the quick adjustments** necessary for single-leg stance
  //       equilibrium"
  //   实测的代价（此前误设为三相全开）：单腿保持平衡时腰仍收到 **−14°** 的躯干旋转指令，
  //   而躯干只实际动了 −2.7° ⇒ 给本就不稳的系统又加了一个大惯量扰动源。
  { id: 'spineSync', label: '骨盆-脊椎反相（仅摆动相）', part: 'spine', phases: ['step'], singleOnly: false },
  { id: 'cmBalance', label: 'CMP 质心力矩', part: 'spine', phases: ['both', 'step', 'adjust'], singleOnly: false },
  { id: 'pelvisFirst', label: '盆骨/髋优先', part: 'l', phases: ['step', 'adjust'], singleOnly: true },
  { id: 'refShape', label: '文献髋膝形状', part: 'l', phases: ['step', 'adjust'], singleOnly: true },
  { id: 'placement', label: '落点/捕获点', part: 'l', phases: ['step', 'adjust'], singleOnly: true },
  { id: 'stepClearance', label: '离地高度', part: 'l', phases: ['step'], singleOnly: true },
  { id: 'stepLength', label: '步长', part: 'l', phases: ['step', 'adjust'], singleOnly: false },
];

export class ModuleSet {
  private off = new Set<ModuleId>();     // 代码手动关掉的（总开关优先于其它一切）
  private byPart = new Map<Part, Def[]>();

  constructor() {
    for (const d of MODULES) {
      const a = this.byPart.get(d.part);
      if (a) a.push(d); else this.byPart.set(d.part, [d]);
    }
  }

  /** ★ 代码手动开关某模块（优先级最高）。返回是否成功。 */
  enable(id: ModuleId, on = true): this { if (on) this.off.delete(id); else this.off.add(id); return this; }
  /** 批量关掉某归属的全部模块，例如"这一段不要动脊椎" */
  enablePart(part: Part, on: boolean): this {
    for (const d of this.byPart.get(part) ?? []) { if (on) this.off.delete(d.id); else this.off.add(d.id); }
    return this;
  }
  reset(): this { this.off.clear(); return this; }
  isManuallyOff(id: ModuleId): boolean { return this.off.has(id); }

  /**
   * ★ 模块 id 定义里写的是 `part: 'l'`（代表"逐腿模块"），
   *   实际激活要按**具体那条腿**判断：`active('refShape', 'l')` / `active('refShape', 'r')`。
   *   归属为 'body'/'spine' 的模块忽略 limb 参数。
   */
  private resolve(id: ModuleId, limb: Leg | null): Def | null {
    const d = MODULES.find(m => m.id === id);
    if (!d) return null;
    if (d.part === 'body' || d.part === 'spine') return d;
    return limb === d.part ? d : null;      // ★ 逐腿模块只对**自己那条腿**生效
  }

  /** ★ 模块此刻是否起作用 */
  active(id: ModuleId, phase: GaitPhase, nGround: number, limb: Leg | null = null): boolean {
    const d = this.resolve(id, limb);
    if (!d) return false;                                  // 模块不归 limb 这条腿管
    if (this.off.has(id)) return false;                     // 被代码关掉
    if (!d.phases.includes(phase)) return false;            // 不在当前相
    if (d.singleOnly && nGround !== 1) return false;        // 要求单支撑
    return true;
  }

  /** 某模块此刻为什么不起作用（空 = 起着作用）。调试直接打印这句话。 */
  why(id: ModuleId, phase: GaitPhase, nGround: number, limb: Leg | null = null): string {
    const d = this.resolve(id, limb);
    if (!d) return limb ? `不属于${limb === 'l' ? '左腿' : '右腿'}（这是逐腿模块）` : '未知模块';
    if (this.off.has(id)) return '被代码关闭';
    if (!d.phases.includes(phase)) return `当前是「${phase}」相，该模块只在 ${d.phases.join('/')} 相生效`;
    if (d.singleOnly && nGround !== 1) return `要求单支撑，当前支撑脚数=${nGround}`;
    return '';
  }

  /**
   * ★ 改某模块**在哪些相**生效（用户："需要代码操控什么时候什么模块起作用"）。
   *   实测用途：脊椎三相全开 ⇒ MoS 变好但换脚减半；只在 `adjust` 相 ⇒ 两头都要。
   *   传空数组 = 等价于永远关闭。
   */
  setPhases(id: ModuleId, phases: GaitPhase[]): this {
    const d = MODULES.find(m => m.id === id);
    if (d) d.phases = phases.slice();
    return this;
  }

  /** 调试：当前每个模块 开/关 + 原因（左腿右腿分列，脊椎单列） */
  /**
   * ★★★ 伺服层登记：**这类模块永远待命，但只"修正"、从不发令**（用户 2026-10-02）。
   *   它们被允许在**任何相**起作用 —— 因为稳定不是发令出来的，是一直做的。
   *   人体对应：落点/前馈、MoS 反射、踝策略、躯干稳定，都是持续在线的伺服。
   */
  servo(id: ModuleId): this {
    const d = MODULES.find(m => m.id === id);
    if (d) { d.phases = ['both', 'step', 'adjust']; d.singleOnly = false; }
    return this;
  }

  /** 批量登记伺服 */
  servoAll(ids: ModuleId[]): this { for (const i of ids) this.servo(i); return this; }

  /** 取某模块当前登记的相列表（调试用） */
  phasesOf(id: ModuleId): readonly GaitPhase[] {
    return MODULES.find(m => m.id === id)?.phases ?? [];
  }

  report(phase: GaitPhase, nGround: number): string[] {
    const out: string[] = [];
    for (const leg of ['l', 'r'] as Leg[]) {
      for (const d of this.byPart.get(leg) ?? []) {
        const w = this.why(d.id, phase, nGround, leg);
        out.push(`  ${w ? '✗' : '✓'} [${leg === 'l' ? '左腿' : '右腿'}] ${d.label}${w ? '：' + w : '：生效'}`);
      }
    }
    for (const part of ['spine', 'body'] as const) {
      for (const d of this.byPart.get(part) ?? []) {
        const w = this.why(d.id, phase, nGround, null);
        out.push(`  ${w ? '✗' : '✓'} [${part === 'spine' ? '脊椎' : '身体'}] ${d.label}${w ? '：' + w : '：生效'}`);
      }
    }
    return out;
  }
}
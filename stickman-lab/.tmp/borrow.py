# -*- coding: utf-8 -*-
"""腰部借力统一通道：step 与 balance 都设增益，由同一处从"腿的力"算出倾角"""
import io

# ══ ① rigState：共享借力结构 + 计算 ══
P = 'src/core/rigState.ts'
s = io.open(P, encoding='utf-8').read()
s = s.replace("""  /**
   * ★★★ **修正增量通道**（用户 2026-10-06 定调：""",
"""  /**
   * ★★★★ **腰部借力**（用户 2026-10-06：「**平衡系统和迈步系统都走腰部借力才对**」、
   *   「腰部也要主动发力啊。**是腿部发力，然后腰部借力才对**」）。
   *
   *   ── 物理 ──────────────────────────────────────────────────────
   *   腰**不自己产生力**。腿推地 → 水平 GRF → 上身**顺着这个力倾**，
   *   把腿给的力**用**在重心转移上（而不是另算一个目标去顶）。
   *   ⇒ 输入只有一个：**腿产生的水平 GRF**（`groundChain.grfX/grfZ`，已低通 80ms）。
   *
   *   ── 为什么做成"一个共享通道"而不是两边各写 ──────────────────
   *   两个系统都"借"同一份力：**增益相加**、**由同一处算**、**写同一个 `acorr`**。
   *   若各写各的（step 写目标、balance 写修正），就会出现"两边按各自的相位借，
   *   互相抵消"——这正是此前"重心转移拉不回来"的结构原因。
   */
  upperBorrow = {
    /** 迈步系统的借力增益（按相位 `authority` 调） */
    kStep: 0,
    /** 平衡系统的借力增益（`upBorrowK`） */
    kBal: 0,
    /** 本拍腿产生的水平 GRF（已低通） */
    grfX: 0, grfZ: 0,
    /** 本拍算出的借力倾角（rad，写进 `acorr` 的量） */
    roll: 0, pitch: 0,
    /** 增益和（诊断） */
    kSum: 0,
  };

  /**
   * ★★★ **修正增量通道**（用户 2026-10-06 定调：""", 1)

s = s.replace("""  // ── 仲裁 ────────────────────────────────────────────────""",
"""  /**
   * ★★★★ **算出并写入"腰部借力"**（共享通道；`step`/`balance` 只负责设增益）。
   *
   *   `lean = clamp(kSum · GRF_水平 / (m·g), ±leanMax)`，逐轴**斜率限制**
   *   （`slewMax` rad/拍）—— 防止增益或 GRF 的抖动变成脊柱的抖动
   *   （实测：不加斜率限制时，「迈步系统停手」从 12.00s 掉到 1.22s）。
   *
   * @returns 本拍实际写入的 (roll, pitch)
   */
  applyUpperBorrow(leanMax: number, slewMax: number): { roll: number; pitch: number } {
    const ub = this.upperBorrow;
    const gc = this.groundChain;
    ub.grfX = gc ? gc.grfX : 0;
    ub.grfZ = gc ? gc.grfZ : 0;
    ub.kSum = ub.kStep + ub.kBal;
    const bodyN = Math.max(1, this.massN);
    const rT = Math.max(-leanMax, Math.min(leanMax, ub.kSum * ub.grfZ / bodyN));
    const pT = Math.max(-leanMax, Math.min(leanMax, ub.kSum * ub.grfX / bodyN));
    const rPrev = this.ubPrevRoll, pPrev = this.ubPrevPitch;
    const r = Math.max(rPrev - slewMax, Math.min(rPrev + slewMax, rT));
    const p = Math.max(pPrev - slewMax, Math.min(pPrev + slewMax, pT));
    this.ubPrevRoll = r; this.ubPrevPitch = p;
    ub.roll = r; ub.pitch = p;
    return { roll: r, pitch: p };
  }
  private ubPrevRoll = 0;
  private ubPrevPitch = 0;
  /** 全身体重（N）—— 借力的归一化基准（由 Controller 安装） */
  massN = 686.7;

  // ── 仲裁 ────────────────────────────────────────────────""", 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('rigState 借力通道 ok')

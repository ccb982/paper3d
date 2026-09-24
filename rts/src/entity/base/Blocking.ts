// ============================================================
// entity/base/Blocking —— 阻挡校验（基类功能；用户定 2026-09-24）
// ============================================================
// 三点一线：**玩家 P —— 掩体/阻挡者 B —— 目标 G**。
//   两种用法，同一内核：
//   · block（保护者用）：B 主动挡在 P→G 之间，保持 standoff——让玩家过不去。
//   · guard（驻守用）：**用阻挡校验保证自己也被掩体挡住**——G 躲到 B 后面，
//     即 P-B-G 三点一线、B 在中间、自己与 B 留间隙（不是贴在一起）。
//   返回：是否成立 + 垂直偏离 + **两个调整点**（阻挡者调整点 / 被保护者调整点）+ 建议原子。
//   ★ 调整点即**寻路目标**（用户定 2026-09-24）：给出位置 → 直接寻路过去移动即可，
//     不额外写行为逻辑；到点后再校验一次，收敛到"真的挡住/真的被挡住"。
// 纯函数：无状态、零分配、可单测；位置由引擎给（信息单源），
// 队长按结果在 行军/行动/驻守 等原子能力间自主选择（队长不给代理下命令）。
// ============================================================

/** 保护/阻挡参数（集中可调） */
export const PROTECT = {
  /** 近身拦截距离（米；阻挡者离玩家的理想距离，block 模式） */
  STANDOFF: 7,
  /** 偏离容差（米；垂直偏离 ≤ 此值算"挡住"） */
  TOL: 3.5,
  /** 距离带下沿（米；block 模式：离 P 近于 STANDOFF-NEAR 算贴脸，需后撤） */
  NEAR: 2.5,
  /** 距离带上沿（米；block 模式：离 P 远于 STANDOFF+FAR 算掉队，需行军） */
  FAR: 3.5,
  /** 被保护者与掩体的最小沿线上间隙（米；guard 模式——别贴进掩体里） */
  GAP: 1.2,
  /** 被保护者躲在掩体后的期望距离（米；掩体 → 自己，guard 模式） */
  HIDE: 2.5,
} as const;

export type BlockMode = 'block' | 'guard';

export interface BlockCheck {
  /** 成立：block=已挡住玩家；guard=自己已被掩体挡住 */
  ok: boolean;
  /** 垂直偏离（米；越大越漏） */
  off: number;
  /** 阻挡者调整点（block 模式；**寻路目标**：P→G 线上、离 P 为 standoff） */
  ax: number;
  az: number;
  /** 被保护者调整点（guard 模式；**寻路目标**：沿 P→B 越过掩体 HIDE 米——躲到掩体后） */
  gax: number;
  gaz: number;
  /** 建议原子能力：太远→行军；偏了→行动；到位→驻守 */
  atom: 'march' | 'act' | 'garrison';
}

/** 三点一线阻挡校验（P=玩家，B=掩体/阻挡者，G=被保护目标或自己） */
export function blockCheck(
  px: number, pz: number,
  bx: number, bz: number,
  gx: number, gz: number,
  standoff: number = PROTECT.STANDOFF,
  mode: BlockMode = 'block',
): BlockCheck {
  const vx = gx - px;
  const vz = gz - pz;
  const L = Math.hypot(vx, vz);
  const dP = Math.hypot(bx - px, bz - pz);
  if (L < 1e-3) {
    // P 与 G 重合（退化）：视为已成立（无处可调）
    return { ok: true, off: 0, ax: bx, az: bz, gax: gx, gaz: gz, atom: 'garrison' };
  }
  const ux = vx / L;
  const uz = vz / L;
  // B 在 P→G 线上的投影（t = 沿线的有向距离）
  const t = (bx - px) * ux + (bz - pz) * uz;
  const ix = px + ux * t;
  const iz = pz + uz * t;
  const off = Math.hypot(bx - ix, bz - iz);
  // 阻挡者调整点：线上离 P 为 standoff，且不越过"G 前 FAR"（防挡到被保护者身上）
  const tt = Math.min(standoff, Math.max(0, L - PROTECT.FAR));
  const ax = px + ux * tt;
  const az = pz + uz * tt;
  // 被保护者调整点：沿 P→B 方向越过掩体 HIDE 米（躲到掩体后）
  const uxb = dP > 1e-3 ? (bx - px) / dP : ux;
  const uzb = dP > 1e-3 ? (bz - pz) / dP : uz;
  const gax = bx + uxb * PROTECT.HIDE;
  const gaz = bz + uzb * PROTECT.HIDE;
  const between = t > 0.5 && t < L - 0.5;
  const dG = Math.hypot(gx - px, gz - pz);
  if (mode === 'guard') {
    // 自己已被掩体挡住：共线 + 掩体在中间 + 自己与掩体留有沿线上间隙
    const tG = dG;
    const gapOk = tG - t >= PROTECT.GAP;
    const ok = off <= PROTECT.TOL && between && gapOk;
    const atom: BlockCheck['atom'] = ok ? 'garrison' : tG > t + PROTECT.HIDE * 3 ? 'march' : 'act';
    return { ok, off, ax, az, gax, gaz, atom };
  }
  // block：阻挡者在位（共线 + 在中间 + 距离带内）
  const inBand = dP >= standoff - PROTECT.NEAR && dP <= standoff + PROTECT.FAR;
  const ok = off <= PROTECT.TOL && between && inBand;
  const atom: BlockCheck['atom'] =
    dP > standoff + PROTECT.FAR ? 'march' : !ok ? 'act' : 'garrison';
  return { ok, off, ax, az, gax, gaz, atom };
}

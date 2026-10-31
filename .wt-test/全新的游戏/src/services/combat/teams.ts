// ============================================================
// teams —— 阵营关系（战斗命中过滤唯一真源）
// ============================================================
// player 与 ally 互为友军：玩家不误伤召唤物/友军，友军之间不互殴；
// enemy 对一切非同阵营开火；neutral 等其余阵营只在与对方同 camp 时互不伤害。
// ★ 所有命中过滤（executeAttack / BulletEntity）必须经此判定，
//   禁止各自写 camp 比较（否则新增阵营/召唤物必然出现友伤漏洞）。

/** 是否友军（同队不结算伤害） */
export function sameTeam(a: string, b: string): boolean {
  if (a === b) return true;
  const friendly = (c: string): boolean => c === 'player' || c === 'ally';
  return friendly(a) && friendly(b);
}

// ============================================================
// Posture —— 战场态势（类型单源）
// ============================================================
// 说明：原部署表（SQUAD_DOCTRINE/applyPosture）已随旧指挥链删除（2026-09-25）；
// 本文件只保留态势联合类型，供 PostureFn / TerrainScore / data/SwarmData 共用。
// ============================================================

export type BattlePosture = 'fortify' | 'patrol' | 'advance' | 'mass' | 'assault' | 'withdraw';

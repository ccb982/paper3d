// ============================================================
// SwarmTierPort —— 升降格 / 回收的唯一桥接（管线 P4；《实体架构.md》§5.8 步骤 8）
// ============================================================
// 两链路（promote / demote）此前分散在 WorldMode hooks 与 WorldSpawner；
// 这里收口成一个端口：SwarmSystem 只认端口，模式层（WorldSpawner）实现端口。
// ★ 契约：promote/demote 是**同一单位换载体**（非死亡）。
// ★ 回收不在此端口：远距回收由引擎账本直记（SwarmLedger.noteRecall），模式层不参与。
// ============================================================

import type { AgentSnapshot } from './AgentPool';
import type { EnemyBase } from '../../entity/EnemyBase';

export interface SwarmTierPort {
  /** 升格：代理 → L3 实体（模式层创建并注册；快照全量回灌） */
  promote(snap: AgentSnapshot): void;
  /** 降格：L3 实体 → 代理（快照抽干回池 + 实体退役；不算击杀） */
  demote(enemy: EnemyBase): void;
}

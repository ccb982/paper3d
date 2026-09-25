// ============================================================
// engine/CommandLang —— 引擎命令语言（语法 + 解释器；用户定 2026-09-25）
// ============================================================
// 引擎只发**复合句**（一门小语言）；队长侧是另一门语言（`squad/CommandLang.ts`）。
//
// EBNF（引擎命令语法）：
//   sentence  := composite { modifier }
//   composite := 'protect' '(' G ',' P ')'          // 保护：G=被保护队长位，P=威胁(玩家)位
//              | 'act'     '(' target ')'            // 行动：去某点
//              | 'defend'  '(' target ')'            // 防御：守 target（原地 = target 即自身位）
//   modifier  := 'mission' '=' ident
//              | 'ttl' '=' number                   // 游戏分钟（0 = 不过期）
//              | 'seq' '=' number
//              | 'source' '=' ( 'engine' | 'player' )
//   G / P / target / object := Vec2 = number ',' number
//
// 解释器 `interpretEngine(sentence)`：复合句 → **引擎意图**（唯一口径）：
//   protect → { op:'block', anchor:G, threat:P }   // 双点原样下发给队长（阻挡校验由队长做）
//   act     → { op:'move',  target }               // 位移目标
//   defend  → { op:'hold',  target: object ?? 原 target }   // 守对象/守原地
// 良构校验 `wellFormed(sentence)`：缺操作数/非法修饰 → 返回错误串（发令前拦下）。
//
// 消费：`EngineBridge.write`（良构 → 解释 → OrderWriter 发布）；探针/自检只读。
// ============================================================

import type { CompositeKind, SquadOrder } from './contracts';

/** 引擎意图（解释结果；队长据此执行） */
export interface EngineIntent {
  kind: CompositeKind;
  op: 'block' | 'move' | 'hold';
  /** 保护锚 G（仅 protect） */
  anchor?: { x: number; z: number };
  /** 威胁点 P（仅 protect） */
  threat?: { x: number; z: number };
  /** 位移/守点目标 */
  target: { x: number; z: number };
}

const KINDS: readonly SquadOrder['kind'][] = ['protect', 'act', 'defend'];

/** 语法良构校验：返回 null = 通过；否则错误串（发令前拦下） */
export function wellFormed(s: Partial<SquadOrder>): string | null {
  if (!s.kind || !KINDS.includes(s.kind)) return `未知复合句：${String(s.kind)}`;
  if (!s.target || !Number.isFinite(s.target.x) || !Number.isFinite(s.target.z)) return `${s.kind} 缺目标 target`;
  if (s.kind === 'protect') {
    if (!s.anchor) return 'protect 缺保护锚 G（anchor）';
    if (!s.threat) return 'protect 缺威胁点 P（threat）';
  }
  if (s.ttl !== undefined && (!Number.isFinite(s.ttl) || s.ttl < 0)) return `非法 ttl：${String(s.ttl)}`;
  return null;
}

/** 解释器：复合句 → 引擎意图（唯一口径；不逐拍指挥） */
export function interpretEngine(s: SquadOrder): EngineIntent {
  switch (s.kind) {
    case 'protect':
      // 双点原样下发；队长自主 blockCheck 选原子（squad/CommandLang）
      return {
        kind: 'protect', op: 'block',
        anchor: s.anchor ? { x: s.anchor.x, z: s.anchor.z } : { x: s.target.x, z: s.target.z },
        threat: s.threat ? { x: s.threat.x, z: s.threat.z } : { x: s.target.x, z: s.target.z },
        target: { x: s.target.x, z: s.target.z },
      };
    case 'defend': {
      const t = s.target;
      return { kind: 'defend', op: 'hold', target: { x: t.x, z: t.z } };
    }
    case 'act':
    default:
      return { kind: 'act', op: 'move', target: { x: s.target.x, z: s.target.z } };
  }
}

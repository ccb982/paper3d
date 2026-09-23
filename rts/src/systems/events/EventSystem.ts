// ============================================================
// EventSystem.ts —— 事件系统（触发位置 / 条件筛选 / 完成落账）
// ============================================================
// 事件定义见 config/events.json，三种触发位：
//   · ship  —— 舰内固定位置（本地坐标锚点；站着一位角色，F 交谈）
//   · base  —— 基地锚点（randomAnchor = 每天在候选位中确定性地换位置）
//   · world —— 探索期区块激活时按确定性 hash + 每块概率刷 NPC 实体
// 生命周期：
//   · once        —— 完成后永久不再触发（写 Session.story.events）
//   · cooldownDays—— 完成后冷却 N 天（同上，lastDay 判定）
//   · 选择确定性  —— 同一天同一区块/锚点结果稳定（种子派生）
// ============================================================

import type { GameSession } from '../../core/Session';
import eventsJson from '../../config/events.json';
import { evalStoryCond, type StoryCond } from '../dialogue/DialogueTypes';
import { hash2 } from '../../services/map/TerrainNoise';

export interface EventNpcDef {
  speaker: string;
  portrait?: string;
}

export interface EventDef {
  id: string;
  where: 'ship' | 'base' | 'world';
  npc: EventNpcDef;
  /** 对话树 id（config/dialogues.json） */
  dialogue: string;
  /** 交互提示文案（缺省"交谈"） */
  label?: string;
  /** 固定位候选锚点（ship/base；本地坐标） */
  anchors?: { x: number; z: number }[];
  /** 每天在候选锚点中确定性换位（否则恒取第一个） */
  randomAnchor?: boolean;
  /** 只触发一次（完成即永久关闭） */
  once?: boolean;
  /** 完成后冷却天数 */
  cooldownDays?: number;
  /** world：每个区块的触发概率（0~1） */
  chancePerChunk?: number;
  cond?: StoryCond;
}

/** 固定位事件实例（事件 + 命中锚点） */
export interface ActiveFixedEvent {
  event: EventDef;
  x: number;
  z: number;
}

const EVENTS = eventsJson.events as EventDef[];

export class EventSystem {
  constructor(
    private readonly session: GameSession,
    private readonly seed: number,
  ) {}

  /** 固定位事件（舰内/基地）：当前可触发的事件与锚点（本地坐标） */
  fixedEvents(where: 'ship' | 'base'): ActiveFixedEvent[] {
    const day = this.session.meta.day;
    const out: ActiveFixedEvent[] = [];
    for (const ev of EVENTS) {
      if (ev.where !== where || !this.isAvailable(ev)) continue;
      const anchors = ev.anchors ?? [];
      if (anchors.length === 0) continue;
      const idx = ev.randomAnchor
        ? Math.floor(hash2(day, anchors.length, this.seed + 521) * anchors.length) % anchors.length
        : 0;
      out.push({ event: ev, x: anchors[idx].x, z: anchors[idx].z });
    }
    return out;
  }

  /** 世界事件：区块激活时按"每块概率 + 确定性 hash"抽选（同天同块结果稳定） */
  rollWorldEvent(cx: number, cz: number): EventDef | null {
    const day = this.session.meta.day;
    for (const ev of EVENTS) {
      if (ev.where !== 'world' || !this.isAvailable(ev)) continue;
      const chance = ev.chancePerChunk ?? 0.02;
      const salt = this.seed + day * 7919 + hashString(ev.id);
      const r = hash2(cx * 131 + 7, cz * 197 + 13, salt);
      if (r < chance) return ev;
    }
    return null;
  }

  /** 事件完成落账（对话结束回调；once/cooldownDays 的判定依据） */
  complete(eventId: string): void {
    const rec = this.session.story.events[eventId] ?? { count: 0, lastDay: 0 };
    rec.count += 1;
    rec.lastDay = this.session.meta.day;
    this.session.story.events[eventId] = rec;
  }

  /** 交互提示文案（统一出口） */
  label(ev: EventDef): string {
    return ev.label ?? '交谈';
  }

  private isAvailable(ev: EventDef): boolean {
    if (!evalStoryCond(ev.cond, this.session)) return false;
    const rec = this.session.story.events[ev.id];
    if (ev.once && (rec?.count ?? 0) > 0) return false;
    if (ev.cooldownDays && rec && this.session.meta.day - rec.lastDay < ev.cooldownDays) return false;
    return true;
  }
}

/** 字符串 → 稳定整数（事件 id 混入 hash 盐） */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000003;
}

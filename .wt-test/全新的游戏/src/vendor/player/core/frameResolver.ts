// ============================================================
// FrameResolver —— 帧名解析器
// ============================================================
//
// 帧全部在 ftx 包内（ftx3 纹理包 / .scene.zip 特效包），解码时
// 已读取出每帧的 name 字段。此解析器建立「名字 → 帧索引」映射，
// 让游戏内任意模块按名字取帧/列帧。
//
// 约定：每帧名字独立、不重复（编辑器导出时保证）。
// 兜底：若出现重复名，后写覆盖并 console.warn（不静默丢帧）。

export interface FrameNameEntry {
  index: number;
  name: string;
}

export class FrameResolver {
  private _map: Map<string, number> = new Map();
  private _entries: FrameNameEntry[] = [];

  /** @param names 帧名数组（顺序 = 帧索引顺序） */
  constructor(names: string[]) {
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      if (this._map.has(name)) {
        console.warn(`[FrameResolver] 重复帧名 "${name}"：索引 ${this._map.get(name)} 被 ${index} 覆盖（帧名应唯一）`);
      }
      this._map.set(name, index);
      this._entries.push({ index, name });
    }
  }

  /** 全部帧清单（名字 + 索引，顺序与包内一致） */
  list(): FrameNameEntry[] {
    return this._entries.slice();
  }

  /** 全部帧名（按顺序） */
  names(): string[] {
    return this._entries.map((e) => e.name);
  }

  /** 名字 → 帧索引；不存在返回 null */
  resolve(name: string): number | null {
    return this._map.has(name) ? this._map.get(name)! : null;
  }

  /** 是否存在该帧名 */
  contains(name: string): boolean {
    return this._map.has(name);
  }

  get size(): number {
    return this._entries.length;
  }
}

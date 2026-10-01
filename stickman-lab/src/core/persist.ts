// persist —— 训练存档（用户 2026-10-01："刷新一下页面就没了，也存不下来"）。
//
// ★ 之前只有"导出/导入单个基因组文件"，**刷新页面照样全丢**（进化状态、σ、代数、
//   随机数状态、奖励权重都没了）。这里做两层：
//   ① **自动存档**：每个新代写一次 localStorage，刷新页面自动接着训；
//   ② **会话文件**：导出/导入一个完整的会话（种群 + 最优 + σ + RNG 状态 + 权重 + 历史尾部）。
//
// 格式带版本号 + 形状校验：网络形状变了（关节数/隐藏层变了）会**明确报错**，
// 而不是把一个长度不对的基因组塞进去然后行为诡异地跑。

import type { RngState } from './genome';


/** localStorage 的键（带版本号，将来改格式不冲突） */
export const SAVE_KEY = 'stickman-lab/session/v1';
/** 存档格式版本 */
export const SAVE_VERSION = 1;

export interface SessionSnapshot {
  /** 格式版本 */
  v: number;
  /** 模式：walk / fight */
  mode: string;
  /** 已跑代数 */
  gen: number;
  /** 自适应突变强度 */
  sigma: number;
  /** 随机数状态（含高斯采样器缓存的样本，决定"从哪一步继续"） */
  rng: RngState & { spare: number; hasSpare: boolean };
  /** 上一代平均分（1/5 法则判据；null = 尚无） */
  prevMean: number | null;
  /** 当代种群（长度 = population，每个元素是一个基因组） */
  genomes: number[][];
  /** 历史最优 */
  bestEver: number[];
  bestEverFitness: number;
  /** 奖励权重（FitnessWeights 的数值部分） */
  weights: Record<string, number>;
  /** 逐关节移动倍率 */
  moveScale: Record<string, number>;
  /** 网络形状，导入时校验 */
  shape: { inputs: number; hidden: number; outputs: number };
  /** 历史尾部（只做展示/画曲线） */
  history: { gen: number; best: number; mean: number }[];
  /** 人读的备注 */
  note?: string;
  /** 存档时刻 */
  at: number;
}

/** 组装快照（由 Trainer 提供原始数据） */
export function packSession(x: Omit<SessionSnapshot, 'v' | 'at'>): string {
  const obj: SessionSnapshot = { ...x, v: SAVE_VERSION, at: Date.now() };
  return JSON.stringify(obj);
}

export class SnapshotError extends Error {}

/** 解析 + 校验。形状不符/长度不对都**抛错**，不静默降级。 */
export function unpackSession(text: string, shape: { inputs: number; hidden: number; outputs: number },
  paramCount: number, population: number): SessionSnapshot {
  let o: SessionSnapshot;
  try {
    o = JSON.parse(text) as SessionSnapshot;
  } catch {
    throw new SnapshotError('不是合法的 JSON');
  }
  if (o.v !== SAVE_VERSION) throw new SnapshotError(`存档版本 ${o.v} ≠ 当前 ${SAVE_VERSION}`);
  if (!o.shape || o.shape.inputs !== shape.inputs || o.shape.hidden !== shape.hidden
      || o.shape.outputs !== shape.outputs) {
    throw new SnapshotError(
      `网络形状不符：存档 ${o.shape?.inputs}/${o.shape?.hidden}/${o.shape?.outputs}`
      + ` vs 当前 ${shape.inputs}/${shape.hidden}/${shape.outputs}（关节数或隐藏层变了，旧存档作废）`,
    );
  }
  if (!Array.isArray(o.bestEver) || o.bestEver.length !== paramCount) {
    throw new SnapshotError(`bestEver 长度 ${o.bestEver?.length} ≠ 参数数 ${paramCount}`);
  }
  if (!Array.isArray(o.genomes) || o.genomes.length !== population) {
    throw new SnapshotError(`种群长度 ${o.genomes?.length} ≠ ${population}`);
  }
  for (let i = 0; i < o.genomes.length; i++) {
    if (!Array.isArray(o.genomes[i]) || o.genomes[i].length !== paramCount) {
      throw new SnapshotError(`genomes[${i}] 长度不对`);
    }
  }
  return o;
}

// ---------------------------------------------------------------- 浏览器侧
// （Node 里没有 localStorage，所以这几个函数单独放，用 typeof 判断）

export function saveLocal(text: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(SAVE_KEY, text);
    return true;
  } catch {
    return false;   // 隐私模式 / 配额满
  }
}

export function loadLocal(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
  } catch { /* 忽略 */ }
}

/** 存档大小（KB），用于状态栏 */
export function sizeKb(text: string): number {
  return text.length / 1024;
}

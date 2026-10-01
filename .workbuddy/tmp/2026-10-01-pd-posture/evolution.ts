// ============================================================
// evolution —— 进化策略（精英保留 + 自适应 sigma）
// ============================================================
// 为什么不用 PPO/DQN：那需要逐状态的价值估计和大量超参，动辄几十万步才出结果，
// 还得拽进来一个深度学习框架（体积 + 复杂度都超标）。
// 进化策略在这类"低维连续控制 + 有明确标量分数"的问题上又稳又便宜：
//   · 不需要梯度，天然可并行、可随时中断查看
//   · 一段时间不用就能直接导出权重（基因组就是全部状态）
//   · 种群本身带探索，不会像单个体 RL 那样卡在局部最优后彻底死掉
//
// 1/5 成功法则：若超过 1/5 的子代比上一代好，说明步子太保守 → 放大 sigma；
//              否则步子太大 → 缩小 sigma。这是 ES 里最便宜也最有效的自适应。

import { BRAIN_SHAPE, brainParamCount, type BrainShape } from './brain';
import {
  blendInto, makeGaussian, makeRng, mutateInto, randomGenome, type Rng,
} from './genome';
import { Sim, type SimConfig } from './sim';
import type { Skeleton } from './skeleton';

/** 初始权重的整体尺度（逐层再按扇入缩放，见 genome.randomGenome） */
export const INIT_WEIGHT_SCALE = 1.0;

export interface TrainerConfig {
  /** 种群大小（每个个体一个独立 World） */
  population: number;
  /** 精英保留比例 */
  eliteFrac: number;
  /** 初始 / 上下限变异强度 */
  sigmaInit: number;
  sigmaMin: number;
  sigmaMax: number;
  /** 每个参数被变异的概率 */
  mutationProb: number;
  seed: number;
}

export const DEFAULT_TRAINER: TrainerConfig = {
  population: 48,
  eliteFrac: 0.2,
  // ★★ 3D 之后这三个数**必须**跟着降下来（原值 0.28 / 0.02 / 0.6 / 0.35 是 2D 时代
  //    的 750 维参数空间配的）。现在 3163 维、权重按扇入缩放后量级只有 ~0.12，
  //    再用 σ=0.28 × 35% 的参数就变异，一步的扰动比权重本身还大两倍
  //    —— 实测 σ 会一路顶到上限 0.6，40 代的最佳分在 1.6 附近乱跳，等于随机游走。
  //    经验口径：ES 的 σ 应当和权重量级同阶，被变异的参数比例应当 ~1/√n。
  sigmaInit: 0.06,
  sigmaMin: 0.004,
  sigmaMax: 0.2,
  mutationProb: 0.12,
  seed: 20261001,
};

export interface GenStat {
  gen: number;
  best: number;
  mean: number;
  worst: number;
  sigma: number;
  /** 当代最佳个体的诊断量（前进米数 / 是否摔倒 / 命中数） */
  bestDist: number;
  bestFallen: boolean;
  hits: number;
  hurts: number;
  /** 本代平均消耗的物理步数（衡量"存活了多久"） */
  avgTicks: number;
}

export class Trainer {
  readonly shape: BrainShape;
  readonly cfg: TrainerConfig;
  readonly sims: Sim[];
  /** 当代基因组（每个都是一个 Float32Array，长度 = 参数量） */
  genomes: Float32Array[] = [];
  /** 当代已评估出的分数（未评估完的为 -Infinity） */
  fitness: Float64Array;

  gen = 0;
  sigma: number;
  /** 历史最佳（浅拷贝） */
  bestEver: Float32Array;
  bestEverFitness = -Infinity;
  /** 当代最佳 */
  bestNow: Float32Array;
  bestNowFitness = -Infinity;
  bestDistNow = 0;
  bestFallenNow = false;
  hitsNow = 0;
  hurtsNow = 0;
  history: GenStat[] = [];

  /** 当前正在评估的个体下标 */
  private cursor = 0;
  /** 上一代平均分（1/5 法则判据） */
  private prevMean = -Infinity;
  private rng: Rng;
  private gauss: () => number;
  /** 每帧实际消耗的物理步（对外报告，用于验证预算是否起作用） */
  stepsLastFrame = 0;

  constructor(
    sk: Skeleton,
    shape: BrainShape = BRAIN_SHAPE,
    simCfg?: SimConfig,
    cfg: TrainerConfig = DEFAULT_TRAINER,
  ) {
    this.shape = shape;
    this.cfg = cfg;
    this.rng = makeRng(cfg.seed);
    this.gauss = makeGaussian(this.rng);
    this.sigma = cfg.sigmaInit;

    this.sims = Array.from({ length: cfg.population }, () => new Sim(sk, shape, simCfg));
    this.fitness = new Float64Array(cfg.population).fill(-Infinity);

    const seedGenome = randomGenome(shape, this.gauss, INIT_WEIGHT_SCALE);
    this.genomes = Array.from({ length: cfg.population }, () => seedGenome.slice());
    this.bestEver = seedGenome.slice();
    this.bestNow = seedGenome.slice();
    this.startGeneration();
  }

  get population(): number { return this.cfg.population; }
  get evaluated(): number { return this.cursor; }
  get paramCount(): number { return brainParamCount(this.shape); }

  /**
   * 开工新一代：清分 + 让每个 Sim 装上自己的基因组并重置世界。
   * ★ 少了这里的 begin()，Sim 会一直停在 finished 状态 → advance() 空转 → 一个个体都跑不动。
   */
  private startGeneration(): void {
    this.fitness.fill(-Infinity);
    this.bestNowFitness = -Infinity;
    this.bestDistNow = 0;
    this.bestFallenNow = false;
    this.hitsNow = 0;
    this.hurtsNow = 0;
    this.cursor = 0;
    for (let i = 0; i < this.genomes.length; i++) {
      this.sims[i].begin(this.genomes[i]);
    }
  }

  /** 每帧调用：在预算内推进评估；一代评完立刻繁殖下一代 */
  tick(budgetSteps: number): void {
    let used = 0;
    while (used < budgetSteps && this.cursor < this.population) {
      const sim = this.sims[this.cursor];
      const u = sim.advance(budgetSteps - used);
      used += u;
      if (sim.finished) {
        this.fitness[this.cursor] = sim.fitness;
        if (sim.fitness > this.bestNowFitness) {
          this.bestNowFitness = sim.fitness;
          this.bestNow.set(this.genomes[this.cursor]);
          this.bestDistNow = sim.distance;
          this.bestFallenNow = sim.fallen;
          this.hitsNow = sim.hits;
          this.hurtsNow = sim.hurts;
        }
        this.cursor++;
      } else if (u === 0) {
        // 防御：不该发生（advance 在未完成时必消耗至少一步），避免死循环
        break;
      }
    }
    this.stepsLastFrame = used;

    if (this.cursor >= this.population) {
      this.recordAndBreed();
    }
  }

  /** 一代结束：记账 → 选精英 → 变异/杂交 → 开工下一代 */
  private recordAndBreed(): void {
    const n = this.population;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => this.fitness[b] - this.fitness[a],
    );

    const best = this.fitness[order[0]];
    const worst = this.fitness[order[n - 1]];
    let sum = 0, ticks = 0;
    for (let i = 0; i < n; i++) { sum += this.fitness[i]; ticks += this.sims[i].ticksDone; }
    const mean = sum / n;

    if (best > this.bestEverFitness) {
      this.bestEverFitness = best;
      this.bestEver.set(this.genomes[order[0]]);
    }

    this.history.push({
      gen: this.gen, best, mean, worst, sigma: this.sigma,
      bestDist: this.bestDistNow, bestFallen: this.bestFallenNow,
      hits: this.hitsNow, hurts: this.hurtsNow,
      avgTicks: ticks / n,
    });
    if (this.history.length > 4000) this.history.splice(0, 1000);

    // ---- 1/5 成功法则自适应 sigma ----
    let improved = 0;
    if (Number.isFinite(this.prevMean)) {
      for (let i = 0; i < n; i++) if (this.fitness[i] > this.prevMean) improved++;
      const rate = improved / n;
      this.sigma *= rate > 0.2 ? 1.15 : 0.9;
      this.sigma = Math.min(this.cfg.sigmaMax, Math.max(this.cfg.sigmaMin, this.sigma));
    }
    this.prevMean = mean;

    // ---- 繁殖 ----
    const eliteCount = Math.max(1, Math.round(n * this.cfg.eliteFrac));
    const elites: Float32Array[] = [];
    for (let i = 0; i < eliteCount; i++) elites.push(this.genomes[order[i]].slice());

    const next: Float32Array[] = [];
    for (let i = 0; i < eliteCount; i++) next.push(elites[i].slice());

    while (next.length < n) {
      const child = new Float32Array(this.paramCount);
      if (this.rng() < 0.25 && eliteCount >= 2) {
        // 杂交：两个精英的按比例混合，再小步变异 —— 提供组合式探索
        const a = elites[(this.rng() * eliteCount) | 0];
        const b = elites[(this.rng() * eliteCount) | 0];
        blendInto(a, b, child, this.rng);
        mutateInto(child, child, this.sigma * 0.5, this.cfg.mutationProb, this.rng, this.gauss);
      } else {
        const a = elites[(this.rng() * eliteCount) | 0];
        mutateInto(a, child, this.sigma, this.cfg.mutationProb, this.rng, this.gauss);
      }
      next.push(child);
    }

    this.genomes = next;
    this.gen++;
    this.startGeneration();
  }

  /** 重开种群（换 seed，从随机权重重来） */
  resetPopulation(seed = (Math.random() * 0xffffffff) >>> 0): void {
    this.rng = makeRng(seed);
    this.gauss = makeGaussian(this.rng);
    this.sigma = this.cfg.sigmaInit;
    this.prevMean = -Infinity;
    const g0 = randomGenome(this.shape, this.gauss, INIT_WEIGHT_SCALE);
    for (let i = 0; i < this.genomes.length; i++) {
      this.genomes[i] = g0.slice();
      mutateInto(g0, this.genomes[i], this.cfg.sigmaInit, this.cfg.mutationProb, this.rng, this.gauss);
    }
    this.gen = 0;
    this.bestEverFitness = -Infinity;
    this.history.length = 0;
    this.startGeneration();
  }

  /** 把一份外部基因组注入当代（导入存档 / 用历史最佳继续跑） */
  inject(genome: Float32Array, asBest = true): void {
    if (genome.length !== this.paramCount) {
      throw new Error(`[trainer] 注入的基因组长度 ${genome.length} ≠ ${this.paramCount}`);
    }
    if (asBest) this.bestEver.set(genome);
    for (let i = 0; i < this.genomes.length; i++) {
      if (i === 0) this.genomes[i].set(genome);
      else mutateInto(genome, this.genomes[i], this.sigma, this.cfg.mutationProb, this.rng, this.gauss);
    }
    this.startGeneration();
  }

  /** 展示视图用：当前应当渲染哪个基因组（用历史最佳，比当代最佳稳定） */
  showcase(): Float32Array {
    return this.bestEverFitness > -Infinity ? this.bestEver : this.genomes[0];
  }
}

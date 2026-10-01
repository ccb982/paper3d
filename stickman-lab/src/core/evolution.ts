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
import { BEST_PHASE, phaseGenomeFor } from './phaseSeed';
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
  /** 是否把"手工相位步态"放进初始种群（见 phaseSeed.ts） */
  seedGait: boolean;
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
  seedGait: true,
  mutationProb: 0.12,
  seed: 20261001,
};

export interface GenStat {
  /** 本代最优个体的分项奖励（键同 Sim.terms）——新一代开始时会被清空，所以必须随历史一起存 */
  bestTerms: Record<string, number>;
  bestSwitches: number;
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
  /** 本代最优个体的分项奖励（键同 Sim.terms） */
  bestTermsNow: Record<string, number> = {};
  bestSwitchesNow = 0;
  hitsNow = 0;
  hurtsNow = 0;
  history: GenStat[] = [];

  /** 当前正在评估的个体下标 */
  private cursor = 0;
  /** 上一代平均分（1/5 法则判据） */
  private prevMean = -Infinity;
  /** 关节数（相位种子要按关节数推 shape） */
  private jointCount = 0;
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

    this.jointCount = sk.joints.length;
    this.sims = Array.from({ length: cfg.population }, () => new Sim(sk, shape, simCfg));
    this.fitness = new Float64Array(cfg.population).fill(-Infinity);

    this.genomes = this.seedPopulation();
    this.bestEver = this.genomes[0].slice();
    this.bestNow = this.genomes[0].slice();
    this.startGeneration();
  }

  /**
   * ★★ 造初始种群。两样东西缺一个，ES 都会卡死：
   *
   * ① **平凡解（全 0 权重）必须在池子里**。
   *    `randomGenome` 的注释声称"输出 ≈ tanh(0) = 0 ⇒ 初始行为 = 保持初始姿态"——
   *    **那句话是错的**：W1/W2 按扇入缩放后预激活仍是 O(0.5)，输出是 tanh(0.4) ≈ 0.4，
   *    也就是一开局全员按 40% 量程乱扯关节（probe-posture [C0] 实测读数）。
   *    而"θ_ref = 0 ⇒ 保持绑定姿态"是**站立任务的精确最优解**（绑定姿态的 CoM 投影本来
   *    就在支撑多边形内，硬件够硬时它永远站着，实测零输出 6 s 跑满、适应度 +8.59）。
   *    不把全 0 权重放进池子，ES 从"抽风"盆地出发就永远爬不到它
   *    （实测：20 代最佳 −1.26，比"什么都不做"差 10 分，且存活 0.82 s < 6 s）。
   *
   * ② **多样性**。原来 24 个个体是**同一个基因组的克隆**（gen0 的 best == mean 就是证据），
   *    第一代没有任何可挑选的变异，等于白烧一代。
   *
   * 配比：1 个精确平凡解 + 1 个随机种子 + 其余对半分（一半围绕平凡解做局部精修，
   * 一半围绕随机权重做远征探索）。σ 用 sigmaInit：对全 0 基因组来说，
   * 12% 的参数 ±0.06 得到的是"几乎不动"的邻居，正是站立任务需要的梯度。
   */
  private seedPopulation(): Float32Array[] {
    const n = this.cfg.population;
    const zero = new Float32Array(this.paramCount);
    const rnd = randomGenome(this.shape, this.gauss, INIT_WEIGHT_SCALE);
    // ★★ 相位步态种子（用户："还得优化参数啊"）：前几个个体直接给"已经会走"的基因组。
    //   为什么要：从全随机出发，"先迈出第一步"没有梯度（要同时满足换脚+前进+CoM 稳），
    //   实测几十代最好个体都只是原地抖腿。现在 ES 从 1.21 m 的祖代开始爬"走得久"。
    const gait: Float32Array[] = [];
    if (this.cfg.seedGait) {
      for (const sc of [BEST_PHASE.scale, 0.5, 1.0]) {
        gait.push(phaseGenomeFor(this.jointCount, { ...BEST_PHASE, scale: sc }));
      }
    }
    const out: Float32Array[] = [zero, rnd.slice(), ...gait];
    while (out.length < n) {
      const src = out.length % 2 === 0 ? zero : rnd;
      const dst = new Float32Array(this.paramCount);
      mutateInto(src, dst, this.cfg.sigmaInit, this.cfg.mutationProb, this.rng, this.gauss);
      out.push(dst);
    }
    return out;
  }

  get population(): number { return this.cfg.population; }
  get evaluated(): number { return this.cursor; }
  /** ★ 位移门槛课程的当前值 / 总代数（UI 显示用） */
  stepMinDxNow = 0;
  rampGens = 60;

  /**
   * ★ 运行时调步态奖励（UI 用，用户 2026-10-01："做成可调的按钮，走直线和阈值都是可选项，
   *   但是换脚奖励必须有，前进奖励要弱"）。转发给整代所有 Sim，下一个 tick 就生效。
   */
  applyGaitTuning(o: {
    straight?: boolean; minDx?: number; wSwitch?: number; wDistance?: number; wStep?: number; wHold?: number; wStill?: number; wJoint?: number; wAlt?: number; wExcl?: number; wMove?: number; wTask?: number;
    moveScale?: Record<string, number>;
  }): void {
    for (const sm of this.sims) {
      if (o.straight !== undefined || o.minDx !== undefined) {
        sm.setStepRule({ straight: o.straight, minDx: o.minDx });
      }
      const w: Record<string, number> = {};
      if (o.wSwitch !== undefined) w.switch = o.wSwitch;
      if (o.wDistance !== undefined) w.distance = o.wDistance;
      if (o.wStep !== undefined) w.step = o.wStep;
      if (o.wHold !== undefined) w.hold = o.wHold;
      if (o.wStill !== undefined) w.still = o.wStill;
      if (o.wJoint !== undefined) w.joint = o.wJoint;
      if (o.wAlt !== undefined) w.alt = o.wAlt;
      if (o.wExcl !== undefined) w.excl = o.wExcl;
      if (o.wMove !== undefined) w.move = o.wMove;
      if (o.wTask !== undefined) w.task = o.wTask;
      if (o.moveScale) {
        for (const sm of this.sims) for (const [j, v] of Object.entries(o.moveScale)) sm.w.moveScale[j] = v;
      }
      if (Object.keys(w).length) sm.setWeights(w);
    }
    if (o.minDx !== undefined) this.stepMinDxManual = o.minDx;
  }

  /** 手动设定过阈值 ⇒ 课程不再自动抬升（用户在 UI 上自己控制） */
  stepMinDxManual = -1;
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
    this.bestTermsNow = {};
    this.bestSwitchesNow = 0;
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
          // ★ 本代最优个体的分项（无头训练探针/UI 都要看"这一步到底哪项拿了分"）
          this.bestTermsNow = sim.terms;
          this.bestSwitchesNow = sim.stepStat?.count ?? 0;
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

    // ---- ★★ 位移门槛课程（用户 2026-10-01："阈值可以逐步增大"+"现在先用更小的阈值"）----
    //   起步 stepMinDx（小到够得着），在前 `rampGens` 代内线性抬到 stepMinDxMax。
    //   为什么要课程：门槛一上来就卡死 ⇒ 步数分恒为 0 ⇒ ES 看不到任何"多迈一步"的梯度
    //   （实测：12 cm 门槛下连最好的手工步态都是 0 分）。
    const c0 = this.sims[0]?.cfg.stepMinDx ?? 0;
    const cMax = this.sims[0]?.cfg.stepMinDxMax ?? 0;
    if (cMax > 0 && cMax > c0 && this.stepMinDxManual < 0) {
      const RAMP = 60;                       // 抬升用多少代走完
      const u = Math.min(1, this.gen / RAMP);
      const cur = c0 + (cMax - c0) * u;
      for (const sm of this.sims) sm.setStepMinDx(cur);
      this.stepMinDxNow = cur;
      this.rampGens = RAMP;
    }

    this.history.push({
      gen: this.gen, best, mean, worst, sigma: this.sigma,
      bestTerms: { ...this.bestTermsNow }, bestSwitches: this.bestSwitchesNow,
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
    // ★ 同样要带上平凡解，见 seedPopulation 的注释
    this.genomes = this.seedPopulation();
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

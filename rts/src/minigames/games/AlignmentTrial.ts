// ============================================================
// AlignmentTrial.ts —— 小游戏「校队检测」（第一个）
// ============================================================
// 玩法（用户定）：
//   · 上部固定一个六星，下部六星在轨道上左右往复；
//   · 玩家在下排与上排**对齐**的瞬间点击 → 水平偏差越小分越高；
//   · 共 ROUNDS 次，取平均分（0~100）。
//
// 素材：public/ui/六颗星星.ftx3.gz（FTX → CPU 合成 → dataURL，与 BackButton 同一套路）。
//   ★ 素材加载失败会降级成文字「★」，**绝不留下一个看不见的空面板**。
//
// 结算口径：err = |下排x - 上排x| / 轨道半幅（0~1）
//   err <= 0.04 → 100（完美区）；否则 100×(1-err) 线性到 0。
// ============================================================

import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from '../../ui/shared/ftxFrameToCanvas';
import { registerMiniGame } from '../registry';
import type { MiniGame, MiniGameHost } from '../MiniGameTypes';

const STAR_ASSET_URL = '/ui/六颗星星.ftx3.gz';
/** 判定次数 */
const ROUNDS = 5;
/** 起始往复周期（秒；一轮完整来回）——每轮递减，越到后面越快 */
const PERIOD0 = 1.6;
const PERIOD_MUL = 0.88;
/** 完美区（err 小于此值 = 满分） */
const PERFECT_ERR = 0.04;
/** 判定后到下一轮的停顿（秒，给玩家看反馈） */
const GAP_SECONDS = 0.45;
/** 星星显示宽度（px；高度按素材真实比例） */
const STAR_W = 170;

/** 星星纹理（模块级单例，多局复用） */
interface StarTexture {
  dataUrl: string;
  ratio: number;
}
let starTex: StarTexture | null = null;
let starTexPromise: Promise<StarTexture | null> | null = null;

function loadStarTexture(): Promise<StarTexture | null> {
  if (starTex) return Promise.resolve(starTex);
  if (!starTexPromise) {
    starTexPromise = FtxAsset.load(STAR_ASSET_URL)
      .then((asset) => {
        const size = asset.getFrameSize(0);
        const canvas = compositeFrameToCanvas(asset, 0);
        const tex: StarTexture = {
          dataUrl: canvas.toDataURL(),
          ratio: size ? size.width / Math.max(1, size.height) : canvas.width / Math.max(1, canvas.height),
        };
        starTex = tex;
        return tex;
      })
      .catch((err) => {
        console.warn('[校队检测] 六星素材加载失败，降级为文字:', err);
        return null;
      });
  }
  return starTexPromise;
}

export class AlignmentTrial implements MiniGame {
  readonly id = 'alignment_trial';
  readonly title = '校队检测';
  readonly hint = `下排六星与上排对齐时点击（共 ${ROUNDS} 次）`;

  private host: MiniGameHost | null = null;
  private rootEl: HTMLDivElement | null = null;
  private trackEl: HTMLDivElement | null = null;
  private topEl: HTMLElement | null = null;
  private movingEl: HTMLElement | null = null;
  private infoEl: HTMLDivElement | null = null;
  private flashEl: HTMLDivElement | null = null;

  private raf = 0;
  private startedAt = 0;
  private trackW = 520;
  /** 当前轮次下标（0..ROUNDS-1） */
  private round = 0;
  private scores: number[] = [];
  /** 判定后的冷却时间戳（performance.now）；> now 表示不接受输入 */
  private lockUntil = 0;
  /** 锁定期间最后一次得分（用于显示） */
  private lastErrPct = 0;

  mount(root: HTMLElement, host: MiniGameHost): void {
    this.host = host;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;align-items:center;';

    // ---- 信息行 ----
    this.infoEl = document.createElement('div');
    this.infoEl.style.cssText = 'font-size:13px;color:#9fc4e8;letter-spacing:1px;';
    this.updateInfo();

    // ---- 轨道 ----
    const track = document.createElement('div');
    track.style.cssText = [
      'position:relative', 'width:100%', 'height:190px',
      'background:linear-gradient(180deg,rgba(20,34,54,0.9),rgba(14,24,40,0.9))',
      'border:1px solid rgba(110,160,220,0.35)', 'border-radius:10px',
      'overflow:hidden', 'cursor:pointer',
    ].join(';');
    this.trackEl = track;

    // 中线（视觉参考：上排的中心延伸到整条轨道）
    const axis = document.createElement('div');
    axis.style.cssText = [
      'position:absolute', 'left:50%', 'top:0', 'bottom:0', 'width:1px',
      'background:rgba(140,200,255,0.25)', 'transform:translateX(-0.5px)',
    ].join(';');
    track.appendChild(axis);

    // 上排（固定）
    const top = this.makeStar('rgba(255,255,255,0.95)');
    top.style.cssText += 'position:absolute;left:50%;top:16px;transform:translateX(-50%);';
    this.topEl = top;
    track.appendChild(top);

    // 下排（移动）—— 定位在轨道中心，位移全靠 translateX
    const moving = this.makeStar('rgba(255,214,120,0.98)');
    moving.style.cssText += 'position:absolute;left:50%;bottom:16px;'
      + `margin-left:${-STAR_W / 2}px;will-change:transform;`;
    this.movingEl = moving;
    track.appendChild(moving);

    // 判定闪光
    const flash = document.createElement('div');
    flash.style.cssText = [
      'position:absolute', 'inset:0', 'pointer-events:none', 'opacity:0',
      'background:radial-gradient(circle at 50% 60%, rgba(120,220,255,0.35), transparent 60%)',
      'transition:opacity .12s ease',
    ].join(';');
    this.flashEl = flash;
    track.appendChild(flash);

    track.addEventListener('click', this.onTap);
    wrap.append(this.infoEl, track);
    root.appendChild(wrap);
    this.rootEl = wrap;

    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);

    // 尺寸（首帧布局后再量，避免拿到 0）
    requestAnimationFrame(() => {
      this.measure();
      void loadStarTexture().then((tex) => {
        for (const el of [this.topEl, this.movingEl]) {
          if (!el) continue;
          const color = el.dataset.color ?? '#ffffff';
          const img = el.querySelector('img');
          if (tex && img) {
            img.src = tex.dataUrl;
            el.style.height = `${Math.round(STAR_W / Math.max(0.05, tex.ratio))}px`;
          } else {
            // ★ 素材不可用（加载失败 / 无 img）：降级为文字星，保证一定可见
            this.toTextStar(el, color);
          }
        }
      });
    });

    this.startedAt = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
    this.trackEl?.removeEventListener('click', this.onTap);
    this.rootEl?.remove();
    this.rootEl = null;
    this.trackEl = null;
    this.topEl = null;
    this.movingEl = null;
    this.host = null;
  }

  // ============================================================
  // 内部
  // ============================================================

  /**
   * 生成一颗星的「槽位」。
   * ★ 返回**槽位 div**（而非 img）是关键：槽位引用在 mount→dispose 全生命周期内
   *   恒定不变，内部无论换成 img 还是文字 ★ 都不影响 tick 里的 transform 驱动。
   *   早期版本直接返回 img，素材失败时 replaceWith 会让 this.movingEl 指向
   *   已脱离 DOM 的节点 → 下排再也动不了。
   */
  private makeStar(color: string): HTMLDivElement {
    const slot = document.createElement('div');
    slot.dataset.color = color;
    slot.style.cssText = [
      `width:${STAR_W}px`, 'height:36px', 'pointer-events:none',
      `filter:drop-shadow(0 0 6px ${color})`,
    ].join(';');
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.style.cssText = 'width:100%;height:100%;display:block;object-fit:contain;';
    slot.appendChild(img);
    return slot;
  }

  /** 把槽位内容换成文字星（素材不可用时的兜底，绝不留下空白轨道） */
  private toTextStar(slot: HTMLElement, color: string): void {
    const d = document.createElement('div');
    d.textContent = '★'.repeat(6);
    d.style.cssText = [
      'width:100%', 'text-align:center', 'font-size:26px', 'line-height:36px',
      `color:${color}`, 'letter-spacing:2px',
      'text-shadow:0 0 8px rgba(255,220,140,0.6)',
    ].join(';');
    slot.replaceChildren(d);
  }

  private measure(): void {
    if (this.trackEl) this.trackW = Math.max(240, this.trackEl.clientWidth);
  }

  private onResize = (): void => { this.measure(); };

  /** 当前轮往复相位对应的 x 偏移（相对轨道中心，px） */
  private currentOffset(now: number): number {
    const period = PERIOD0 * Math.pow(PERIOD_MUL, this.round);
    const t = (now - this.startedAt) / 1000;
    const phase = (t / period) % 1;
    // 三角波：0 → 1 → 0
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    const halfAmp = (this.trackW - STAR_W) / 2;
    return -halfAmp + tri * 2 * halfAmp;
  }

  private tick = (): void => {
    const now = performance.now();
    if (now < this.lockUntil) {
      // 冷却中：保持下排不动（停在判定那一刻）
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    if (this.movingEl) {
      this.movingEl.style.transform = `translateX(${this.currentOffset(now).toFixed(2)}px)`;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private onTap = (): void => { this.judge(); };

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      e.stopPropagation();
      this.judge();
    }
  };

  /** 判定一次 */
  private judge(): void {
    const now = performance.now();
    if (now < this.lockUntil) return;      // 冷却中：忽略
    if (this.round >= ROUNDS) return;

    const halfAmp = Math.max(1, (this.trackW - STAR_W) / 2);
    const offset = this.currentOffset(now);
    const err = Math.min(1, Math.abs(offset) / halfAmp);
    const score = err <= PERFECT_ERR ? 100 : Math.round(100 * (1 - err));
    this.scores.push(score);
    this.lastErrPct = Math.round(err * 100);

    // 闪光反馈
    if (this.flashEl) {
      this.flashEl.style.opacity = '1';
      setTimeout(() => { if (this.flashEl) this.flashEl.style.opacity = '0'; }, 130);
    }

    this.round++;
    this.updateInfo(score);

    if (this.round >= ROUNDS) {
      // 收尾：短暂停顿让玩家看到最后一次结果，再结算
      this.lockUntil = now + GAP_SECONDS * 1000;
      setTimeout(() => {
        const avg = this.scores.reduce((a, b) => a + b, 0) / Math.max(1, this.scores.length);
        const hit = this.scores.filter((s) => s >= 80).length;
        this.host?.finish(avg, `命中 ${hit}/${ROUNDS}，均分 ${Math.round(avg)}`);
      }, GAP_SECONDS * 1000 + 120);
      return;
    }

    // 下一轮：停顿后重新计时（相位归零，玩家可预期）
    this.lockUntil = now + GAP_SECONDS * 1000;
    setTimeout(() => { this.startedAt = performance.now(); }, GAP_SECONDS * 1000);
  }

  private updateInfo(lastScore?: number): void {
    if (!this.infoEl) return;
    if (lastScore === undefined) {
      this.infoEl.textContent = `第 ${this.round + 1} / ${ROUNDS} 次　点击对齐`;
      return;
    }
    const tag = lastScore >= 95 ? '完美' : lastScore >= 80 ? '优秀' : lastScore >= 50 ? '合格' : '偏斜';
    this.infoEl.textContent =
      `第 ${this.round} / ${ROUNDS} 次　${tag} +${lastScore}（偏差 ${this.lastErrPct}%）`;
  }
}

registerMiniGame('alignment_trial', () => new AlignmentTrial());

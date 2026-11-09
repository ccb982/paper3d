// ============================================================
// RuntimeProbe —— 运行时插桩（仅 URL 带参数时生效，默认零开销）
//   ?fxProbe=1        同时开启月亮 + 子弹
//   ?fxMoonDebug=1    只开月亮
//   ?fxBulletDebug=1  只开子弹
//
// 月亮：一条日志覆盖「follow → MoonChannel.update → RT 渲染 → RT 采样 → SkyDome 合成」
// 子弹：一条日志覆盖「池/活动数/重复回收 → 命中同步耗时 → 帧间隔 → 渲染调用数」
// ============================================================

const qs =
  typeof location !== 'undefined'
    ? new URLSearchParams(location.search)
    : new URLSearchParams('');

export const PROBE = qs.has('fxProbe');
export const MOON_PROBE = PROBE || qs.has('fxMoonDebug');
export const BULLET_PROBE = PROBE || qs.has('fxBulletDebug');

export const nowMs = (): number => performance.now();

// ------------------------------------------------------------
// 月亮
// ------------------------------------------------------------
export const moonProbe = {
  /** 挂载结果：native / legacy / none / fail:<原因> */
  attach: 'none' as string,
  followCalls: 0,
  followAnimate: true,
  hour: 0,
  flight: false,
  winW: 0,
  winH: 0,
  updateCalls: 0,
  updateSkipped: 0,
  updateNoRenderer: 0,
  updateNoEntities: 0,
  renders: 0,
  renderMs: 0,
  lastRenderMs: 0,
  hasFrame: false,
  entries: -1,
  rtW: 0,
  rtH: 0,
  sample: null as null | { alphaHits: number; total: number; maxRgb: number; ms: number; sig: number },
  /** 采样时刻的 VAT 时间与帧号（判断 RT 全 0 是否只在动画某些相位出现） */
  vat: 0,
  frame: -1,
  /** ★ 呼吸扭曲时间（秒）：与 VAT 解耦后，用它证明扭曲仍在推进 */
  distortTime: 0,
  /** 仅插桩：强制 VAT 几何时间（秒；null=按 animate 推进） */
  forceVat: null as number | null,
  /** 仅插桩：强制扭曲时间（秒；null=按真实时间推进） */
  forceDistort: null as number | null,
  /** 仅插桩：每 N 次 update 读回一次 RT（自动化脚本可调小以加速采样） */
  sampleEvery: 30,
  sky: {
    useEffect: -1,
    ready: false,
    /** 天空 group（含月亮 mesh）自身可见性：舰内 setEnvironment('ship') 会整体隐藏 */
    groupVisible: false,
    meshVisible: false,
    uVisible: 0,
    tint: 0,
    scaleX: 0,
    scaleY: 0,
    /** 月亮 mesh 的世界坐标（判断是否被穹顶/相机裁剪） */
    worldY: 0,
    /** 材质里绑的 uMoonEffectTex 是否就是 MoonView 的 RT 纹理（false = 绑错/为 null） */
    texIsRT: false,
    /** uMoonEffectTex 是否为 null（shader 采样空纹理 → 本体必透明） */
    texNull: true,
    /** 月亮方向（世界单位向量；用于把相机对准月亮做视觉复核） */
    dirX: 0,
    dirY: 0,
    dirZ: 0,
    /** 月亮 quad 法线 · (月亮→锚点) ；≈0 或负 = quad 侧对/背对相机（必看不见） */
    faceDot: 0,
  },
  _t: 0,
  _upd: 0,
  _ren: 0,
  _fol: 0,
};

// ★ 仅插桩：把探针对象暴露给自动化脚本（默认不开探针时不存在）
if (MOON_PROBE && typeof window !== 'undefined') {
  (window as unknown as { __moonProbe?: typeof moonProbe }).__moonProbe = moonProbe;
}

export function probeMoonAttach(kind: string): void {
  if (!MOON_PROBE) return;
  moonProbe.attach = kind;
}

/** SkyDome.update 每帧调用（只在开启时记录 + 节流输出一条整合日志） */
export function probeMoonFlush(): void {
  if (!MOON_PROBE) return;
  const t = nowMs();
  if (t - moonProbe._t < 500) return;
  const dt = moonProbe._t > 0 ? (t - moonProbe._t) / 1000 : 0.5;
  moonProbe._t = t;
  const dFollow = (moonProbe.followCalls - moonProbe._fol) / dt;
  const dUpd = (moonProbe.updateCalls - moonProbe._upd) / dt;
  const dRen = (moonProbe.renders - moonProbe._ren) / dt;
  moonProbe._fol = moonProbe.followCalls;
  moonProbe._upd = moonProbe.updateCalls;
  moonProbe._ren = moonProbe.renders;

  const s = moonProbe.sample;
  const sampleTxt = s
    ? `alpha=${s.alphaHits}/${s.total} maxRGB=${s.maxRgb} sig=${s.sig} readMs=${s.ms.toFixed(1)}`
    : 'none';
  const sky = moonProbe.sky;

  // eslint-disable-next-line no-console
  console.log(
    `[moonProbe] attach=${moonProbe.attach} follow=${dFollow.toFixed(1)}/s animate=${moonProbe.followAnimate}` +
      ` t=${moonProbe.hour.toFixed(2)}h flight=${moonProbe.flight} win=${moonProbe.winW}x${moonProbe.winH}` +
      ` | update=${dUpd.toFixed(1)}/s skip=${moonProbe.updateSkipped} noRdr=${moonProbe.updateNoRenderer} noEnt=${moonProbe.updateNoEntities}` +
      ` renders=${dRen.toFixed(1)}/s hasFrame=${moonProbe.hasFrame} entries=${moonProbe.entries} rt=${moonProbe.rtW}x${moonProbe.rtH} lastRenderMs=${moonProbe.lastRenderMs.toFixed(1)}` +
      ` | rtSample ${sampleTxt} vat=${moonProbe.vat.toFixed(2)}s f=${moonProbe.frame} distort=${moonProbe.distortTime.toFixed(2)}s` +
      ` | sky uUse=${sky.useEffect} ready=${sky.ready} grpVis=${sky.groupVisible} meshVis=${sky.meshVisible} uVisible=${sky.uVisible.toFixed(3)} tint=${sky.tint.toFixed(3)} scale=${sky.scaleX.toFixed(3)}x${sky.scaleY.toFixed(3)} worldY=${sky.worldY.toFixed(1)} texNull=${sky.texNull} texIsRT=${sky.texIsRT}` +
      ` | dir=(${sky.dirX.toFixed(3)},${sky.dirY.toFixed(3)},${sky.dirZ.toFixed(3)}) faceDot=${sky.faceDot.toFixed(3)}`,
  );
}

// ------------------------------------------------------------
// 子弹
// ------------------------------------------------------------
interface PoolStat {
  label: string;
  capacity: number;
  pool: number;
  activeCount: number;
  activeSet: number;
  poolDupes: number;
}

export const bulletProbe = {
  spawns: 0,
  recycles: 0,
  /** recycle 时该槽位已在池里（重复回收） */
  recycleDup: 0,
  /** spawn 取出的槽位仍是 active（重复入池导致同槽双活） */
  spawnOnActive: 0,
  hits: 0,
  hitMs: 0,
  slowHits: 0,
  maxHitMs: 0,
  lastHitKind: '',
  lastHitDmg: 0,
  /** 单次命中耗时 > 5ms 的采样行（最多保留最近 3 条） */
  slowSamples: [] as string[],
  updateMs: 0,
  maxUpdateMs: 0,
  stepMs: 0,
  resetMs: 0,
  maxResetMs: 0,
  fxMs: 0,
  maxFxMs: 0,
  frameGapMaxMs: 0,
  /** 命中链细分：target.onTakeDamage（含 deactivate+recycle） */
  onTakeMs: 0,
  maxOnTakeMs: 0,
  /** 命中链细分：eventBus.emit('damage')（飘字 / 遗物事件） */
  evtMs: 0,
  maxEvtMs: 0,
  pools: [] as PoolStat[],
  _t: 0,
  _spawn: 0,
  _recycle: 0,
  _hits: 0,
  _hitMs: 0,
  _updMs: 0,
  _stepMs: 0,
  _resetMs: 0,
  _fxMs: 0,
  _onTake: 0,
  _evt: 0,
};

/** 命中链细分打点（DamagePipeline 调用；要么 onTake 要么 evt 吃掉时间） */
export function probeDamagePart(kind: 'onTake' | 'evt', ms: number): void {
  if (!BULLET_PROBE) return;
  if (kind === 'onTake') {
    bulletProbe.onTakeMs += ms;
    if (ms > bulletProbe.maxOnTakeMs) bulletProbe.maxOnTakeMs = ms;
  } else {
    bulletProbe.evtMs += ms;
    if (ms > bulletProbe.maxEvtMs) bulletProbe.maxEvtMs = ms;
  }
}

export function probePoolStat(stat: PoolStat): void {
  if (!BULLET_PROBE) return;
  const i = bulletProbe.pools.findIndex((p) => p.label === stat.label);
  if (i >= 0) bulletProbe.pools[i] = stat;
  else bulletProbe.pools.push(stat);
}

export function probeHit(ms: number, kind: string, dmg: number, extra: string): void {
  if (!BULLET_PROBE) return;
  bulletProbe.hits++;
  bulletProbe.hitMs += ms;
  bulletProbe.lastHitKind = kind;
  bulletProbe.lastHitDmg = dmg;
  if (ms > bulletProbe.maxHitMs) bulletProbe.maxHitMs = ms;
  if (ms >= 5) {
    bulletProbe.slowHits++;
    const line = `hit ${ms.toFixed(1)}ms kind=${kind} dmg=${dmg.toFixed(1)} ${extra}`;
    bulletProbe.slowSamples.push(line);
    if (bulletProbe.slowSamples.length > 3) bulletProbe.slowSamples.shift();
    // 立即输出，便于和掉帧瞬间对齐
    // eslint-disable-next-line no-console
    console.log(`[bulletProbe] SLOW ${line}`);
  }
}

/** BulletManager.update 每秒调用一次（节流） */
export function probeBulletFlush(): void {
  if (!BULLET_PROBE) return;
  const t = nowMs();
  if (bulletProbe._t === 0) {
    bulletProbe._t = t;
    return;
  }
  if (t - bulletProbe._t < 1000) return;
  const dt = (t - bulletProbe._t) / 1000;
  bulletProbe._t = t;
  const dSpawn = (bulletProbe.spawns - bulletProbe._spawn) / dt;
  const dRecycle = (bulletProbe.recycles - bulletProbe._recycle) / dt;
  const dHits = (bulletProbe.hits - bulletProbe._hits) / dt;
  const dHitMs = (bulletProbe.hitMs - bulletProbe._hitMs) / dt;
  const dUpdMs = (bulletProbe.updateMs - bulletProbe._updMs) / dt;
  const dStepMs = (bulletProbe.stepMs - bulletProbe._stepMs) / dt;
  const dResetMs = (bulletProbe.resetMs - bulletProbe._resetMs) / dt;
  const dFxMs = (bulletProbe.fxMs - bulletProbe._fxMs) / dt;
  const dOnTake = (bulletProbe.onTakeMs - bulletProbe._onTake) / dt;
  const dEvt = (bulletProbe.evtMs - bulletProbe._evt) / dt;
  bulletProbe._spawn = bulletProbe.spawns;
  bulletProbe._recycle = bulletProbe.recycles;
  bulletProbe._hits = bulletProbe.hits;
  bulletProbe._hitMs = bulletProbe.hitMs;
  bulletProbe._updMs = bulletProbe.updateMs;
  bulletProbe._stepMs = bulletProbe.stepMs;
  bulletProbe._resetMs = bulletProbe.resetMs;
  bulletProbe._fxMs = bulletProbe.fxMs;
  bulletProbe._onTake = bulletProbe.onTakeMs;
  bulletProbe._evt = bulletProbe.evtMs;

  const pools = bulletProbe.pools
    .map(
      (p) =>
        `${p.label}:pool=${p.pool}/${p.capacity} act=${p.activeCount} set=${p.activeSet} dup=${p.poolDupes}`,
    )
    .join(' ');
  // eslint-disable-next-line no-console
  console.log(
    `[bulletProbe] spawn=${dSpawn.toFixed(1)}/s recycle=${dRecycle.toFixed(1)}/s recycleDup=${bulletProbe.recycleDup} spawnOnActive=${bulletProbe.spawnOnActive}` +
      ` | hits=${dHits.toFixed(1)}/s hitMs=${dHitMs.toFixed(1)}ms/s slow(>=5ms)=${bulletProbe.slowHits} maxHit=${bulletProbe.maxHitMs.toFixed(1)}ms` +
      ` | onTake=${dOnTake.toFixed(1)}ms/s maxOnTake=${bulletProbe.maxOnTakeMs.toFixed(1)}ms evt=${dEvt.toFixed(1)}ms/s maxEvt=${bulletProbe.maxEvtMs.toFixed(1)}ms` +
      ` | update=${dUpdMs.toFixed(1)}ms/s maxUpdate=${bulletProbe.maxUpdateMs.toFixed(1)}ms step=${dStepMs.toFixed(1)}ms/s reset=${dResetMs.toFixed(1)}ms/s maxReset=${bulletProbe.maxResetMs.toFixed(1)}ms` +
      ` | hitFx=${dFxMs.toFixed(1)}ms/s maxHitFx=${bulletProbe.maxFxMs.toFixed(1)}ms` +
      ` | frameGapMax=${bulletProbe.frameGapMaxMs.toFixed(1)}ms` +
      ` | ${pools}`,
  );
  bulletProbe.maxHitMs = 0;
  bulletProbe.maxUpdateMs = 0;
  bulletProbe.maxResetMs = 0;
  bulletProbe.frameGapMaxMs = 0;
  bulletProbe.slowHits = 0;
  bulletProbe.maxOnTakeMs = 0;
  bulletProbe.maxEvtMs = 0;
}

export function probeBulletDump(): void {
  if (!BULLET_PROBE) return;
  // eslint-disable-next-line no-console
  console.log('[bulletProbe] slowSamples', bulletProbe.slowSamples.join(' || ') || '(none)');
}

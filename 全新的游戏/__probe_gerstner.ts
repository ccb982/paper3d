// 临时离屏探针：Gerstner 波场数学 —— 跑完即删
import {
  makeWaveSet, updateWaveSet, packWaves, sampleGerstner, phaseSpeed, angularFreq, boundSteepness,
  type WaveGenOpts,
} from './src/services/map/water/gerstner';

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { fails++; console.log('  FAIL  ' + msg); }
  else console.log('  PASS  ' + msg);
}

const OPTS: WaveGenOpts = {
  wavelength: [0.6, 14],
  ampRatio: 0.035,
  steepness: 0.85,
};

console.log('=== ① 深水色散：长波跑得快（c = √(g/k)）===');
{
  const cLong = phaseSpeed(14), cShort = phaseSpeed(0.6);
  console.log(`  λ=14m ⇒ c=${cLong.toFixed(2)} m/s；λ=0.6m ⇒ c=${cShort.toFixed(2)} m/s`);
  assert(cLong > cShort, '长波相速度 > 短波（真实海浪现象）');
  const w1 = angularFreq(14), w2 = angularFreq(0.6);
  console.log(`  ω：λ=14m ⇒ ${w1.toFixed(3)}；λ=0.6m ⇒ ${w2.toFixed(3)} rad/s`);
}

console.log('=== ② 陡度有界（Q·A·k ≤ 1 ⇒ 波峰不自交）===');
{
  let worst = 0;
  for (const amp of [0.02, 0.1, 0.5, 2.0]) {
    for (const wl of [0.6, 3, 14]) {
      const q = boundSteepness(amp, wl, 0.9);
      const k = (2 * Math.PI) / wl;
      worst = Math.max(worst, q * amp * k);
    }
  }
  console.log(`  所有组合的 Q·A·k 最大值 = ${worst.toFixed(4)}（应 ≤ 1）`);
  assert(worst <= 1.0001, '陡度有界（波峰不自交）');
}

console.log('=== ③ 波集生成：波长几何级数 + 方向集中 ===');
{
  const waves = makeWaveSet(12345, 8, OPTS);
  console.log('  ' + waves.map((w) => `λ${w.wavelength.toFixed(1)}/A${w.amplitude.toFixed(3)}`).join(' '));
  assert(waves.length === 8, '8 个波');
  const wls = waves.map((w) => w.wavelength);
  assert(wls[0] < wls[wls.length - 1], '波长递增（长波→短波）');
  const dirs = waves.map((w) => Math.hypot(w.dirX, w.dirZ));
  assert(dirs.every((d) => Math.abs(d - 1) < 1e-5), '方向向量归一（hypot = 1）');
}

console.log('=== ④ 采样：高度范围合理 + 法线是单位向量 ===');
{
  const waves = makeWaveSet(999, 8, OPTS);
  let minY = Infinity, maxY = -Infinity;
  let worstLen = 0;
  for (let i = 0; i < 400; i++) {
    const x = (i % 20) * 1.7, z = Math.floor(i / 20) * 2.3;
    const s = sampleGerstner(waves, x, z, 3.5);
    minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    worstLen = Math.max(worstLen, Math.abs(Math.hypot(s.nx, s.ny, s.nz) - 1));
  }
  console.log(`  高度范围 = [${minY.toFixed(3)}, ${maxY.toFixed(3)}] m`);
  console.log(`  法线 |n| 与 1 的最大偏差 = ${worstLen.toFixed(6)}`);
  assert(worstLen < 1e-5, '法线是单位向量 ✓');
  assert(maxY - minY > 0.05 && maxY - minY < 3.0, `总起伏 ${(maxY - minY).toFixed(2)}m 在合理范围`);
  assert(maxY > 0 && minY < 0, '有正有负（波峰波谷）');
}

console.log('=== ⑤ 淡出/淡入：某个波会被替换为新参数 ===');
{
  const waves = makeWaveSet(42, 8, OPTS);
  const before = waves.map((w) => w.wavelength);
  let replaced = false;
  for (let step = 0; step < 600; step++) {
    updateWaveSet(waves, 1 / 60, step / 60, 42, OPTS, 4, 0.5);
    const after = waves.map((w) => w.wavelength);
    for (let i = 0; i < waves.length; i++) {
      if (Math.abs(after[i] - before[i]) > 1e-6) { replaced = true; break; }
    }
    if (replaced) break;
  }
  console.log(`  10 秒内是否有波被替换: ${replaced}`);
  assert(replaced, '★ 淡出/淡入机制工作（波会被新参数替换）');
  // 权重都应在 [0,1]
  assert(waves.every((w) => w.weight >= 0 && w.weight <= 1), '权重在 [0,1]');
}

console.log('=== ⑥ 打包 uniform ===');
{
  const waves = makeWaveSet(7, 6, OPTS);
  const { a, b } = packWaves(waves);
  assert(a.length === 24 && b.length === 24, '6 波 × 2 × vec4');
  assert(Math.abs(a[3] - waves[0].amplitude) < 1e-6, 'A.w = 振幅（含权重，float32 精度）');
  assert(a[2] > 0, 'A.z = 波数 k（预计算）');
  assert(Math.abs(b[1] - angularFreq(waves[0].wavelength)) < 1e-5, 'B.y = ω（float32 精度）');
  assert(Math.abs(b[0] - waves[0].steepness) < 1e-5, 'B.x = 陡度');
  console.log('  ✓ uniform 布局：a=(dirX,dirZ,k,amp) b=(steep,omega,weight,0)');
}

console.log(fails === 0 ? '\n全部 PASS' : `\n${fails} 项 FAIL`);
process.exit(fails === 0 ? 0 : 1);

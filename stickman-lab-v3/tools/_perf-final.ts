/** _perf-final.ts —— 单点干净基准（单 World） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const hz = Number(process.env.HZ ?? '480');
const w = new World({ physicsHz: hz });
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
for (let i = 0; i < hz * 2; i++) w.advance(1);
const steps = hz * 4;
const t0 = performance.now();
for (let i = 0; i < steps; i++) w.advance(1);
const ms = performance.now() - t0;
const per = ms / steps;
console.log(`${hz}Hz 全控：${per.toFixed(3)} ms/步 | ${((ms / 4)).toFixed(0)} ms/仿真秒 | 实时 ${(1000 / (ms / 4) * 1).toFixed(2)}× | 60fps 每帧 ${(per * hz / 60).toFixed(1)} ms`);

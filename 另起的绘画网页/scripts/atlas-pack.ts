// ============================================================
// 图集打包命令行脚本（AI 可直接调用，无需开浏览器）
//
//   node scripts/atlas-pack.mjs --in <图片目录或文件…> --out <xxx.ftx3.gz>
//                              [--height 256] [--colors 254]
//                              [--no-crop] [--predict] [--no-verify]
//                              [--all] [--json] [--quiet] [--help]
//
// 做的事：
//   1. 读图（纯 JS PNG 解码，不依赖 canvas / Python）
//   2. 全体帧共享一个调色板，逐帧生成 regionIdTex / deltaPacked / blockFlags
//   3. 用项目自带 multiFrameExport.packMultiFrameToBinary 打成 FTX3 v3 多帧
//   4. gzip 落盘
//   5. 默认反查验证：用「游戏端」src/vendor/player/core/ftx.ts 的 decodeMultiFrame
//      解回来，按 renderer.ts 的 shader 公式重建 RGB，跟编码输入逐像素比 PSNR
//
// 帧名 = 源文件名（去掉扩展名），导出时原样写进 ftx3，游戏端按名取帧。
// ============================================================

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { basename, extname, join, resolve, dirname, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
import { packAtlas, prepareSources, type AtlasSourceFrame, type AtlasPackOptions } from './lib/atlasPacker';
import { decodePng } from './lib/png';
// ★ 游戏端权威解码器（原样 import，验收不靠自证）
import { decodeMultiFrame, buildBaseHslData, buildResidualData } from '../../全新的游戏/src/vendor/player/core/ftx';

const HELP = `图集打包器 —— 多张 PNG → 一个 FTX3 多帧包（.ftx3.gz）

用法:
  node scripts/atlas-pack.mjs --in <目录或文件…> --out <xxx.ftx3.gz> [选项]

选项:
  --in <path>      图片目录（读其中全部 *.png；自动跳过 _ 开头的预览图）
                   或直接给若干 png 文件路径；可重复出现
  --out <path>     输出 .ftx3.gz 路径（父目录不存在会自动创建）
  --height <n>     全体帧统一目标高度，宽度按各自原图比例自动算（默认 256；0 = 不缩放）
  --colors <n>     共享调色板颜色数，上限 254（默认 254）
  --no-crop        不裁到内容紧包围盒，保留整幅画布（组件间相对位置不丢）
  --predict        开启帧间预测（各帧尺寸必须一致，否则游戏端解码会错；默认关）
  --no-verify      跳过往返验证（验证需要 ../全新的游戏 存在）
  --all            连 _ 开头的文件也一起打包
  --json           只输出一行 JSON（给程序/AI 解析）
  --quiet          不打印帧表
  --help           显示本帮助

退出码: 0 成功 / 1 运行失败 / 2 参数错误
`;

interface Args {
  ins: string[];
  out: string;
  height: number;
  colors: number;
  crop: boolean;
  predict: boolean;
  verify: boolean;
  all: boolean;
  json: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    ins: [], out: '', height: 256, colors: 254,
    crop: true, predict: false, verify: true, all: false, json: false, quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`选项 ${arg} 缺少值`);
      return v;
    };
    switch (arg) {
      case '--in': a.ins.push(next()); break;
      case '--out': a.out = next(); break;
      case '--height': a.height = Number(next()); break;
      case '--colors': a.colors = Number(next()); break;
      case '--no-crop': a.crop = false; break;
      case '--predict': a.predict = true; break;
      case '--no-verify': a.verify = false; break;
      case '--all': a.all = true; break;
      case '--json': a.json = true; break;
      case '--quiet': a.quiet = true; break;
      case '-h': case '--help': throw new Error('__HELP__');
      default: throw new Error(`未知选项 ${arg}`);
    }
  }
  if (a.ins.length === 0) throw new Error('缺少 --in');
  if (!a.out) throw new Error('缺少 --out');
  if (!Number.isFinite(a.height) || a.height < 0) throw new Error('--height 必须是非负数');
  if (!Number.isFinite(a.colors) || a.colors < 2 || a.colors > 254) throw new Error('--colors 必须在 2~254');
  return a;
}

function collectFiles(a: Args): string[] {
  const files: string[] = [];
  for (const raw of a.ins) {
    const p = resolve(raw);
    const st = statSync(p); // 不存在会直接抛错，信息足够清楚
    if (st.isDirectory()) {
      for (const name of readdirSync(p)) {
        if (extname(name).toLowerCase() !== '.png') continue;
        if (!a.all && name.startsWith('_')) continue;
        files.push(join(p, name));
      }
    } else {
      if (extname(p).toLowerCase() !== '.png') {
        throw new Error(`${p} 不是 PNG。本脚本只解码 PNG（jpg 请先抠图导出成透明 PNG）`);
      }
      files.push(p);
    }
  }
  if (files.length === 0) throw new Error('没有找到任何 PNG');
  // 帧顺序 = 文件名排序 → 帧索引稳定可预期
  files.sort((x, y) => basename(x).localeCompare(basename(y), 'zh'));
  return files;
}

/** renderer.ts 片元着色器里的 hsl2rgb */
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === '__HELP__') { process.stdout.write(HELP); return 0; }
    process.stderr.write(`参数错误: ${msg}\n\n${HELP}`);
    return 2;
  }

  const opts: AtlasPackOptions = {
    targetHeight: args.height,
    paletteSize: args.colors,
    tightCrop: args.crop,
    enablePrediction: args.predict,
  };

  try {
    const files = collectFiles(args);

    // ---- 读图 ----
    const sources: AtlasSourceFrame[] = files.map((f) => {
      const img = decodePng(readFileSync(f));
      return { name: basename(f, extname(f)), image: img };
    });

    // ---- 打包 ----
    // packMultiFrameToBinary 里有一大段 blockFlags 调试日志，CLI 下属于噪音
    // （--json 模式下还会污染 stdout），这里静音掉。
    const t0 = Date.now();
    const realLog = console.log;
    console.log = () => {};
    let packed: ReturnType<typeof packAtlas>;
    try {
      packed = packAtlas(sources, opts);
    } finally {
      console.log = realLog;
    }
    const packMs = Date.now() - t0;

    const gz = gzipSync(Buffer.from(packed.binary.buffer, packed.binary.byteOffset, packed.binary.byteLength), { level: 9 });
    const outPath = isAbsolute(args.out) ? args.out : resolve(args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, gz);

    // ---- 往返验证（游戏端解码器）----
    let verify: {
      psnrTotal: number;
      psnrPerFrame: number[];
      maxChannelError: number;
      comparedPixels: number;
    } | null = null;

    if (args.verify) {
      const prepared = prepareSources(sources, opts);
      const raw = packed.binary;
      const decoded = decodeMultiFrame(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
      if (decoded.frames.length !== prepared.length) {
        throw new Error(`往返验证失败：解出 ${decoded.frames.length} 帧，输入 ${prepared.length} 帧`);
      }
      const perFrame: number[] = [];
      let se = 0, n = 0, maxErr = 0;
      for (let i = 0; i < decoded.frames.length; i++) {
        const f = decoded.frames[i];
        const base = buildBaseHslData(f, decoded.palette);
        const res = buildResidualData(f);
        if (!base || !res) throw new Error(`帧 ${f.name} 无法构建纹理`);
        const src = prepared[i].image;
        if (src.width !== base.width || src.height !== base.height) {
          throw new Error(`帧 ${f.name} 尺寸不一致：解码 ${base.width}x${base.height} vs 输入 ${src.width}x${src.height}`);
        }
        let fse = 0, fn = 0, fmax = 0;
        const N = base.width * base.height;
        for (let k = 0; k < N; k++) {
          if (base.data[k * 4 + 3] < 0.5) continue; // 透明像素不参与
          const qH = res.data[k * 4], qS = res.data[k * 4 + 1], qL = res.data[k * 4 + 2];
          const fh = ((base.data[k * 4] + (qH / 255 - 0.5)) % 1 + 1) % 1;
          const fs2 = Math.max(0, Math.min(1, base.data[k * 4 + 1] + (qS / 255 - 0.5)));
          const fl = Math.max(0, Math.min(1, base.data[k * 4 + 2] + (qL / 255 - 0.5)));
          const [r, g, b] = hsl2rgb(fh, fs2, fl);
          const e0 = r * 255 - src.data[k * 4];
          const e1 = g * 255 - src.data[k * 4 + 1];
          const e2 = b * 255 - src.data[k * 4 + 2];
          fse += e0 * e0 + e1 * e1 + e2 * e2;
          fn += 3;
          const m = Math.max(Math.abs(e0), Math.abs(e1), Math.abs(e2));
          if (m > fmax) fmax = m;
        }
        const mse = fn > 0 ? fse / fn : 0;
        perFrame.push(mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse));
        se += fse; n += fn;
        if (fmax > maxErr) maxErr = fmax;
      }
      const gMse = n > 0 ? se / n : 0;
      verify = {
        psnrTotal: gMse === 0 ? Infinity : 10 * Math.log10((255 * 255) / gMse),
        psnrPerFrame: perFrame,
        maxChannelError: maxErr,
        comparedPixels: n / 3,
      };
    }

    // ---- 输出 ----
    const report = {
      ok: true,
      out: outPath,
      frameCount: packed.frames.length,
      paletteCount: packed.palette.length,
      frameNames: packed.frames.map((f) => f.name),
      targetHeight: args.height,
      tightCrop: args.crop,
      prediction: args.predict,
      uncompressedBytes: packed.binary.length,
      gzipBytes: gz.length,
      compressionRatio: gz.length / packed.binary.length,
      packMs,
      clippedRatio: packed.clippedRatio,
      frames: packed.info.map((i) => ({
        name: i.name,
        source: `${i.sourceWidth}x${i.sourceHeight}`,
        output: `${i.width}x${i.height}`,
        opaqueRatio: i.opaqueRatio,
        narrowBlockRatio: i.narrowBlockRatio,
      })),
      verify: verify
        ? {
            psnrTotal: verify.psnrTotal,
            psnrMin: Math.min(...verify.psnrPerFrame),
            psnrMax: Math.max(...verify.psnrPerFrame),
            maxChannelError: verify.maxChannelError,
            comparedPixels: verify.comparedPixels,
          }
        : null,
    };

    if (args.json) {
      process.stdout.write(JSON.stringify(report) + '\n');
      return 0;
    }

    const lines: string[] = [];
    lines.push(`[图集打包] ${packed.frames.length} 帧 → ${outPath}`);
    if (!args.quiet) {
      lines.push('帧名'.padEnd(16) + '源尺寸'.padEnd(14) + '打包尺寸'.padEnd(13) + '不透明'.padStart(8) + '窄块'.padStart(7));
      for (const i of packed.info) {
        lines.push(
          i.name.padEnd(16)
          + `${i.sourceWidth}x${i.sourceHeight}`.padEnd(14)
          + `${i.width}x${i.height}`.padEnd(13)
          + `${(i.opaqueRatio * 100).toFixed(1)}%`.padStart(8)
          + `${(i.narrowBlockRatio * 100).toFixed(0)}%`.padStart(7),
        );
      }
    }
    lines.push(
      `调色板 ${packed.palette.length} 色 | 未压缩 ${(packed.binary.length / 1024).toFixed(0)} KB`
      + ` → gzip ${(gz.length / 1024).toFixed(0)} KB (${((gz.length / packed.binary.length) * 100).toFixed(1)}%)`
      + ` | 打包 ${packMs} ms | 残差满量程截断 ${(packed.clippedRatio * 100).toFixed(3)}%`,
    );
    if (verify) {
      lines.push(
        `[往返验证] 游戏端 decodeMultiFrame 还原 → PSNR 总 ${verify.psnrTotal.toFixed(2)} dB`
        + `（逐帧 ${Math.min(...verify.psnrPerFrame).toFixed(2)}~${Math.max(...verify.psnrPerFrame).toFixed(2)} dB`
        + `，最大通道误差 ${verify.maxChannelError.toFixed(0)}/255，比对 ${(verify.comparedPixels / 1000).toFixed(0)}k 像素）`,
      );
    } else {
      lines.push('[往返验证] 已跳过（--no-verify）');
    }
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    } else {
      process.stderr.write(`[图集打包] 失败: ${msg}\n`);
    }
    return 1;
  }
}

# -*- coding: utf-8 -*-
"""ftx_foot_measure —— 量 .ftx3.gz 帧素材的「脚底余量」（贴片接地体检）

用途：新素材进 `public/characters/enemies/` 之前/之后，先离线量出每个帧包的
      底部透明像素数，判断贴片会不会悬空。**不需要启动游戏**。

原理：FTX 的 `regionIdTex` 平面就是 alpha（0 = 透明，>0 = 不透明，见
      src/vendor/player/core/ftx.ts `buildBaseHslData`）。从最后一行往上扫，
      第一个有不透明像素的行 = 脚底；它到纹理底边的距离就是贴片会悬空的高度。

★ 世界下沉量换算：sink = 底透明px / bbox宽 × scale
  （quad 宽 = scale 世界单位对应 bbox.w 像素；高度是按宽高比撑出来的，
   所以用宽度归一化。运行时实现见 src/services/fx/FootAnchor.ts）

用法：
    python ftx_foot_measure.py <目录或文件> [--scale 2.0] [--scale-map json]
输出：每个包的 bbox、底部透明 px、比例、按 scale 换算的世界下沉量、quad 高度
"""
import gzip
import json
import os
import struct
import sys


def u32be(b, o): return struct.unpack_from('>I', b, o)[0]      # magic
def u32le(b, o): return struct.unpack_from('<I', b, o)[0]      # 长度字段（LE！）
def u16(b, o): return struct.unpack_from('<H', b, o)[0]


def _invert_delta8(src, stride):
    out = bytearray(len(src))
    for i, v in enumerate(src):
        out[i] = v if i % stride == 0 else (v + out[i - 1]) & 0xFF
    return out


def decode_frames(path):
    """→ [{name, fw, fh, bx, by, bw, bh, region(bytearray|None)}]"""
    raw = gzip.decompress(open(path, 'rb').read())
    o = 0
    if u32be(raw, o) != 0x46545833:
        raise ValueError('不是 FTX3 包')
    o += 4
    ver = raw[o]; o += 1
    if ver != 3:
        raise ValueError(f'不支持的 FTX 版本 {ver}')
    pred = raw[o] == 1; o += 1
    frame_count = u16(raw, o); o += 2
    pal_count = u16(raw, o); o += 2
    o += 12 * pal_count
    out = []
    prev = None
    for _ in range(frame_count):
        nlen = raw[o]; o += 1
        name = raw[o:o + nlen].decode('utf-8', 'replace'); o += nlen
        fw, fh = u16(raw, o), u16(raw, o + 2)
        bx, by, bw, bh = (u16(raw, o + 4), u16(raw, o + 6),
                          u16(raw, o + 8), u16(raw, o + 10))
        o += 12
        o += 8                       # blockFlags
        rlen = u32le(raw, o); o += 4
        region = None
        if rlen > 0:
            proc = _invert_delta8(raw[o:o + rlen], bw); o += rlen
            region = bytearray(len(proc))
            for i, v in enumerate(proc):
                region[i] = prev[i] if (pred and v == 1 and prev is not None) \
                    else (0 if v == 0 else v - 1)
            if pred:
                prev = region
        dlen = u32le(raw, o); o += 4
        if dlen > 0:
            o += dlen
        out.append(dict(name=name, fw=fw, fh=fh, bx=bx, by=by, bw=bw, bh=bh, region=region))
    return out


def content_span(region, bw, bh):
    """→ (top, bottom, left, right) 内容外接框行/列；全透明 → None"""
    top = bottom = left = right = None
    for y in range(bh):
        base = y * bw
        for x in range(bw):
            if region[base + x]:
                left = x if left is None else min(left, x)
                right = x if right is None else max(right, x)
                top = y if top is None else top
                bottom = y
    if top is None:
        return None
    return top, bottom, left, right


def measure(path, scale=1.0):
    """→ dict：bbox / 底透明px / 比例 / 世界下沉 / quad 高度 / 内容外接框"""
    frames = decode_frames(path)
    f0 = frames[0]
    span = content_span(f0['region'], f0['bw'], f0['bh']) if f0['region'] else None
    if span is None:
        return dict(file=os.path.basename(path), frames=len(frames), empty=True)
    top, bottom, left, right = span
    bot_pad = (f0['bh'] - 1) - bottom
    ratio = bot_pad / f0['bw']
    return dict(
        file=os.path.basename(path), frames=len(frames),
        fw=f0['fw'], fh=f0['fh'], bbox=(f0['bx'], f0['by'], f0['bw'], f0['bh']),
        bot_pad_px=bot_pad, top_pad_px=top, left_pad_px=left,
        right_pad_px=(f0['bw'] - 1) - right,
        ratio=ratio, world_sink=ratio * scale,
        quad_h=scale * f0['bh'] / f0['bw'],
    )


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    target = argv[1]
    scale = 1.0
    scale_map = {}
    for i, a in enumerate(argv):
        if a == '--scale' and i + 1 < len(argv):
            scale = float(argv[i + 1])
        if a == '--scale-map' and i + 1 < len(argv):
            scale_map = json.loads(open(argv[i + 1], encoding='utf-8').read())
    files = ([os.path.join(target, f) for f in sorted(os.listdir(target))
              if f.endswith('.ftx3.gz')] if os.path.isdir(target) else [target])
    print('%-32s %5s %5s | %-16s %8s %8s %9s %8s' %
          ('file', '帧数', 'sc', 'bbox(x,y,w,h)', '底透明px', '比例', '世界下沉', 'quad高'))
    print('-' * 108)
    bad = 0
    for p in files:
        sc = scale_map.get(os.path.basename(p), scale)
        m = measure(p, sc)
        if m.get('empty'):
            print('%-32s 空帧' % m['file']); bad += 1; continue
        if m['bot_pad_px'] > 0:
            bad += 1
        print('%-32s %5d %5.1f | %-16s %8d %8.4f %9.3f %8.3f' % (
            m['file'], m['frames'], sc, str(m['bbox']),
            m['bot_pad_px'], m['ratio'], m['world_sink'], m['quad_h']))
    print('-' * 108)
    print('底透明 > 0 的包：%d / %d（这些在纯"底部锚点"下会悬空；'
          '运行时由 FootAnchor 自动补偿）' % (bad, len(files)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

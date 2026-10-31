# -*- coding: utf-8 -*-
"""生成激光发射音效（两条随机变体，避免高频触发听腻）。
   1678：能量全在 0~0.25s，之后几乎静音 → 裁 0~0.45s
   1514：0.25~0.50s 才是主体（前 0.15s 是起音）→ 裁 0.15~0.70s
"""
import os, shutil, subprocess, tempfile, array, math

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
TMP = os.path.join(tempfile.gettempdir(), 'ship_raw')
SFX = r'C:\Users\22641\Desktop\架构重置\全新的游戏\public\sfx'


def run(args):
    r = subprocess.run([FF, '-y'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('FAIL\n', (r.stderr or '')[-1000:]); raise SystemExit(1)


def measure(path):
    r = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    rms = (sum(float(v) * v for v in a) / max(1, len(a))) ** 0.5 / 32768
    pk = max(abs(float(v)) for v in a) / 32768 if len(a) else 0.0
    return rms, pk, len(a) / 8000


def make(src_id, trim, out_name, target_peak=0.68):
    src = os.path.join(TMP, f'{src_id}.mp3')
    t1 = os.path.join(TMP, f'las_{src_id}_a.mp3')
    run(['-i', src, '-af',
         f'atrim={trim},asetpts=N/SR/TB,'
         f'afade=t=out:st=0:d=0.02:curve=exp,'   # 去掉起始爆音（若有）
         'treble=g=3:f=4000,'                     # 轻微提高频 = 科技感
         'areverse,afade=t=in:st=0:d=0.10,areverse',  # 尾端 0.10s 淡出（干净收尾）
         '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', t1])
    r0, pk0, _ = measure(t1)
    gain = target_peak / max(1e-6, pk0)
    t2 = os.path.join(TMP, f'las_{src_id}_b.mp3')
    run(['-i', t1, '-af', f'volume={gain:.4f}', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', t2])
    dst = os.path.join(SFX, out_name)
    shutil.move(t2, dst)
    r1, pk1, d1 = measure(dst)
    print(f'{out_name:<16} dur={d1:.2f}s  peak={pk1:.3f}  rms={r1:.4f}  {os.path.getsize(dst)/1024:.1f}KB')


make(1678, '0:0.45', '激光发射.mp3')
make(1514, '0.15:0.70', '激光发射2.mp3')

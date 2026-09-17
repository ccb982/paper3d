# -*- coding: utf-8 -*-
"""重做激光音（上一版被自己的 filter 坑了）：
   ✗ 错：`afade=t=out:st=0:d=0.02` —— fade-OUT 从 0s 起，0.02s 后**永久静音**，整段被压 31 倍
   ✓ 对：要淡出就写 st=<末尾时刻>，要淡入就写 t=in
"""
import os, shutil, subprocess, tempfile, array

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
TMP = os.path.join(tempfile.gettempdir(), 'ship_raw')
SFX = r'C:\Users\22641\Desktop\架构重置\全新的游戏\public\sfx'


def run(args):
    r = subprocess.run([FF, '-y'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('FAIL\n', (r.stderr or '')[-1200:]); raise SystemExit(1)


def measure(path):
    r = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    rms = (sum(float(v) * v for v in a) / max(1, len(a))) ** 0.5 / 32768
    pk = max(abs(float(v)) for v in a) / 32768 if len(a) else 0.0
    return rms, pk, len(a) / 8000


def build(src_id, a, b, out_name, target_peak=0.88):
    src = os.path.join(TMP, f'{src_id}.mp3')
    t1 = os.path.join(TMP, f'lz_{src_id}_1.mp3')
    run(['-i', src, '-af', f'atrim={a}:{b},asetpts=N/SR/TB',
         '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', t1])
    _, _, dur = measure(t1)
    fade = max(0.0, dur - 0.05)
    t2 = os.path.join(TMP, f'lz_{src_id}_2.mp3')
    run(['-i', t1, '-af',
         f'afade=t=out:st={fade:.3f}:d=0.05,'          # ★ 正确的尾端淡出
         'acompressor=threshold=0.15:ratio=3:attack=2:release=120:makeup=2',
         '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', t2])
    _, pk0, _ = measure(t2)
    gain = target_peak / max(1e-6, pk0)
    t3 = os.path.join(TMP, f'lz_{src_id}_3.mp3')
    run(['-i', t2, '-af', f'volume={gain:.4f}',
         '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', t3])
    dst = os.path.join(SFX, out_name)
    shutil.move(t3, dst)
    rms, pk, d = measure(dst)
    print(f'{out_name:<16} dur={d:.2f}s  RMS={rms:.4f}  peak={pk:.3f}  '
          f'{os.path.getsize(dst)/1024:.1f}KB   (击地 RMS=0.038 / 涉水 0.078 / 旧版 0.023)')
    return rms


build('1678', 0, 0.45, '激光发射.mp3')
build('1467', 0.19, 0.60, '激光发射2.mp3')

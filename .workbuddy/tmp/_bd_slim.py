# -*- coding: utf-8 -*-
"""把两张辅助图压成轻量 JPEG（预览用），重PNG移到项目 tmp 备份，不删除。"""
import os, shutil
from PIL import Image

UI = r'C:\Users\22641\Desktop\游戏素材\ui页面'
TRASH = r'C:\Users\22641\Desktop\架构重置\.workbuddy\tmp\bd_trash'
os.makedirs(TRASH, exist_ok=True)

for name in ['爆裂黎明_裁剪_接触表', '爆裂黎明_裁剪_上移档位对比']:
    src = os.path.join(UI, name + '.png')
    if not os.path.exists(src):
        print('跳过（不存在）:', src); continue
    im = Image.open(src).convert('RGB')
    im.thumbnail((1500, 1500), Image.LANCZOS)
    dst = os.path.join(UI, name + '.jpg')
    im.save(dst, quality=82, optimize=True)
    print('%-34s %8.0f KB -> %-32s %6.0f KB  %s' % (
        name + '.png', os.path.getsize(src) / 1024, name + '.jpg',
        os.path.getsize(dst) / 1024, im.size))
    shutil.move(src, os.path.join(TRASH, name + '.png'))
    print('   重PNG已移到备份:', os.path.join(TRASH, name + '.png'))

# 16 张裁剪帧也做一份轻量预览副本
SRC = os.path.join(UI, '爆裂黎明_按序', '裁剪')
PRE = os.path.join(UI, '爆裂黎明_按序', '预览')
if os.path.isdir(SRC):
    os.makedirs(PRE, exist_ok=True)
    tot = 0
    for f in sorted(os.listdir(SRC)):
        if not f.endswith('.png'):
            continue
        im = Image.open(os.path.join(SRC, f)).convert('RGB')
        im.thumbnail((700, 700), Image.LANCZOS)
        p = os.path.join(PRE, f.replace('.png', '.jpg'))
        im.save(p, quality=82, optimize=True)
        tot += os.path.getsize(p)
    print('\n预览副本 %d 张 -> %s  共 %.1f MB' % (len(os.listdir(PRE)), PRE, tot / 1048576))

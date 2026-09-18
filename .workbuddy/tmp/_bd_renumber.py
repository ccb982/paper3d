# -*- coding: utf-8 -*-
"""把用户人工排好序的 5.jpg..20.jpg 重新编号为 01.jpg..16.jpg，并写出映射表。"""
import os, json, shutil

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
ZIP_LIST = [
    ('0249917b88c434d861fc03749481a7c1', 'Screenshot_20260918_164444_com.hypergryph.arknights.jpg'),
    ('471527ab1ba312bcc5097ab6cc759d35', 'Screenshot_20260918_164459_com.hypergryph.arknights.jpg'),
    ('0c69912e8a9158da3a60a2c05d2c18e9', 'Screenshot_20260918_164507_com.hypergryph.arknights.jpg'),
    ('becc2fec443c586136595f478e6c2b01', 'Screenshot_20260918_164522_com.hypergryph.arknights.jpg'),
    ('f8a5ffaae5de282d5ef60c1652abd894', 'Screenshot_20260918_164639_com.hypergryph.arknights.jpg'),
    ('5504b7e247de78766910ea981d0fce1a', 'Screenshot_20260918_164646_com.hypergryph.arknights.jpg'),
    ('bbf10e4bba519318c3b8f4d4fa553b75', 'Screenshot_20260918_164650_com.hypergryph.arknights.jpg'),
    ('23bdbb028c6879c40adeab3976a38f6a', 'Screenshot_20260918_164657_com.hypergryph.arknights (1).jpg'),
    ('023032f7c01897d8339da20c61e38622', 'Screenshot_20260918_164657_com.hypergryph.arknights.jpg'),
    ('e6a03d765e760d832bd3319e439903b3', 'Screenshot_20260918_164759_com.hypergryph.arknights.jpg'),
    ('94df108a940fe491b41dcf94648fff08', 'Screenshot_20260918_164815_com.hypergryph.arknights.jpg'),
    ('97a4388e21ed5c8600d59619d12a9209', 'Screenshot_20260918_164822_com.hypergryph.arknights.jpg'),
    ('dd6828d83cfba16571f7d98b0ba9882c', 'Screenshot_20260918_164837_com.hypergryph.arknights.jpg'),
    ('1d27cfbdf07ec7dc30487b28c994e948', 'Screenshot_20260918_165024_com.hypergryph.arknights.jpg'),
    ('c1d347fe060a22daeaee89c2b910eb66', 'Screenshot_20260918_165039_com.hypergryph.arknights.jpg'),
    ('f813a227619aaebbda9f5cddd7988cb2', 'Screenshot_20260918_165047_com.hypergryph.arknights.jpg'),
    ('ece63f5882154d5192e29534e030a8c3', 'Screenshot_20260918_165101_com.hypergryph.arknights.jpg'),
    ('ef68bb1949673845ad317a116d8ab25c', 'Screenshot_20260918_165301_com.hypergryph.arknights.jpg'),
    ('831405f581205a2317e7145f083443f9', 'Screenshot_20260918_165317_com.hypergryph.arknights.jpg'),
    ('8a49fdc3fd34424ef5ee7a7b31aafd70', 'Screenshot_20260918_165325_com.hypergryph.arknights.jpg'),
    ('1fb6eeec90e571d2bd75fbd94ab5ef9b', 'Screenshot_20260918_165339_com.hypergryph.arknights.jpg'),
]
H2N = dict(ZIP_LIST)

import hashlib
files = [f for f in os.listdir(SRC) if f.lower().endswith('.jpg') and f[0].isdigit()]
# 用户编号 -> 文件名
def num(f):
    return int(os.path.splitext(f)[0])

files.sort(key=num)
print('用户排序（原编号）:', [num(f) for f in files])

mapping = []
for idx, f in enumerate(files, start=1):
    p = os.path.join(SRC, f)
    h = hashlib.md5(open(p, 'rb').read()).hexdigest()
    mapping.append({
        'seq': idx,
        'old': f,
        'new': '%02d.jpg' % idx,
        'origin': H2N.get(h, '?'),
        'md5': h,
    })

# 先全部改成临时名，避免冲突
for m in mapping:
    os.rename(os.path.join(SRC, m['old']), os.path.join(SRC, '_tmp_%02d' % m['seq']))
for m in mapping:
    os.rename(os.path.join(SRC, '_tmp_%02d' % m['seq']), os.path.join(SRC, m['new']))

used = set(m['md5'] for m in mapping)
missing = [n for h, n in ZIP_LIST if h not in used]
print('重命名完成:', len(mapping))
print('未纳入的原始帧:', missing)

json.dump({
    'order': '用户人工排序（特效 显现 -> 最盛 -> 淡化消散）',
    'frames': mapping,
    'dropped_originals': missing,
}, open(os.path.join(SRC, '排序映射.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('已写 排序映射.json')

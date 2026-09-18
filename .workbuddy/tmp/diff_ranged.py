import os, difflib

root = 'C:/Users/22641/Desktop/架构重置/全新的游戏/src'
bak = 'C:/Users/22641/Desktop/架构重置/.workbuddy/tmp/2026-09-18_ranged'
files = [
    'services/fx/SolidBulletAsset.ts',
    'services/combat/BulletManager.ts',
    'systems/ai/behaviors.ts',
    'systems/ai/aiconfig.ts',
    'modes/WorldMode.ts',
    'config/enemyRoster.ts',
]
for f in files:
    a = os.path.join(bak, f.replace('/', '__'))
    b = os.path.join(root, f)
    sa = open(a, encoding='utf-8').read().splitlines()
    sb = open(b, encoding='utf-8').read().splitlines()
    print('=' * 70)
    print(f, f'  +{len(sb)-len(sa)} lines')
    print('=' * 70)
    d = list(difflib.unified_diff(sa, sb, lineterm='', n=2))
    print('\n'.join(d) if d else '(no change)')

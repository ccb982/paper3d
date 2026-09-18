import os, shutil

root = 'C:/Users/22641/Desktop/架构重置/全新的游戏/src'
dst = 'C:/Users/22641/Desktop/架构重置/.workbuddy/tmp/2026-09-18_ranged_v2'
os.makedirs(dst, exist_ok=True)
for f in [
    'services/fx/SolidBulletAsset.ts',
    'services/combat/BulletManager.ts',
    'systems/ai/behaviors.ts',
    'systems/ai/aiconfig.ts',
    'modes/WorldMode.ts',
    'config/enemyRoster.ts',
]:
    src = os.path.join(root, f)
    out = os.path.join(dst, f.replace('/', '__'))
    shutil.copy2(src, out)
    print('backed', f, os.path.getsize(src))

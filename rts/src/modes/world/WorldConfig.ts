// ============================================================
// WorldConfig —— 大世界模式的常量 / 类型 / 纯工具（从 WorldMode 拆出）
// ============================================================
// 只放**不持有状态**的东西：模块常量、进入上下文类型、镜头姿态插值纯函数。
// 目的：给 WorldMode 上帝类减重，且保持"谁创建谁销毁"不变。
// ============================================================

import * as THREE from 'three';
import type { IGameModeContext } from '../../core/IGameMode';
import type { FtxAsset } from '../../vendor/player/FtxAsset';
import type { Asset } from '../../vendor/player';
import type { EnemyAssetEntry } from '../../config/enemyRoster';

/** ★ 友军物品 id：部署生成 / 损毁即彻底消失（不返还、不可维修） */
export const DRONE_ITEM = 'kaltsit_drone';
// ---- ★ 载具（逻各斯的圆凳）：移速 / 爬坡 / 过坑 ----
/** 主角基础移速（m/s）；装备移速加成（VehicleRide.moveSpeedMul）在此之上乘算 */
export const PLAYER_MOVE_SPEED = 5.0;
/** 过坑：贴地桥接采样半径（米）——脚下取邻域最高面，骑过坑洞不沉底 */
export const VEHICLE_BRIDGE_RADIUS = 1.6;
/** 爬坡上行速度（m/s；普通角色 7.5） */
export const VEHICLE_CLIMB_SPEED = 24;

/** ★ 玩家子弹伤害 = max(下限, 角色攻击力 × 系数)；遗物/装备加成的攻击力实时生效。
 *  （子弹 source = 子弹实体，attackPower 恒 0 → 管线只做减法防御，不会重复加攻击） */
export const PLAYER_BULLET_MIN_DAMAGE = 10;
export const PLAYER_BULLET_ATK_RATIO = 1.0;
/** ★ 主角基础攻击间隔（秒）：实际间隔 = 本值 × 100 / (100 + 攻击速度点数)（方舟攻速口径） */
export const PLAYER_ATTACK_INTERVAL = 0.9;
/** ★ 主角子弹飞行参数：速度（m/s）/ 寿命（s）→ 射程 = 速度 × 寿命 */
export const PLAYER_BULLET_SPEED = 50;
export const PLAYER_BULLET_LIFETIME = 3.0;
/** ★ 主角子弹轻微弹道修正（自瞄）：只修正准星小偏角内的敌人，幅度很小不影响甩枪手感 */
export const AIM_ASSIST_ANGLE = 0.05;    // 仅候选：偏角 ≤ ~2.9°
export const AIM_ASSIST_MAX = 0.03;      // 单发最多修正 ~1.7°
export const AIM_ASSIST_RANGE = 32;      // 只对 32m 内敌人生效（米）
export const AIM_ASSIST_STRENGTH = 0.6;  // 修正比例（0=不修，1=完全指向）
/** ★ 经典 TPS 枪口→准星收敛：准星射线无命中（对天/虚空）时，
 *  取相机射线上此距离处作为虚拟落点 → 子弹仍与准星共点（不会与相机平行"各飞各的"） */
export const CROSSHAIR_CONVERGE_DIST = 200;
/** ★ 可发射弹药 itemId（背包中有该类型即可在弹药栏切换；开火消耗 1） */
export const FIREABLE_AMMO = new Set<string>(['zuzong', 'cover', 'tumu_laojie']);
/** ★ 祖宗弹（专属投影物）：速度（m/s）/ 寿命（s） */
export const SENTINEL_SHOT_SPEED = 20;
export const SENTINEL_SHOT_LIFETIME = 3.0;
/** ★ 掩体弹（玩家遗物部署）：速度/寿命/同时存在上限 */
export const COVER_SHOT_SPEED = 18;
export const MAX_COVER_PLAYER = 6;
/** ★ 祖宗弹命中伤害 = max(下限, 主角攻击力 × 系数)，结算后立即落地生成祖宗 */
export const SENTINEL_IMPACT_MIN_DAMAGE = 8;
export const SENTINEL_IMPACT_ATK_RATIO = 0.8;
/** ★ 祖宗弹伤害 = max(下限, 主角攻击力 × 系数)（与无人机同口径：友军随主角强度） */
export const SENTINEL_MIN_DAMAGE = 8;
export const SENTINEL_ATK_RATIO = 1.0;
/** ★ 祖宗自动挖矿：索矿半径（米；无敌人时随机打铁/水/地面） */
export const SENTINEL_MINE_RANGE = 22;
/** ★ 留存祖宗唤醒：玩家接近半径（米；休眠祖宗进入 10m → 启用 + 入队友列表） */
export const SENTINEL_WAKE_R = 10;
/** 挖矿采样次数上限（每类） */
export const SENTINEL_MINE_SAMPLES = 16;
/** ★ 治疗转伤害（遥·幽隙栖萤）：累计治疗量 ≥ 该值才触发一次（避免每帧 1 点伤害刷屏/暴涨） */
export const HEAL_PROC_MIN_HEAL = 1.0;
// ★ 复活倒计时阶梯 / 血量保底已下沉 systems/player/PlayerPipeline.ts（架构 §7）

// ============================================================
// WorldMode 进入上下文（扩展 IGameModeContext）
// ============================================================

export interface WorldModeEnterContext extends IGameModeContext {
  day: number;
  protagonistAsset: FtxAsset;
  bulletAsset?: Asset | FtxAsset;
  /** ★ 敌军素材（id 对应 `config/enemyRoster.ts` 名册；地图大量随机生成用） */
  enemyAssets?: EnemyAssetEntry[];
  /** ★ 普瑞赛斯（Boss 战实体素材；scene.zip） */
  bossAsset?: FtxAsset | Asset;
  hitEffectAsset?: Asset;
  /** ★ 可露希尔的无人机素材（特效包优先，回退纯纹理包） */
  droneAsset?: Asset | FtxAsset;
  /** ★ 祖宗素材（站桩友军；缺省回退无人机素材） */
  sentinelAsset?: Asset | FtxAsset;
  /** ★ 采集物纹理图集（key → FTX 包，每包 4 帧；每株随机抽 1 帧静态显示） */
  plantAssets?: Record<string, FtxAsset>;
  /** ★ 调试开关（main.ts 从 URL 参数解析；素材填充测试用） */
  debug?: {
    testChunk?: boolean;
    enemyStress?: number;
  };
}

// ★ 镜头调度临时量（follow 每帧刷新目标机位，零分配）
export const _camMat = new THREE.Matrix4();
export const _camEye = new THREE.Vector3();
export const _camAt = new THREE.Vector3();
export const _camUp = new THREE.Vector3(0, 1, 0);
export const _arcV = new THREE.Vector3();

/** ★ 相机姿态插值（资料共识"绕注视点的球面弧"）：
 *  位置 = 相对 pivot 的球坐标 (r,θ,φ) 各分量插值（角度走最短路径）→ 折返弧线，
 *  不会直线穿过地形/目标；朝向独立 slerp。pivot 为空退化为线性。 */
export function interpCamPose(
  fromPos: THREE.Vector3, fromQuat: THREE.Quaternion,
  toPos: THREE.Vector3, toQuat: THREE.Quaternion,
  e: number, pivot: THREE.Vector3 | null,
  outPos: THREE.Vector3, outQuat: THREE.Quaternion,
): void {
  if (!pivot) {
    outPos.lerpVectors(fromPos, toPos, e);
  } else {
    const fv = _arcV.copy(fromPos).sub(pivot);
    const rF = Math.max(fv.length(), 1e-3);
    const thF = Math.atan2(fv.z, fv.x);
    const phF = Math.asin(Math.max(-1, Math.min(1, fv.y / rF)));
    const tv = _arcV.copy(toPos).sub(pivot);
    const rT = Math.max(tv.length(), 1e-3);
    const thT = Math.atan2(tv.z, tv.x);
    const phT = Math.asin(Math.max(-1, Math.min(1, tv.y / rT)));
    let dTh = thT - thF;
    while (dTh > Math.PI) dTh -= Math.PI * 2;
    while (dTh < -Math.PI) dTh += Math.PI * 2;
    const r = rF + (rT - rF) * e;
    const th = thF + dTh * e;
    const ph = phF + (phT - phF) * e;
    const cp = Math.cos(ph);
    outPos.set(
      pivot.x + r * cp * Math.cos(th),
      pivot.y + r * Math.sin(ph),
      pivot.z + r * cp * Math.sin(th),
    );
  }
  outQuat.slerpQuaternions(fromQuat, toQuat, e);
}

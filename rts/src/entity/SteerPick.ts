// ============================================================
// SteerPick —— 执行层移动方向选择（16 向 + hold；★ 禁止向量合成）
//   ★ 实测对比（用户定 2026-09-24，队#1 60s 质心路径）：16 向=71m（最好）/ 8 向=12m ✗
//     / 16 向+禁近反向=33m ✗ —— 故**保留 16 向原样**；"反复拉扯"不在候选数上。
// ============================================================
// 每决策拍：候选方向逐个打分 → softmax 抽样 → 选定后**承诺 0.3s**（到期才重选）。
//   打分特征：朝期望方向（路径/指令，cos 夹角）、表分（邻域地形价值）、人群惩罚（与分离反向）、掩体脚印惩罚；
//   硬否决：危险地形（墙/坑）——分离/避障**不产生方向**，只做惩罚与否决；水=正常地块（不否决）。
// 状态（承诺方向/到期）由调用方持有（复用 AgentPool.safeDirX/safeDirZ/hazardTimer）。
// 输出用模块单例对象（零分配热点路径）。
// ============================================================

/** 表只读接口（SwarmCommander 实现；避免 entity 层依赖） */
export interface SteerTable {
  scoreAt(x: number, z: number): number | null;
  /** ★ L3 兵种分（可选；重构 P1-2）：有则 8 向候选按该兵种打分，无则回退 scoreAt */
  scoreTypeAt?(type: string, x: number, z: number): number | null;
  /** ★ 水域查询（可选）：在水中时提高"上岸"方向的权重 */
  isWaterAt?(x: number, z: number): boolean;
  /** ★ 爬山/涉水基础方法（可选；TerrainAssist 消费）：坡梯度 / 直线可走 / 硬边界 / 掩体脚印 */
  slopeGradAt?(x: number, z: number): { gx: number; gz: number; mag: number };
  walkableLine?(ax: number, az: number, bx: number, bz: number): boolean;
  blockedAt?(x: number, z: number): boolean;
  coverAt?(x: number, z: number): boolean;
  heightAt?(x: number, z: number): number;
}

/** 取全局表桥（实体侧 TerrainAssist 用；未接入 → null） */
export function getSteerTable(): SteerTable | null {
  return globalTable;
}

export interface SteerOut {
  x: number;
  z: number;
  hold: boolean;
  /** 承诺到期时间（秒；0 = 未承诺） */
  until: number;
}

/** ★ 全局表桥（模式/引擎侧调用 setSteerTable；实体不依赖 systems，靠这个拿表分） */
let globalTable: SteerTable | null = null;
export function setSteerTable(t: SteerTable | null): void {
  globalTable = t;
}

/** 复用输出（零分配） */
export const steerOut: SteerOut = { x: 0, z: 0, hold: false, until: 0 };

/** ★ 探针（诊断用）：最近一次打分明细 */
export const steerScores = new Float32Array(16);
export const steerDbg = {
  desiredX: 0, desiredZ: 0, insideBlocked: false, heldValid: false,
  bestK: -1, pickK: -1, heldK: -1, any: false, ret: 'none' as 'pick' | 'commit' | 'hyst' | 'hold' | 'none',
};

/** 候选方向数（16 向） */
const DIR_N = 16;
/** softmax 温度（低 = 果断贪心，高 = 多样试探） */
const TEMP = 0.18;
/** 承诺窗（秒；选定后保持，防逐帧抖动） */
const COMMIT_S = 0.5;
/** ★ 转向惯性权重（与上一方向同向加分 → 抑制左右摆） */
const W_TURN = 0.7;
/** ★ 换向迟滞：新最优需高出这个倍率才换向 */
const SWITCH_MARGIN = 1.12;
/** 危险探测距离（米；与移动步长同量级） */
const PROBE = 1.6;
/** 期望方向权重（路径/指令） */
const W_PATH = 1.6;
/** 表分权重（地形价值：坡面/掩体/战壕/墙边） */
const W_TABLE = 0.8;
/** 人群惩罚权重（分离方向的反向偏好；不是合成） */
const W_AVOID = 1.0;
/** ★ 已在硬边界里时的逃离权重（优先选可走方向） */
const ESCAPE_W = 1.4;

/** ★ 掩体脚印惩罚（过掩体优化：优先绕行；沿路且对齐时仍可顶上去爬） */
const W_COVER = 1.2;
/** 表分归一（分数量级 ±6） */
const TABLE_NORM = 6;

const _scores = new Float32Array(DIR_N);
const _cx = new Float32Array(DIR_N);
const _cz = new Float32Array(DIR_N);

/**
 * 选一个移动方向（选完就走；不做加权平均）。
 * @param desiredX,Z 期望方向（流场/waypoint/指令；只作打分，不直接采用）
 * @param avoidX,Z   人群分离向量（只做"反向惩罚"，不参与合成；零向量 = 无）
 * @param heldX,Z    上次承诺方向；heldUntil 秒（到期/被否决则重选）
 * @param danger     硬否决（墙/坑/水/陡坡，由调用方给出）
 * @param table      表（null = 未就绪，只按期望方向走）
 * @param useTable   是否吃地面表分（空中层 false）
 * @param unitType   ★ 兵种（可选；有则走 scoreTypeAt，L3 兵种分）
 */
export function pickSteer(
  x: number, z: number,
  desiredX: number, desiredZ: number,
  avoidX: number, avoidZ: number,
  heldX: number, heldZ: number, heldUntil: number,
  now: number,
  insideBlocked: boolean,
  danger: (x: number, z: number) => boolean,
  table: SteerTable | null,
  useTable = true,
  unitType?: string,
): SteerOut {
  const tbl = useTable ? (table ?? globalTable) : null;
  const dl = Math.hypot(desiredX, desiredZ);
  const ux = dl > 1e-4 ? desiredX / dl : 0;
  const uz = dl > 1e-4 ? desiredZ / dl : 0;
  const al = Math.hypot(avoidX, avoidZ);
  const ax = al > 1e-4 ? avoidX / al : 0;
  const az = al > 1e-4 ? avoidZ / al : 0;
  const aMag = Math.min(1, al);

  // ★ 上一方向（承诺中且未被否决 → 作为转向惯性/迟滞基准）
  const heldValid = (heldX !== 0 || heldZ !== 0)
    && !danger(x + heldX * PROBE, z + heldZ * PROBE);

  let any = false;
  let sum = 0;
  let bestS = -Infinity;
  steerDbg.desiredX = desiredX; steerDbg.desiredZ = desiredZ;
  steerDbg.insideBlocked = insideBlocked; steerDbg.heldValid = heldValid;
  steerDbg.bestK = -1; steerDbg.pickK = -1; steerDbg.heldK = -1; steerDbg.ret = 'none';
  for (let k = 0; k < DIR_N; k++) {
    const a = (k / DIR_N) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    _cx[k] = cx; _cz[k] = cz;
    const bad = danger(x + cx * PROBE, z + cz * PROBE);
    // ★ 已在硬边界里（被推入/出生点）：不否决，改为"优先逃离到可走格"
    if (bad && !insideBlocked) { _scores[k] = -Infinity; continue; }
    let s = W_PATH * (cx * ux + cz * uz);
    if (insideBlocked) s += bad ? -ESCAPE_W : ESCAPE_W;
    if (tbl) {
      const ts = (unitType && tbl.scoreTypeAt)
        ? tbl.scoreTypeAt(unitType, x + cx * PROBE, z + cz * PROBE)
        : tbl.scoreAt(x + cx * PROBE, z + cz * PROBE);
      if (ts !== null) s += W_TABLE * Math.max(-1, Math.min(1, ts / TABLE_NORM));
      // ★ 过掩体优化：候选点落在掩体脚印 → 惩罚（优先绕行，不硬否）
      if (tbl.coverAt && tbl.coverAt(x + cx * PROBE, z + cz * PROBE)) s -= W_COVER;
    }
    if (aMag > 0.05) s -= W_AVOID * aMag * Math.max(0, cx * ax + cz * az);
    // ★ 转向惯性（同向加分）：**上帧方向被挡（heldValid=false）时也加**——否则左右两侧候选
    //   完全对称 → 每拍在"左绕/右绕"间翻面 = 集体转圈（用户 2026-09-24 报）
    if (heldX !== 0 || heldZ !== 0) s += W_TURN * (cx * heldX + cz * heldZ);
    _scores[k] = s;
    steerScores[k] = s;
    any = true;
    if (s > bestS) { bestS = s; steerDbg.bestK = k; }
    sum += Math.exp(s / TEMP);
  }
  if (!any) {
    steerOut.x = 0; steerOut.z = 0; steerOut.hold = true; steerOut.until = 0;
    steerDbg.ret = 'hold';
    return steerOut;
  }
  // ★ 承诺：未到期且承诺方向未被否决 → 保持（不再抽样）；在禁区里不承诺，立刻逃离
  // ★ 2026-09-24：承诺/迟滞**不保护与期望相反的方向**（否则"下令往西却一直承诺往东"——水/穿湖不动的元凶）
  const heldAlign = heldX * ux + heldZ * uz;
  if (!insideBlocked && heldValid && heldAlign > -0.2) {
    const hi = Math.round(
      (((Math.atan2(heldZ, heldX) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * DIR_N,
    ) % DIR_N;
    if (heldUntil > now) {
      steerOut.x = heldX; steerOut.z = heldZ; steerOut.hold = false; steerOut.until = heldUntil;
      steerDbg.ret = 'commit'; steerDbg.heldK = hi;
      return steerOut;
    }
    // ★ 迟滞：承诺到期后，旧方向只要不差（≥最佳/1.12）就续用 → 抑制左右摆
    const hs = _scores[hi];
    if (hs > -Infinity && hs * SWITCH_MARGIN >= bestS) {
      steerOut.x = _cx[hi]; steerOut.z = _cz[hi]; steerOut.hold = false;
      steerOut.until = now + COMMIT_S;
      steerDbg.ret = 'hyst'; steerDbg.heldK = hi;
      return steerOut;
    }
  }
  // ★ softmax 抽样（决策权重即概率）
  let r = Math.random() * sum;
  let pick = 0;
  for (let k = 0; k < DIR_N; k++) {
    const s = _scores[k];
    if (s === -Infinity) continue;
    pick = k;
    r -= Math.exp(s / TEMP);
    if (r <= 0) break;
  }
  steerOut.x = _cx[pick]; steerOut.z = _cz[pick];
  steerOut.hold = false; steerOut.until = now + COMMIT_S;
  steerDbg.ret = 'pick'; steerDbg.pickK = pick;
  return steerOut;
}

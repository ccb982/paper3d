// ============================================================
// SteerPick —— 执行层移动方向选择（16 向 + hold；★ 禁止向量合成）
// ============================================================
// 每决策拍：候选方向逐个打分 → softmax 抽样 → 选定后**承诺 0.3s**（到期才重选）。
//   打分特征：朝期望方向（路径/指令，cos 夹角）、表分（邻域地形价值）、人群惩罚（与分离反向）；
//   硬否决：危险地形（墙/坑/水）——分离/避障**不产生方向**，只做惩罚与否决。
// 状态（承诺方向/到期）由调用方持有（复用 AgentPool.safeDirX/safeDirZ/hazardTimer）。
// 输出用模块单例对象（零分配热点路径）。
// ============================================================

/** 表只读接口（SwarmCommander 实现；避免 entity 层依赖） */
export interface SteerTable {
  scoreAt(x: number, z: number): number | null;
  /** ★ 水域查询（可选）：在水中时提高"上岸"方向的权重 */
  isWaterAt?(x: number, z: number): boolean;
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
/** ★ 在水里时的"上岸"权重（允许站水里，只是更想上岸） */
const W_SHORE = 1.0;
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
): SteerOut {
  const tbl = table ?? globalTable;
  const dl = Math.hypot(desiredX, desiredZ);
  const ux = dl > 1e-4 ? desiredX / dl : 0;
  const uz = dl > 1e-4 ? desiredZ / dl : 0;
  const al = Math.hypot(avoidX, avoidZ);
  const ax = al > 1e-4 ? avoidX / al : 0;
  const az = al > 1e-4 ? avoidZ / al : 0;
  const aMag = Math.min(1, al);
  const inWater = tbl?.isWaterAt ? tbl.isWaterAt(x, z) : false;
  // ★ 上一方向（承诺中且未被否决 → 作为转向惯性/迟滞基准）
  const heldValid = (heldX !== 0 || heldZ !== 0)
    && !danger(x + heldX * PROBE, z + heldZ * PROBE);

  let any = false;
  let sum = 0;
  let bestS = -Infinity;
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
      const ts = tbl.scoreAt(x + cx * PROBE, z + cz * PROBE);
      if (ts !== null) s += W_TABLE * Math.max(-1, Math.min(1, ts / TABLE_NORM));
      // ★ 水中：往岸上走的权重（允许站水里，只是更想上岸）
      if (inWater && tbl.isWaterAt) {
        s += tbl.isWaterAt(x + cx * PROBE, z + cz * PROBE) ? -W_SHORE : W_SHORE;
      }
    }
    if (aMag > 0.05) s -= W_AVOID * aMag * Math.max(0, cx * ax + cz * az);
    if (heldValid) s += W_TURN * (cx * heldX + cz * heldZ);   // ★ 转向惯性（同向加分）
    _scores[k] = s;
    any = true;
    if (s > bestS) bestS = s;
    sum += Math.exp(s / TEMP);
  }
  if (!any) {
    steerOut.x = 0; steerOut.z = 0; steerOut.hold = true; steerOut.until = 0;
    return steerOut;
  }
  // ★ 承诺：未到期且承诺方向未被否决 → 保持（不再抽样）；在禁区里不承诺，立刻逃离
  if (!insideBlocked && heldValid) {
    if (heldUntil > now) {
      steerOut.x = heldX; steerOut.z = heldZ; steerOut.hold = false; steerOut.until = heldUntil;
      return steerOut;
    }
    // ★ 迟滞：承诺到期后，旧方向只要不差（≥最佳/1.12）就续用 → 抑制左右摆
    const hi = Math.round(
      (((Math.atan2(heldZ, heldX) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * DIR_N,
    ) % DIR_N;
    const hs = _scores[hi];
    if (hs > -Infinity && hs * SWITCH_MARGIN >= bestS) {
      steerOut.x = _cx[hi]; steerOut.z = _cz[hi]; steerOut.hold = false;
      steerOut.until = now + COMMIT_S;
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
  return steerOut;
}

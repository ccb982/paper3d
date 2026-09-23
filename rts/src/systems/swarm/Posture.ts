// ============================================================
// Posture —— 蜂群态势：档位定义 + 档位 × 部署表叠加（《敌人管线设计.md》§2）
// ============================================================
// 态势决定"给各编队发什么强度的命令"：
//   fortify（扎根：施工 + 守线）→ patrol（守成/游弋）→ advance（试探）
//   → mass（集结）→ assault（总攻）→ withdraw（撤退重组）
// ★ M2：态势**转移**已改由连续态势函数 PostureFn（p = schedule + provocation）负责；
//   本文件只保留档位类型与"档位如何改部署强度"（applyPosture）。
// 部署表（SquadDoctrine）描述"各兵种怎么打"，态势描述"这一阶段打到什么程度"。
// ============================================================

import type { SquadDoctrine } from './SquadDoctrine';

export type BattlePosture =
  | 'fortify'    // 开局：施工为主 + 守线巡逻（近战不追、飞行待命）
  | 'patrol'     // 守成：各守岗位、小范围巡逻
  | 'advance'    // 试探推进：近战按配置追击、远程前压
  | 'mass'       // 集结：各队向正面收拢
  | 'assault'    // 总攻：全部激进（近战冲锋、飞行轰炸、施工停止）
  | 'withdraw';  // 撤退：全线后撤重组

/** ★ 姿态权重（数值口径：这是态势的唯一"强度"表示；离散 mode 只是它的落点） */
export interface PostureWeights {
  /** 追击/进攻强度 0~1（≥0.5 允许追击） */
  chase: number;
  /** 火力强度 0~1（预留：命令禁火是把它压到 0） */
  fire: number;
  /** 前压强度 0~1（越高越往前/越激进） */
  advance: number;
  /** 掩体/结阵强度 0~1（越高越偏防御位；执行层读它选掩体） */
  cover: number;
}

export const POSTURE_WEIGHTS: Record<BattlePosture, PostureWeights> = {
  fortify:  { chase: 0.2, fire: 0.8, advance: 0.2, cover: 1.0 },
  patrol:   { chase: 0.3, fire: 0.9, advance: 0.4, cover: 0.8 },
  advance:  { chase: 0.9, fire: 1.0, advance: 0.8, cover: 0.4 },
  mass:     { chase: 0.4, fire: 1.0, advance: 0.7, cover: 0.6 },
  assault:  { chase: 1.0, fire: 1.0, advance: 1.0, cover: 0.2 },
  withdraw: { chase: 0.0, fire: 0.6, advance: 0.0, cover: 0.9 },
};

/** ★ 态势 × 部署表：态势只改"强度"（由数值权重派生），不改"兵种怎么打" */
export function applyPosture(d: SquadDoctrine, posture: BattlePosture): SquadDoctrine {
  const w = POSTURE_WEIGHTS[posture];
  const o: SquadDoctrine = { ...d };
  if (w.chase < 0.5 && o.mode !== 'build') o.chase = false;
  switch (posture) {
    case 'fortify':
    case 'mass':
      // 开局/集结：机动队收成守势（不追），施工/远程/后勤照配置
      if (o.mode === 'press' || o.mode === 'flank') o.mode = 'screen';
      break;
    case 'advance':
      break;   // 按各兵种配置（试探推进）
    case 'assault':
      // 总攻：盾队也压上；施工队转待命；远程保持驻守输出
      if (o.mode === 'build') o.mode = 'regroup';
      else if (o.mode === 'screen') { o.mode = 'press'; o.chase = true; }
      else if (o.mode === 'press' || o.mode === 'flank') o.chase = true;
      break;
    case 'withdraw':
      if (o.mode !== 'build') o.mode = 'regroup';
      break;
    case 'patrol':
      break;
  }
  return o;
}

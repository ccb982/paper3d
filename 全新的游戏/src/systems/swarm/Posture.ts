// ============================================================
// Posture —— 蜂群态势：档位定义 + 档位 × 部署表叠加（《蜂群引擎架构.md》§3）
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

/** ★ 态势 × 部署表：态势只改"强度"，不改"兵种怎么打" */
export function applyPosture(d: SquadDoctrine, posture: BattlePosture): SquadDoctrine {
  const o: SquadDoctrine = { ...d };
  switch (posture) {
    case 'fortify':
      // 开局：近战守线不追，飞行待命；施工/远程/后勤照配置
      if (o.mode === 'press' || o.mode === 'flank') o.mode = 'screen';
      if (o.mode !== 'build') o.chase = false;
      break;
    case 'patrol':
      if (o.mode !== 'build') o.chase = false;
      break;
    case 'advance':
      break;   // 按各兵种配置（试探推进）
    case 'mass':
      // 集结：机动队向正面收拢（不追），远程/后勤不动
      if (o.mode === 'press' || o.mode === 'flank') o.mode = 'screen';
      if (o.mode !== 'build') o.chase = false;
      break;
    case 'assault':
      // 总攻：盾队也压上；施工队转待命；远程保持驻守输出
      if (o.mode === 'build') o.mode = 'regroup';
      else if (o.mode === 'screen') { o.mode = 'press'; o.chase = true; }
      else if (o.mode === 'press' || o.mode === 'flank') o.chase = true;
      break;
    case 'withdraw':
      if (o.mode !== 'build') o.mode = 'regroup';
      o.chase = false;
      break;
  }
  return o;
}

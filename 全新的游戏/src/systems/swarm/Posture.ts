// ============================================================
// Posture —— 蜂群态势机（引擎内部变量；《蜂群架构.md》§13.2/§21）
// ============================================================
// 态势决定"给各编队发什么强度的命令"：
//   开局 fortify（造工事 + 巡逻守线）→ patrol（守成/游弋）
//   → advance（试探推进）→ mass（集结）→ assault（总攻：激进进攻）
//   → withdraw（损失过大：撤退重组）→ patrol
// 部署表（SquadDoctrine）描述"各兵种怎么打"，态势描述"这一阶段打到什么程度"；
// 两者在 resolveDoctrine 之后叠加（applyPosture）。
// ============================================================

import type { SquadDoctrine } from './SquadDoctrine';

export type BattlePosture =
  | 'fortify'    // 开局：施工为主 + 守线巡逻（近战不追、飞行待命）
  | 'patrol'     // 守成：各守岗位、小范围巡逻
  | 'advance'    // 试探推进：近战按配置追击、远程前压
  | 'mass'       // 集结：各队向正面收拢
  | 'assault'    // 总攻：全部激进（近战冲锋、飞行轰炸、施工停止）
  | 'withdraw';  // 撤退：全线后撤重组

export interface PostureInputs {
  /** 玩家距落点（米） */
  playerDist: number;
  /** 工事完成度 0~1 */
  builtRatio: number;
  /** 近期有接触（被击/警戒） */
  contact: boolean;
  /** 相对态势开始时的兵力比（<1 = 有损失） */
  aliveRatio: number;
}

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

/** ★ 态势机（低频更新；转移条件集中在此） */
export class PostureMachine {
  posture: BattlePosture = 'fortify';
  private since = 0;

  reset(): void {
    this.posture = 'fortify';
    this.since = 0;
  }

  set(p: BattlePosture, now: number): void {
    this.posture = p;
    this.since = now;
  }

  update(now: number, inp: PostureInputs): BattlePosture {
    if (this.since === 0) this.since = now;
    const t = now - this.since;
    switch (this.posture) {
      case 'fortify':
        // 工事大致完成（或守够 150s）→ 转入守成
        if (inp.builtRatio >= 0.8 || t > 150) this.set('patrol', now);
        break;
      case 'patrol':
        if (inp.contact || inp.playerDist < 70) this.set('advance', now);
        break;
      case 'advance':
        if (inp.playerDist < 45 || t > 25) this.set('mass', now);
        break;
      case 'mass':
        if (inp.playerDist < 30 || t > 15) this.set('assault', now);
        break;
      case 'assault':
        // 总攻损失过大（<40%）→ 撤退
        if (t > 8 && inp.aliveRatio < 0.4) this.set('withdraw', now);
        break;
      case 'withdraw':
        if (t > 30 || inp.playerDist > 120) this.set('patrol', now);
        break;
    }
    return this.posture;
  }
}

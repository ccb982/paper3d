export type ContactPhase = 'grip' | 'slip' | 'lost' | 'recover';

export interface ContactStateInput {
  contact: boolean;
  copInside: boolean;
  fz: number;
  fzMin: number;
  footGrip: boolean;
  poseStable: boolean;
}

export interface ContactState {
  phase: ContactPhase;
  safe: boolean;
  supportActive: boolean;
  postureHold: boolean;
  recoverActive: boolean;
  contact: boolean;
  copInside: boolean;
  fzOk: boolean;
  poseStable: boolean;
  since: number;
}

export function evalContactState(prev: ContactState | undefined, i: ContactStateInput, now: number): ContactState {
  const fzOk = i.fz >= Math.max(0, i.fzMin);
  const baseOk = i.contact && fzOk;
  let phase: ContactPhase;
  if (!i.contact || !fzOk) phase = prev?.safe ? 'lost' : 'recover';
  else if (!i.copInside || !i.footGrip || !i.poseStable) phase = 'slip';
  else phase = 'grip';
  const safe = phase === 'grip';
  const supportActive = phase === 'grip' || phase === 'slip';
  const postureHold = phase === 'slip';
  const recoverActive = phase === 'slip' || phase === 'lost' || phase === 'recover';
  const since = prev && prev.phase === phase ? prev.since : now;
  return { phase, safe, supportActive, postureHold, recoverActive, contact: i.contact, copInside: i.copInside, fzOk, poseStable: i.poseStable, since };
}

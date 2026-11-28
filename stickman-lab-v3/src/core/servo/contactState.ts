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
  const since = prev && prev.phase === phase ? prev.since : now;
  return { phase, safe, contact: i.contact, copInside: i.copInside, fzOk, poseStable: i.poseStable, since };
}

export interface SquatContact {
  side: 'l' | 'r';
  contact: boolean;
  x: number;
  y: number;
  z: number;
  fz: number;
  copX: number;
  copZ: number;
}

export interface SquatUpperLoad {
  mass: number;
  comX: number;
  comY: number;
  comZ: number;
}

export interface SquatFrame {
  q: Float64Array;
  qd: Float64Array;
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  contacts: SquatContact[];
  support: { minX: number; maxX: number; minZ: number; maxZ: number };
  upper: SquatUpperLoad;
}

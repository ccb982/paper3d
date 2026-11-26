import { sampleFootContact, type FootSensorReading } from './footContact';

export interface ContactRead {
  fc: FootSensorReading;
  active: boolean;
  copValid: boolean;
  copInside: boolean;
  copX: number;
  copZ: number;
  fz: number;
  footSpeed: number;
}

export interface GripOptions {
  fzMin: number;
  footSpeedMax?: number;
}

export function readContact(w: Parameters<typeof sampleFootContact>[0], side: 'l' | 'r', fzGate: number): ContactRead {
  const fc = sampleFootContact(w, side);
  return {
    fc,
    active: fc.contact || fc.loadValid || fc.fzHeld > fzGate,
    copValid: fc.copValid,
    copInside: fc.copInside,
    copX: fc.copX,
    copZ: fc.copZ,
    fz: fc.fzFiltered,
    footSpeed: fc.footSpeed,
  };
}

export function contactActiveFlat(r: ContactRead, flat: boolean): boolean {
  return flat && r.active;
}

export function gripOk(r: ContactRead, o: GripOptions): boolean {
  return r.active
    && r.fz >= Math.max(0, o.fzMin)
    && r.copValid
    && r.copInside
    && r.footSpeed <= Math.max(0.01, o.footSpeedMax ?? 0.15);
}

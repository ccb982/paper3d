import { sampleFootContact, type FootSensorReading } from './footContact';

export interface ContactRead {
  fc: FootSensorReading;
  active: boolean;
  copValid: boolean;
  copX: number;
  copZ: number;
}

export function readContact(w: Parameters<typeof sampleFootContact>[0], side: 'l' | 'r', fzGate: number): ContactRead {
  const fc = sampleFootContact(w, side);
  return {
    fc,
    active: fc.contact || fc.loadValid || fc.fzHeld > fzGate,
    copValid: fc.copValid,
    copX: fc.copX,
    copZ: fc.copZ,
  };
}

export function contactActiveFlat(r: ContactRead, flat: boolean): boolean {
  return flat && r.active;
}

export function contactGateOn(): boolean {
  return String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_CONTACT_STATE_GATE ?? '1') === '1';
}

export function contactSafe(side: 'l' | 'r'): boolean {
  if (!contactGateOn()) return true;
  const s = (globalThis as { __SQC_CONTACT_STATE?: Record<string, { safe?: boolean }> }).__SQC_CONTACT_STATE;
  return s ? s[side]?.safe !== false : true;
}

export function contactSupportActive(side: 'l' | 'r'): boolean {
  if (!contactGateOn()) return true;
  const s = (globalThis as { __SQC_CONTACT_STATE?: Record<string, { supportActive?: boolean }> }).__SQC_CONTACT_STATE;
  return s ? s[side]?.supportActive !== false : true;
}

export function contactPostureHold(side: 'l' | 'r'): boolean {
  if (!contactGateOn()) return false;
  const s = (globalThis as { __SQC_CONTACT_STATE?: Record<string, { postureHold?: boolean }> }).__SQC_CONTACT_STATE;
  return s ? s[side]?.postureHold === true : false;
}

export function contactRecoverActive(side: 'l' | 'r'): boolean {
  if (!contactGateOn()) return false;
  const s = (globalThis as { __SQC_CONTACT_STATE?: Record<string, { recoverActive?: boolean }> }).__SQC_CONTACT_STATE;
  return s ? s[side]?.recoverActive === true : false;
}

export function contactSafe(side: 'l' | 'r'): boolean {
  const on = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_CONTACT_STATE_GATE ?? '0') === '1';
  if (!on) return true;
  const s = (globalThis as { __SQC_CONTACT_STATE?: Record<string, { safe?: boolean }> }).__SQC_CONTACT_STATE;
  return s ? s[side]?.safe !== false : true;
}

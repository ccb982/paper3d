/**
 * env.ts —— **环境变量读取的统一入口**（本项目已因 `Number('')` 坑过 4 次）
 *
 * 病灶（四次的同一个）：
 *   `const v = Number(env[k] ?? ''); return Number.isFinite(v) && v >= 0 ? v : DEFAULT;`
 *   `Number('') === 0` 且 `isFinite(0) === true` ⇒ **未设时返回 0、默认值永远用不上**
 *   ⇒ 特性**静默失效**（`supportLeg` / `WAISTKFOLD` / `SAGF_TAU` / `PREM` 各一次）。
 *
 * ⇒ 一律走下面的入口；**不要再在业务文件里手写 `Number(...)`**。
 */

type ProcLike = { process?: { env?: Record<string, string> } };

/** 原始字符串（trim；未设返回 ''） */
export function envStr(key: string): string {
  return String(((globalThis as ProcLike).process?.env ?? {})[key] ?? '').trim();
}

/**
 * 数值读取。
 * @param def 默认值（**环境变量未设/空/非法时返回它**）
 * @param min 若给定，低于它则回退 `def`（不是夹到 min —— 夹值会静默改变语义）
 * @param max 同上，高于则回退 `def`
 */
export function envNum(key: string, def: number, min?: number, max?: number): number {
  const raw = envStr(key);
  if (raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  if (min !== undefined && v < min) return def;
  if (max !== undefined && v > max) return def;
  return v;
}

/** 布尔读取：`1/true/on` 为真、`0/false/off` 为假、其余回退 `def` */
export function envOn(key: string, def: boolean): boolean {
  const raw = envStr(key).toLowerCase();
  if (raw === '' || raw === undefined) return def;
  if (['1', 'true', 'on'].includes(raw)) return true;
  if (['0', 'false', 'off'].includes(raw)) return false;
  return def;
}

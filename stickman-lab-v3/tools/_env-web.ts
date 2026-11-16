import { WEB_DEFAULTS } from '../src/core/webDefaults';
for (const k of Object.keys(WEB_DEFAULTS)) if (process.env[k] === undefined) process.env[k] = WEB_DEFAULTS[k]!;
export {};

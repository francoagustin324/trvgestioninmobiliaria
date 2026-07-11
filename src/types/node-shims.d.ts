declare var process: any;
declare var Buffer: any;
declare module 'node:fs' { export const createReadStream: any; export const existsSync: any; export const statSync: any; }
declare module 'node:http' { export const createServer: any; }
declare module 'node:path' { export const extname: any; export const join: any; export const normalize: any; }
declare module 'node:url' { export const fileURLToPath: any; }
declare module 'node:net' { export const isIP: any; }
declare module 'node:dns/promises' { export const lookup: any; }
declare module 'node:test' { const test: any; export default test; }
declare module 'node:assert/strict' { const assert: any; export default assert; }

interface EventTarget { matches(selector: string): boolean; dataset: any; reset(): void; value: any; }
interface Element { dataset: any; elements: any; }

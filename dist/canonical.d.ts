export declare function canonicalJson(value: unknown): string;
export declare function sha256(value: string | Uint8Array): string;
export declare function domainHash(domain: string, value: string | Uint8Array): string;
export declare function hashObject(value: unknown): string;
export declare function isPlainRecord(value: unknown): value is Record<string, unknown>;
export declare function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean;

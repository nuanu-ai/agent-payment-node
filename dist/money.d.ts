export declare function parseAtomic(value: unknown, options?: {
    positive?: boolean;
}): bigint;
export declare function parseDecimal(value: unknown, decimals: number, options?: {
    positive?: boolean;
}): {
    atomic: string;
    decimal: string;
};
export declare function formatAtomic(value: string, decimals: number): string;
export declare function multiplyAtomic(a: string, b: string): string;

export declare function archiveReadInterval(raw: string | undefined): number;
/** One process shares request-start scheduling across both finite RPC clients. No retry ownership. */
export declare class CircleArchiveReadPacer {
    private readonly now;
    private readonly wait;
    private queue;
    private lastStart;
    constructor(now?: () => number, wait?: (milliseconds: number) => Promise<void>);
    start<T>(endpoint: string, method: string, interval: number, guard: () => void, request: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export declare const circleArchiveReadPacer: CircleArchiveReadPacer;

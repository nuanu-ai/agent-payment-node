/**
 * The helper process: one request on stdin, one answer on stdout. It never outlives the APN command that spawned it,
 * whose pid `parent` the bootstrap read first. Once that command is gone (it died after the spawn, and its operation
 * lock with it), the orphan is re-parented: every 100 ms the helper checks, and exits when its parent changed, and right
 * before a send is written the network policy checks again and refuses with nothing written. Nobody reads its answer
 * then; the command's own record of a send that started stays unknown, as it already was. A send whose request was
 * already written may still reach MetaMask; the send's deadline bounds every write either way.
 */
export declare function runHelper(parent: number): Promise<void>;

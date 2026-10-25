import type { WrappingSecretPort } from "../../src/macos-keychain.js";

/** In-memory wrapping secret shared by source-tree and installed-runtime Solana fixtures; it throws nothing. */
export class SolanaWrapping implements WrappingSecretPort {
  loads = 0; creates = 0; available = true;
  async load(): Promise<Buffer | null> { this.loads++; return this.available ? Buffer.alloc(32, 73) : null; }
  async create(): Promise<Buffer> { this.creates++; return Buffer.alloc(32, 73); }
}

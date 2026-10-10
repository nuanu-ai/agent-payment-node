/** Module-private capability: neither persisted records nor caller-shaped objects grant custody. */
export interface Cleanup86FirstDispatchGrant { readonly kind: "cleanup86-first-dispatch-grant"; }
export interface Cleanup86FirstDispatchBinding {
  readonly root: string; readonly operationId: string; readonly intentHash: string;
  readonly recoveryId: string; readonly envelopeHash: string;
  readonly transactionHash: string; readonly materialHash: string;
}

// Assertions only: the trusted consent controller owns every capability and its issuer.
export { assertCleanup86FirstDispatchGrant, assertCleanup86FirstDispatchJournalBinding } from "./cleanup86-first-dispatch-controller.js";

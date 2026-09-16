/** Legacy port-based entry is intentionally non-executable: caller-supplied proof cannot admit a live effect. */
import { bridgeFailure } from "./validation.js";

export async function submitCircleV2BaseSourceBurn(..._untrustedInputs: unknown[]): Promise<never> {
  return bridgeFailure("APN_OPERATION_BLOCKED", "circle_v2_source_execution_untrusted_ports");
}

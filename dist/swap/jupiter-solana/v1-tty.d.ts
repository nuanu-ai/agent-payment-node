import type { GuardedSwapApprovalIntent } from "../runtime.js";
import type { JupiterV1PreparedMaterial, JupiterV1ResolvedMaterial } from "./v1-material.js";
/** `fresh` is the approval's re-resolved material: the quoted message with the lifetime this approval froze, the one signed. */
export declare function jupiterV1ApprovalScreen(material: JupiterV1PreparedMaterial, intent: GuardedSwapApprovalIntent, fresh: JupiterV1ResolvedMaterial): Promise<readonly string[]>;

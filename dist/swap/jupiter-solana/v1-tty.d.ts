import type { GuardedSwapApprovalIntent } from "../runtime.js";
import type { JupiterV1PreparedMaterial } from "./v1-material.js";
export declare function jupiterV1ApprovalScreen(material: JupiterV1PreparedMaterial, intent: GuardedSwapApprovalIntent): Promise<readonly string[]>;

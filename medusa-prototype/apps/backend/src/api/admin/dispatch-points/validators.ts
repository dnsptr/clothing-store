import { z } from "@medusajs/framework/zod";
import { handoffRegistrySchema } from "../../../lib/carrier-handoff";

export const UpdateHandoffRegistrySchema = z.object({ registry: handoffRegistrySchema }).strict();
export type UpdateHandoffRegistry = z.infer<typeof UpdateHandoffRegistrySchema>;

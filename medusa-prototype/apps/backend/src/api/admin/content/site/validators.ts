import { z } from "@medusajs/framework/zod"

const revision = z.number().int().nonnegative()
export const SiteEditorCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), revision, content: z.unknown() }).strict(),
  z.object({ action: z.literal("publish"), revision }).strict(),
  z.object({ action: z.literal("restore"), revision, publicationId: z.string().uuid() }).strict(),
])

import { z } from "zod";

export const ManualReviewActionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type ManualReviewActionInput = z.infer<typeof ManualReviewActionSchema>;

export const ManualReviewListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  limit: z.coerce.number().int().min(1).transform((value) => Math.min(value, 100)).default(25),
});

export type ManualReviewListQuery = z.infer<typeof ManualReviewListQuerySchema>;


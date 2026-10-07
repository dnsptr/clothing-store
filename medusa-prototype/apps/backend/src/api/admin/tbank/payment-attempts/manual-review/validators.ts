import { z } from "zod";

/** A stale browser tab must never act on a newer quarantine of the same attempt. */
export const PollReviewActionSchema = z.object({
  reason: z.string().trim().min(1).max(1_000),
  expectedReviewAt: z.iso.datetime({ offset: true }).transform((timestamp) => new Date(timestamp)),
}).strict();

export type PollReviewActionInput = z.infer<typeof PollReviewActionSchema>;

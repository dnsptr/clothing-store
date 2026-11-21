import { z } from "@medusajs/framework/zod";

const SelectionSchema = z.object({
  line_index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // Keep scanner payloads intact, including the DataMatrix group separator.
  mark_codes: z.array(z.string().min(1).max(2048)).min(1).optional(),
}).strict().superRefine((item, ctx) => {
  if (item.mark_codes && item.mark_codes.length !== item.quantity) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mark_codes"], message: "Provide one actual marking code per unit" });
  }
});

const ItemsSchema = z.array(SelectionSchema).min(1).superRefine((items, ctx) => {
  const rows = new Set<number>();
  const codes = new Set<string>();
  items.forEach((item, index) => {
    if (rows.has(item.line_index)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "line_index"], message: "Duplicate receipt row" });
    }
    rows.add(item.line_index);
    item.mark_codes?.forEach((code) => {
      if (codes.has(code)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "mark_codes"], message: "Duplicate marking code" });
      }
      codes.add(code);
    });
  });
});

const IdempotencyKeySchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/);

export const TbankRefundSchema = z.object({
  idempotency_key: IdempotencyKeySchema,
  items: ItemsSchema,
  receipt_mode: z.enum(["prepayment", "full_payment"]),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

export const TbankClosingReceiptSchema = z.object({
  idempotency_key: IdempotencyKeySchema,
  items: ItemsSchema,
}).strict();

export type TbankRefundInput = z.infer<typeof TbankRefundSchema>;
export type TbankClosingReceiptInput = z.infer<typeof TbankClosingReceiptSchema>;

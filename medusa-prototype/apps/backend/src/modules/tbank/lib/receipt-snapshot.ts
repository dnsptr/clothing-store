import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { MedusaError } from "@medusajs/framework/utils";
import { z } from "zod";

import type { TBankReceipt } from "./receipt";

const RECEIPT_SCHEMA = z.object({
  Taxation: z.literal("usn_income"),
  Items: z.array(z.object({
    Name: z.string(),
    Price: z.number(),
    Quantity: z.number(),
    Amount: z.number(),
    Tax: z.literal("vat105"),
    PaymentMethod: z.literal("full_prepayment"),
    PaymentObject: z.enum(["commodity", "service"]),
    MeasurementUnit: z.literal("шт"),
  })),
}).and(z.union([
  z.object({ Email: z.string(), Phone: z.string().optional() }),
  z.object({ Email: z.string().optional(), Phone: z.string() }),
]));

export type ReceiptCartLine = {
  readonly id: string;
  readonly quantity: number;
};

type ReceiptSnapshotPayload = {
  readonly sessionId: string;
  readonly cartId: string;
  readonly cartLines: readonly ReceiptCartLine[];
  readonly receipt: TBankReceipt;
};

type ReceiptSnapshot = {
  readonly payload: ReceiptSnapshotPayload;
  readonly signature: string;
};

const SNAPSHOT_SCHEMA = z.object({
  payload: z.object({
    sessionId: z.string(),
    cartId: z.string(),
    cartLines: z.array(z.object({
      id: z.string().min(1),
      quantity: z.number().int().positive(),
    })),
    receipt: RECEIPT_SCHEMA,
  }),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export function isStrongReceiptSnapshotSecret(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length >= 32 && decoded.toString("base64") === value && new Set(decoded).size >= 16;
}

export class ReceiptSnapshotCodec {
  private readonly hmacKey: Buffer;
  private readonly encryptionKey: Buffer;

  constructor(secret: string) {
    this.hmacKey = Buffer.from(secret, "base64");
    this.encryptionKey = createHash("sha256")
      .update("tbank-receipt-snapshot-encryption\0")
      .update(this.hmacKey)
      .digest();
  }

  private signature(payload: ReceiptSnapshotPayload): string {
    const canonical = JSON.stringify({
      sessionId: payload.sessionId,
      cartId: payload.cartId,
      cartLines: payload.cartLines.map((line) => ({ id: line.id, quantity: line.quantity })),
      receipt: {
        Email: payload.receipt.Email ?? null,
        Phone: payload.receipt.Phone ?? null,
        Taxation: payload.receipt.Taxation,
        Items: payload.receipt.Items.map((item) => ({
          Name: item.Name,
          Price: item.Price,
          Quantity: item.Quantity,
          Amount: item.Amount,
          Tax: item.Tax,
          PaymentMethod: item.PaymentMethod,
          PaymentObject: item.PaymentObject,
          MeasurementUnit: item.MeasurementUnit,
        })),
      },
    });
    return createHmac("sha256", this.hmacKey).update(canonical).digest("hex");
  }

  seal(payload: ReceiptSnapshotPayload): string {
    const plaintext = JSON.stringify({ payload, signature: this.signature(payload) });
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, initializationVector);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
      "v2",
      initializationVector.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  open(envelope: string): ReceiptSnapshot {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = envelope.split(".");
    if (version !== "v2" || !encodedIv || !encodedTag || !encodedCiphertext || extra) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: сохранённый чек недействителен");
    }
    try {
      const initializationVector = Buffer.from(encodedIv, "base64url");
      const authenticationTag = Buffer.from(encodedTag, "base64url");
      const ciphertext = Buffer.from(encodedCiphertext, "base64url");
      if (initializationVector.length !== 12 || authenticationTag.length !== 16 || ciphertext.length === 0) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: сохранённый чек недействителен");
      }
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, initializationVector);
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      const snapshot = SNAPSHOT_SCHEMA.parse(JSON.parse(plaintext));
      const expected = Buffer.from(this.signature(snapshot.payload), "hex");
      if (!timingSafeEqual(expected, Buffer.from(snapshot.signature, "hex"))) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: сохранённый чек недействителен");
      }
      return snapshot;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: сохранённый чек недействителен");
    }
  }
}

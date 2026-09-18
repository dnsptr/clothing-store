import { createHmac, timingSafeEqual } from "node:crypto";

import { MedusaError } from "@medusajs/framework/utils";

import { buildReceipt, receiptAmount, type ReceiptCart, type TBankReceipt } from "./receipt";

export type ReceiptQuery = {
  graph<TData>(input: {
    readonly entity: string;
    readonly fields: readonly string[];
    readonly filters: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly data: readonly TData[] }>;
};

type ReceiptRequest = {
  readonly sessionId: string;
  readonly existingReceipt?: TBankReceipt;
  readonly existingSignature?: string;
  readonly paymentAmountKopecks: number;
};

export type ReceiptResolution = {
  readonly cartId: string;
  readonly receipt: TBankReceipt;
  readonly receiptSignature: string;
};

type PaymentSessionLink = {
  readonly id?: string;
  readonly payment_collection_id?: string;
};

type CartPaymentCollectionLink = {
  readonly cart_id?: string;
  readonly payment_collection_id?: string;
};

const CART_FIELDS = [
  "id",
  "email",
  "shipping_address.phone",
  "total",
  "subtotal",
  "discount_total",
  "shipping_total",
  "items.id",
  "items.title",
  "items.product_title",
  "items.variant_title",
  "items.quantity",
  "items.unit_price",
  "items.subtotal",
  "items.discount_total",
  "items.total",
  "items.adjustments.amount",
] as const;

export class TBankReceiptSource {
  constructor(
    private readonly query: ReceiptQuery,
    private readonly snapshotSecret: string,
  ) {}

  private signature(receipt: TBankReceipt): string {
    const canonical = JSON.stringify({
      Email: receipt.Email ?? null,
      Phone: receipt.Phone ?? null,
      Taxation: receipt.Taxation,
      Items: receipt.Items.map((item) => ({
        Name: item.Name,
        Price: item.Price,
        Quantity: item.Quantity,
        Amount: item.Amount,
        Tax: item.Tax,
        PaymentMethod: item.PaymentMethod,
        PaymentObject: item.PaymentObject,
        MeasurementUnit: item.MeasurementUnit,
      })),
    });
    return createHmac("sha256", this.snapshotSecret).update(canonical).digest("hex");
  }

  private hasValidSignature(receipt: TBankReceipt, signature: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(signature)) return false;
    return timingSafeEqual(
      Buffer.from(this.signature(receipt), "hex"),
      Buffer.from(signature, "hex"),
    );
  }

  private async cartIdForSession(sessionId: string): Promise<string> {
    const sessions = await this.query.graph<PaymentSessionLink>({
      entity: "payment_session",
      fields: ["id", "payment_collection_id"],
      filters: { id: sessionId },
    });
    const matchingSessions = sessions.data.filter(
      (session) => session.id === sessionId && typeof session.payment_collection_id === "string",
    );
    if (matchingSessions.length !== 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: однозначная связь платёжной сессии с коллекцией не найдена",
      );
    }
    const paymentCollectionId = matchingSessions[0]?.payment_collection_id;
    if (!paymentCollectionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: однозначная связь платёжной сессии с коллекцией не найдена",
      );
    }

    const links = await this.query.graph<CartPaymentCollectionLink>({
      entity: "cart_payment_collection",
      fields: ["cart_id", "payment_collection_id"],
      filters: { payment_collection_id: paymentCollectionId },
    });
    const matchingLinks = links.data.filter(
      (link) =>
        link.payment_collection_id === paymentCollectionId && typeof link.cart_id === "string",
    );
    if (matchingLinks.length !== 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: однозначная связь платёжной коллекции с корзиной не найдена",
      );
    }
    const cartId = matchingLinks[0]?.cart_id;
    if (!cartId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: однозначная связь платёжной коллекции с корзиной не найдена",
      );
    }
    return cartId;
  }

  async resolve(request: ReceiptRequest): Promise<ReceiptResolution> {
    const cartId = await this.cartIdForSession(request.sessionId);
    if (request.existingReceipt) {
      const existingSignature = request.existingSignature;
      if (!existingSignature || !this.hasValidSignature(request.existingReceipt, existingSignature)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "tbank: подпись сохранённого чека недействительна",
        );
      }
      if (receiptAmount(request.existingReceipt) !== request.paymentAmountKopecks) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "tbank: сумма сохранённого чека не совпадает с суммой платежа",
        );
      }
      return {
        cartId,
        receipt: request.existingReceipt,
        receiptSignature: existingSignature,
      };
    }

    const carts = await this.query.graph<ReceiptCart>({
      entity: "cart",
      fields: CART_FIELDS,
      filters: { id: cartId },
    });
    const matchingCarts = carts.data.filter((candidate) => candidate.id === cartId);
    if (matchingCarts.length !== 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: однозначная корзина для построения чека не найдена",
      );
    }
    const cart = matchingCarts[0];
    if (!cart) throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: корзина не найдена");
    const receipt = buildReceipt(cart, request.paymentAmountKopecks);
    return {
      cartId,
      receipt,
      receiptSignature: this.signature(receipt),
    };
  }
}

import { MedusaError } from "@medusajs/framework/utils";

import { buildReceipt, receiptAmount, type ReceiptCart, type TBankReceipt } from "./receipt";
import { ReceiptSnapshotCodec, type ReceiptCartLine } from "./receipt-snapshot";

export type ReceiptQuery = {
  graph<TData>(input: {
    readonly entity: string;
    readonly fields: readonly string[];
    readonly filters: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly data: readonly TData[] }>;
};

type ReceiptRequest = {
  readonly sessionId: string;
  readonly existingSnapshotEnvelope?: string;
  readonly paymentAmountKopecks: number;
};

export type ReceiptResolution = {
  readonly cartId: string;
  readonly receipt: TBankReceipt;
  readonly snapshotEnvelope: string;
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
  "shipping_methods.amount",
  "shipping_methods.is_tax_inclusive",
  "shipping_methods.tax_lines.rate",
  "shipping_methods.adjustments.amount",
  "items.id",
  "items.title",
  "items.product_title",
  "items.variant_title",
  "items.quantity",
  "items.unit_price",
  "items.is_tax_inclusive",
  "items.tax_lines.rate",
  "items.subtotal",
  "items.discount_total",
  "items.total",
  "items.adjustments.amount",
  "items.adjustments.is_tax_inclusive",
] as const;

function sameFiscalReceipt(left: TBankReceipt, right: TBankReceipt): boolean {
  return left.Email === right.Email &&
    left.Phone === right.Phone &&
    left.Taxation === right.Taxation &&
    left.Items.length === right.Items.length &&
    left.Items.every((item, index) => {
      const current = right.Items[index];
      return current !== undefined &&
        item.Name === current.Name &&
        item.Price === current.Price &&
        item.Quantity === current.Quantity &&
        item.Amount === current.Amount &&
        item.Tax === current.Tax &&
        item.PaymentMethod === current.PaymentMethod &&
        item.PaymentObject === current.PaymentObject &&
        item.MeasurementUnit === current.MeasurementUnit;
    });
}

function sameCartLines(left: readonly ReceiptCartLine[], right: readonly ReceiptCartLine[]): boolean {
  return left.length === right.length && left.every((line, index) =>
    line.id === right[index]?.id && line.quantity === right[index]?.quantity);
}

export class TBankReceiptSource {
  private readonly snapshotCodec: ReceiptSnapshotCodec;

  constructor(
    private readonly query: ReceiptQuery,
    snapshotSecret: string,
  ) {
    this.snapshotCodec = new ReceiptSnapshotCodec(snapshotSecret);
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

  signedReceiptAmount(envelope: string, sessionId: string, cartId: string): number {
    const snapshot = this.snapshotCodec.open(envelope);
    if (snapshot.payload.sessionId !== sessionId || snapshot.payload.cartId !== cartId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: сохранённый чек относится к другой сессии или корзине",
      );
    }
    return receiptAmount(snapshot.payload.receipt);
  }

  async resolve(request: ReceiptRequest): Promise<ReceiptResolution> {
    const cartId = await this.cartIdForSession(request.sessionId);
    if (request.existingSnapshotEnvelope) {
      const snapshot = this.snapshotCodec.open(request.existingSnapshotEnvelope);
      if (snapshot.payload.sessionId !== request.sessionId || snapshot.payload.cartId !== cartId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "tbank: сохранённый чек относится к другой сессии или корзине",
        );
      }
      if (receiptAmount(snapshot.payload.receipt) !== request.paymentAmountKopecks) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "tbank: сумма сохранённого чека не совпадает с суммой платежа",
        );
      }
      const current = await this.receiptForCart(cartId, request.paymentAmountKopecks);
      if (!sameFiscalReceipt(snapshot.payload.receipt, current.receipt) ||
        !sameCartLines(snapshot.payload.cartLines, current.cartLines)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "tbank: фискальный состав корзины изменился после сохранения чека",
        );
      }
      return {
        cartId,
        receipt: snapshot.payload.receipt,
        snapshotEnvelope: request.existingSnapshotEnvelope,
      };
    }

    const { receipt, cartLines } = await this.receiptForCart(cartId, request.paymentAmountKopecks);
    return {
      cartId,
      receipt,
      snapshotEnvelope: this.snapshotCodec.seal({ sessionId: request.sessionId, cartId, cartLines, receipt }),
    };
  }

  private async receiptForCart(
    cartId: string,
    paymentAmountKopecks: number,
  ): Promise<{ receipt: TBankReceipt; cartLines: ReceiptCartLine[] }> {
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
    const receipt = buildReceipt(cart, paymentAmountKopecks);
    const cartLines = (cart.items ?? [])
      .map(({ id, quantity }) => ({ id, quantity }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return { receipt, cartLines };
  }
}

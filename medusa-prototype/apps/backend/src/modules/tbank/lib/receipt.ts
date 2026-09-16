import type { BigNumberInput } from "@medusajs/types";

import { rublesToKopecks } from "./money";
import { buildReceiptName } from "./receipt-name";

export type TBankReceiptItem = {
  readonly Name: string;
  readonly Price: number;
  readonly Quantity: number;
  readonly Amount: number;
  readonly Tax: "vat105";
  readonly PaymentMethod: "full_prepayment";
  readonly PaymentObject: "commodity" | "service";
  readonly MeasurementUnit: "шт";
};

type TBankReceiptContact =
  | { readonly Email: string; readonly Phone?: string }
  | { readonly Email?: string; readonly Phone: string };

export type TBankReceipt = TBankReceiptContact & {
  readonly Taxation: "usn_income";
  readonly Items: readonly TBankReceiptItem[];
};

export type ReceiptCartItem = {
  readonly id: string;
  readonly product_title?: string | null;
  readonly title?: string | null;
  readonly variant_title?: string | null;
  readonly quantity: number;
  readonly total: BigNumberInput;
};

export type ReceiptCart = {
  readonly id: string;
  readonly email?: string | null;
  readonly shipping_address?: { readonly phone?: string | null } | null;
  readonly items?: readonly ReceiptCartItem[] | null;
  readonly shipping_total: BigNumberInput;
  readonly total: BigNumberInput;
};

export class ReceiptBuildError extends Error {
  readonly name = "ReceiptBuildError";

  constructor(readonly code: "amount" | "contact" | "items" | "quantity" | "reconciliation") {
    const messages = {
      amount: "tbank: цена и сумма позиции чека должны быть положительными",
      contact: "tbank: в корзине отсутствует допустимый контакт для чека",
      items: "tbank: в корзине отсутствуют допустимые позиции чека",
      quantity: "tbank: количество позиции чека должно быть положительным целым числом",
      reconciliation: "tbank: сумма позиций чека не совпадает с суммой платежа",
    } as const;
    super(messages[code]);
  }
}

const ITEM_CONSTANTS = {
  Tax: "vat105",
  PaymentMethod: "full_prepayment",
  MeasurementUnit: "шт",
} as const;

function normalizedEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && email.length <= 64 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : undefined;
}

function normalizedPhone(value: string | null | undefined): string | undefined {
  const compact = value?.trim().replace(/[\s()-]/g, "");
  if (!compact) return undefined;
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!/^\d{10,15}$/.test(digits)) return undefined;
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}

function itemParts(
  name: string,
  quantity: number,
  amount: number,
  paymentObject: TBankReceiptItem["PaymentObject"],
): readonly TBankReceiptItem[] {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new ReceiptBuildError("quantity");
  }
  if (!Number.isSafeInteger(amount) || amount < quantity) {
    throw new ReceiptBuildError("amount");
  }
  const price = Math.floor(amount / quantity);
  const remainder = amount % quantity;
  const makeItem = (partPrice: number, partQuantity: number): TBankReceiptItem => ({
    Name: name,
    Price: partPrice,
    Quantity: partQuantity,
    Amount: partPrice * partQuantity,
    ...ITEM_CONSTANTS,
    PaymentObject: paymentObject,
  });
  if (remainder === 0) return [makeItem(price, quantity)];
  const parts = [makeItem(price + 1, remainder)];
  if (quantity > remainder) parts.push(makeItem(price, quantity - remainder));
  return parts;
}

export function receiptAmount(receipt: TBankReceipt): number {
  return receipt.Items.reduce((sum, item) => sum + item.Amount, 0);
}

export function buildReceipt(cart: ReceiptCart, paymentAmountKopecks: number): TBankReceipt {
  const Email = normalizedEmail(cart.email);
  const Phone = normalizedPhone(cart.shipping_address?.phone);
  if (!Email && !Phone) throw new ReceiptBuildError("contact");

  const items = (cart.items ?? []).flatMap((item) => {
    const title = item.product_title?.trim() || item.title?.trim();
    if (!title) throw new ReceiptBuildError("items");
    return itemParts(
      buildReceiptName(title, item.variant_title ?? undefined),
      item.quantity,
      rublesToKopecks(item.total),
      "commodity",
    );
  });
  const shippingAmount = rublesToKopecks(cart.shipping_total);
  if (shippingAmount > 0) {
    items.push(...itemParts("Доставка", 1, shippingAmount, "service"));
  }
  if (items.length === 0 || items.length > 100) throw new ReceiptBuildError("items");
  if (
    rublesToKopecks(cart.total) !== paymentAmountKopecks ||
    items.reduce((sum, item) => sum + item.Amount, 0) !== paymentAmountKopecks
  ) {
    throw new ReceiptBuildError("reconciliation");
  }

  const fiscalData = { Taxation: "usn_income", Items: items } as const;
  if (Email) return { ...fiscalData, Email, ...(Phone ? { Phone } : {}) };
  if (Phone) return { ...fiscalData, Phone };
  throw new ReceiptBuildError("contact");
}

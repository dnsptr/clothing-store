import type { RefundReceiptMode, RefundSelection } from "../refund-contracts";
import type { TBankReceipt } from "./receipt";

/** Separate from the initial-receipt codec: its authenticated prepayment shape stays unchanged. */
export type TBankFiscalItem = {
  readonly Name: string;
  readonly Price: number;
  readonly Quantity: number;
  readonly Amount: number;
  readonly Tax: "vat105" | "vat5";
  readonly PaymentMethod: "full_prepayment" | "full_payment";
  readonly PaymentObject: "commodity" | "service" | "goods_with_marking_code";
  readonly MeasurementUnit: "шт";
  readonly MarkProcessingMode?: "0";
  readonly MarkCode?: { readonly MarkCodeType: "RAWCODE"; readonly Value: string };
};

export type TBankFiscalReceipt = {
  readonly Taxation: TBankReceipt["Taxation"];
  readonly Email?: string;
  readonly Phone?: string;
  readonly Items: readonly TBankFiscalItem[];
  readonly Payments?: { readonly Electronic: number; readonly AdvancePayment: number };
};

export class RefundReceiptBuildError extends Error {
  readonly name = "RefundReceiptBuildError";

  constructor(readonly code: "original" | "selection" | "quantity" | "marking" | "items" | "amount") {
    // Do not put contacts or scanned codes in error messages/logs.
    super(`tbank: invalid fiscal receipt (${code})`);
  }
}

const MAX_ITEMS = 100;
const MAX_QUANTITY = 99_999;
const MAX_MARK_LENGTH = 200;

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateOriginal(original: TBankReceipt): void {
  if (!original || original.Taxation !== "usn_income" || !Array.isArray(original.Items) ||
      original.Items.length === 0 || original.Items.length > MAX_ITEMS) {
    throw new RefundReceiptBuildError("original");
  }
  const { Email, Phone } = original;
  if ((!Email && !Phone) ||
      (Email !== undefined && (typeof Email !== "string" || Email.length > 64 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(Email))) ||
      (Phone !== undefined && (typeof Phone !== "string" || Phone.length > 64 || !/^\+\d{10,15}$/.test(Phone)))) {
    throw new RefundReceiptBuildError("original");
  }
  let total = 0;
  for (const item of original.Items) {
    if (!item || typeof item.Name !== "string" || !item.Name.trim() || item.Name.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(item.Name) || !positiveInteger(item.Price) ||
        !positiveInteger(item.Quantity) || item.Quantity > MAX_QUANTITY || !positiveInteger(item.Amount) ||
        item.Price * item.Quantity !== item.Amount || item.Tax !== "vat105" ||
        item.PaymentMethod !== "full_prepayment" || item.MeasurementUnit !== "шт" ||
        (item.PaymentObject !== "commodity" && item.PaymentObject !== "service")) {
      throw new RefundReceiptBuildError("original");
    }
    total += item.Amount;
    if (!Number.isSafeInteger(total)) throw new RefundReceiptBuildError("amount");
  }
}

/**
 * Validate a scanner's GS1 DataMatrix payload, not a display/escaped/base64 rendition.
 * This checks structure and GTIN checksum, NOT authenticity or ownership: the caller
 * must verify selected refund codes against its recorded successful closing receipt.
 * Accept both the full (91/92) and short (93) clothing crypto-tail formats unchanged.
 */
function validateMark(code: string): void {
  if (typeof code !== "string" || code.length > MAX_MARK_LENGTH ||
      !/^(?:\]d2)?01\d{14}21[\x21-\x7e]{1,20}\x1d(?:91[\x21-\x7e]{4}\x1d92(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{86}==)|93[\x21-\x7e]{4})$/.test(code)) {
    throw new RefundReceiptBuildError("marking");
  }
  const gtinStart = code.startsWith("]d2") ? 5 : 2;
  const gtin = code.slice(gtinStart, gtinStart + 14);
  let checksum = 0;
  for (let index = 0; index < 13; index++) checksum += Number(gtin[index]) * (index % 2 === 0 ? 3 : 1);
  if ((10 - checksum % 10) % 10 !== Number(gtin[13])) throw new RefundReceiptBuildError("marking");
}

function buildSelectedReceipt(
  original: TBankReceipt,
  selections: readonly RefundSelection[],
  mode: RefundReceiptMode,
  closing: boolean,
): TBankFiscalReceipt {
  validateOriginal(original);
  if (mode !== "prepayment" && mode !== "full_payment") throw new RefundReceiptBuildError("selection");
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > MAX_ITEMS) {
    throw new RefundReceiptBuildError("selection");
  }
  const indices = new Set<number>();
  const marks = new Set<string>();
  const Items: TBankFiscalItem[] = [];
  let total = 0;
  for (const selection of selections) {
    if (!selection || !Number.isSafeInteger(selection.line_index) || selection.line_index < 0 ||
        selection.line_index >= original.Items.length || indices.has(selection.line_index)) {
      throw new RefundReceiptBuildError("selection");
    }
    indices.add(selection.line_index);
    const source = original.Items[selection.line_index];
    if (!positiveInteger(selection.quantity) || selection.quantity > source.Quantity) {
      throw new RefundReceiptBuildError("quantity");
    }
    const marked = mode === "full_payment" && source.PaymentObject === "commodity";
    if (marked) {
      if (!Array.isArray(selection.mark_codes) || selection.mark_codes.length !== selection.quantity ||
          selection.mark_codes.length > MAX_ITEMS) throw new RefundReceiptBuildError("marking");
    } else if (selection.mark_codes !== undefined &&
        (!Array.isArray(selection.mark_codes) || selection.mark_codes.length !== 0)) {
      throw new RefundReceiptBuildError("marking");
    }
    const item: TBankFiscalItem = {
      Name: source.Name,
      Price: source.Price,
      Quantity: marked ? 1 : selection.quantity,
      Amount: marked ? source.Price : source.Price * selection.quantity,
      Tax: mode === "prepayment" ? "vat105" : "vat5",
      PaymentMethod: mode === "prepayment" ? "full_prepayment" : "full_payment",
      PaymentObject: marked ? "goods_with_marking_code" : source.PaymentObject,
      MeasurementUnit: "шт",
    };
    if (marked) {
      for (const code of selection.mark_codes!) {
        validateMark(code);
        // GTIN + serial identify the physical unit, regardless of scanner prefix/crypto tail.
        const identity = code.slice(code.startsWith("]d2") ? 3 : 0, code.indexOf("\u001d"));
        if (marks.has(identity)) throw new RefundReceiptBuildError("marking");
        marks.add(identity);
        Items.push({ ...item, MarkProcessingMode: "0", MarkCode: { MarkCodeType: "RAWCODE", Value: code } });
      }
    } else {
      Items.push(item);
    }
    if (Items.length > MAX_ITEMS) throw new RefundReceiptBuildError("items");
    total += source.Price * selection.quantity;
    if (!positiveInteger(total)) throw new RefundReceiptBuildError("amount");
  }
  // Closing consumes prepaid money; it must not fiscalize a second electronic payment.
  return {
    Taxation: original.Taxation,
    ...(original.Email !== undefined ? { Email: original.Email } : {}),
    ...(original.Phone !== undefined ? { Phone: original.Phone } : {}),
    Items,
    ...(closing ? { Payments: { Electronic: 0, AdvancePayment: total } } : {}),
  };
}

/** Exact receipt-row indices retain the initial split-kopek rounding, without repricing. */
export function buildRefundReceipt(
  original: TBankReceipt,
  selections: readonly RefundSelection[],
  mode: RefundReceiptMode,
): TBankFiscalReceipt {
  return buildSelectedReceipt(original, selections, mode, false);
}

/** Caller must select ALL remaining goods and prevent multiple/unknown-outcome submissions. */
export function buildClosingReceipt(
  original: TBankReceipt,
  selections: readonly RefundSelection[],
): TBankFiscalReceipt {
  return buildSelectedReceipt(original, selections, "full_payment", true);
}

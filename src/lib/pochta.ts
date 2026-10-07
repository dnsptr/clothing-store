import { isMedusaConfigured, medusaRequest } from "./medusa";

export interface PochtaPostOffice {
  readonly postalCode: string;
  readonly addressSource: string;
  readonly settlement?: string;
  readonly workHours?: string;
  readonly isClosed?: boolean;
}

export class PochtaDeliveryUnavailableError extends Error {
  readonly name = "PochtaDeliveryUnavailableError";

  constructor(message: string) {
    super(message);
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(record: UnknownRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function parsePostOffice(value: unknown): PochtaPostOffice {
  if (!isRecord(value)) {
    throw new PochtaDeliveryUnavailableError("Почта России вернула некорректные данные отделения.");
  }

  const postalCode = firstString(value, ["postal_code", "postalCode"]);
  const addressSource = firstString(value, ["address_source", "addressSource"]);
  if (!postalCode || !/^\d{6}$/.test(postalCode) || !addressSource) {
    throw new PochtaDeliveryUnavailableError("Почта России вернула неполные данные отделения.");
  }

  const settlement = firstString(value, ["settlement"]);
  const workHours = firstString(value, ["work_time", "workHours"]);
  const isClosed = value.is_closed === true || value.isClosed === true;
  return {
    postalCode,
    addressSource,
    ...(settlement ? { settlement } : {}),
    ...(workHours ? { workHours } : {}),
    ...(isClosed ? { isClosed } : {}),
  };
}

function parsePostOffices(data: unknown): PochtaPostOffice[] {
  if (!isRecord(data) || !Array.isArray(data.offices) || data.offices.length === 0) {
    throw new PochtaDeliveryUnavailableError("Почта России не вернула доступные отделения.");
  }
  return data.offices.map(parsePostOffice);
}

export async function fetchPostOffices(postalCode: string): Promise<PochtaPostOffice[]> {
  if (!/^\d{6}$/.test(postalCode)) {
    throw new PochtaDeliveryUnavailableError("Для поиска отделения укажите индекс из шести цифр.");
  }
  if (!isMedusaConfigured) {
    throw new PochtaDeliveryUnavailableError("Сервис Почты России сейчас недоступен.");
  }

  return parsePostOffices(
    await medusaRequest<unknown>(
      `/store/pochta/postoffices?postal_code=${encodeURIComponent(postalCode)}`,
      { revalidate: 3600 },
    ),
  );
}

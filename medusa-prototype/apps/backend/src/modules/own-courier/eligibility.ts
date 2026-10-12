import { z } from "zod";
import type { OwnCourierOptions } from "./config";

const cleanedAddressSchema = z.tuple([z.object({
  result: z.string().trim().min(1),
  beltway_hit: z.literal("IN_MKAD"),
  country_iso_code: z.literal("RU"),
  region_iso_code: z.literal("RU-MOW"),
  house: z.string().trim().min(1),
  qc: z.literal(0),
  qc_geo: z.literal(0),
  unparsed_parts: z.union([z.null(), z.literal("")]),
})]);

type CartAddress = {
  readonly address_1?: string | null;
  readonly address_2?: string | null;
  readonly city?: string | null;
  readonly province?: string | null;
  readonly country_code?: string | null;
  readonly postal_code?: string | null;
};

export type OwnCourierEligibility =
  | { readonly eligible: false }
  | { readonly eligible: true; readonly normalizedAddress: string };

export async function ownCourierEligibility(
  address: CartAddress | null | undefined,
  options: OwnCourierOptions,
): Promise<OwnCourierEligibility> {
  if (!address?.address_1?.trim() || address.country_code?.toLowerCase() !== "ru") {
    return { eligible: false };
  }

  const fullAddress = ["Россия", address.province, address.city, address.postal_code, address.address_1, address.address_2]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .join(", ");

  try {
    const response = await fetch("https://cleaner.dadata.ru/api/v1/clean/address", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${options.token}`,
        "X-Secret": options.secret,
      },
      body: JSON.stringify([fullAddress]),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return { eligible: false };
    const parsed = cleanedAddressSchema.safeParse(await response.json());
    if (!parsed.success) return { eligible: false };
    return { eligible: true, normalizedAddress: parsed.data[0].result };
  } catch {
    return { eligible: false };
  }
}

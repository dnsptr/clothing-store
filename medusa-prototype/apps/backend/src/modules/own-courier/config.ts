import { z } from "@medusajs/framework/zod";

const credentialsSchema = z.object({
  OWN_COURIER_ENABLED: z.literal("true"),
  OWN_COURIER_PRICE_RUB: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/).transform(Number).refine(Number.isFinite),
  DADATA_API_KEY: z.string().trim().min(1),
  DADATA_SECRET_KEY: z.string().trim().min(1),
});

export type OwnCourierOptions = {
  readonly token: string;
  readonly priceRub: number;
  readonly secret: string;
};

export type OwnCourierConfiguration =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly options: OwnCourierOptions };

export function parseOwnCourierEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): OwnCourierConfiguration {
  const result = credentialsSchema.safeParse(environment);
  if (!result.success) return { enabled: false };
  return {
    enabled: true,
    options: { token: result.data.DADATA_API_KEY, secret: result.data.DADATA_SECRET_KEY, priceRub: result.data.OWN_COURIER_PRICE_RUB },
  };
}

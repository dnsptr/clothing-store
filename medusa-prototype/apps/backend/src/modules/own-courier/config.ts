import { z } from "zod";

const credentialsSchema = z.object({
  DADATA_API_KEY: z.string().trim().min(1),
  DADATA_SECRET_KEY: z.string().trim().min(1),
});

export type OwnCourierOptions = {
  readonly token: string;
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
    options: { token: result.data.DADATA_API_KEY, secret: result.data.DADATA_SECRET_KEY },
  };
}

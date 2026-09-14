export const PROFILE_FIELDS = [
  ["model", "Модель / артикул"],
  ["composition", "Состав изделия"],
  ["lining", "Состав подкладки"],
  ["country", "Страна изготовления"],
  ["manufacturer", "Изготовитель"],
  ["manufacturer_address", "Юридический адрес изготовителя"],
  ["manufactured_at", "Дата изготовления (ММ.ГГГГ)"],
  ["care", "Правила ухода"],
  ["brand", "Товарный знак / бренд"],
  ["conformity_document", "Номер декларации / сертификата"],
  ["registry_url", "Ссылка на запись в реестре"],
] as const

export type ProfileKey = typeof PROFILE_FIELDS[number][0]
export type CatalogProfile = Record<ProfileKey, string> & { no_lining: boolean }

export function readProfile(value: unknown): CatalogProfile {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return {
    ...Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, typeof source[key] === "string" ? source[key] : ""])),
    no_lining: source.no_lining === true,
  } as CatalogProfile
}

export function profileProblems(profile: CatalogProfile): string[] {
  const missing = PROFILE_FIELDS.filter(([key]) => key !== "lining" || !profile.no_lining)
    .filter(([key]) => !profile[key].trim()).map(([, label]) => label as string)
  if (profile.manufactured_at && !/^(0[1-9]|1[0-2])\.\d{4}$/.test(profile.manufactured_at)) {
    missing.push("Дата изготовления: формат ММ.ГГГГ")
  }
  if (profile.registry_url) {
    try {
      if (new URL(profile.registry_url).protocol !== "https:") throw new Error()
    } catch { missing.push("Ссылка на реестр: требуется HTTPS-адрес") }
  }
  return missing
}

export const normalizeSize = (value: string) => /^(os|one\s*size)$/i.test(value.trim()) ? "ONE SIZE" : value.trim()

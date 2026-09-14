import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { profileProblems, readProfile } from "../../lib/catalog-profile"

// Legacy cards can still be edited, but explicit publication requires a profile.
export async function catalogProfileGuard(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const body = (req.body ?? {}) as Record<string, any>
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = req.params.id ? await query.graph({
    entity: "product", fields: ["id", "title", "status", "metadata", "images.*", "categories.*", "variants.*", "variants.price_set.prices.*"],
    filters: { id: req.params.id },
  }) : { data: [] }
  const current = data[0]
  const previous = current?.metadata?.catalog_profile
  const incoming = body.metadata?.catalog_profile
  if (previous === undefined && incoming === undefined && body.status !== "published") { next(); return }
  if (incoming === null || (previous !== undefined && body.metadata === null)) { res.status(400).json({ message: "Профиль карточки нельзя удалить. Сохраните товар черновиком." }); return }
  const profile = readProfile(incoming ?? previous)
  if (Object.values(profile).some((value) => typeof value === "string" && value.length > 4000)) {
    res.status(400).json({ message: "Поле карточки превышает 4000 символов" }); return
  }
  if ((body.status ?? current?.status) !== "published") { next(); return }
  const missing = profileProblems(profile)
  if (!(body.title ?? current?.title)?.trim()) missing.push("Наименование")
  if (!(body.images ?? current?.images)?.length) missing.push("Фото товара")
  if (!(body.categories ?? current?.categories)?.length) missing.push("Категория")
  const variants = body.variants ?? current?.variants ?? []
  if (!variants.length) missing.push("Варианты, размеры и цены")
  if (variants.some((variant: any) => !(variant.prices ?? variant.price_set?.prices)?.some((price: any) => price.currency_code === "rub" && Number(price.amount) > 0))) missing.push("Рублёвая цена вариантов")
  if (missing.length) { res.status(400).json({ message: `Карточка не готова к публикации: ${missing.join(", ")}` }); return }
  next()
}

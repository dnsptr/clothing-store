import { useEffect, useRef, useState } from "react"
import {
  Button,
  Drawer,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"

import { sdk } from "../lib/sdk"

export type SlideSection = "hero" | "shortcut" | "material" | "store" | "promo"

export interface SlideDraft {
  id?: string
  section: SlideSection
  title: string
  eyebrow: string
  subtitle: string
  media_type: "image" | "video"
  media_url: string
  media_key: string | null
  poster_url: string
  poster_key: string | null
  alt: string
  object_position: string
  duration_ms: string
  href: string
  cta_label: string
  is_active: boolean
}

export const emptyDraft = (section: SlideSection): SlideDraft => ({
  section,
  title: "",
  eyebrow: "",
  subtitle: "",
  media_type: "image",
  media_url: "",
  media_key: null,
  poster_url: "",
  poster_key: null,
  alt: "",
  object_position: "",
  duration_ms: "",
  href: "",
  cta_label: "",
  is_active: true,
})

/**
 * Which fields each section actually uses.
 *
 * Rendering every field everywhere would ask the editor to reason about, say, a
 * slide duration on a store card — a question the storefront never reads an
 * answer to. Hiding them is not cosmetic: an unused value that looks editable
 * is a promise the home page does not keep.
 */
const FIELDS: Record<SlideSection, ReadonlyArray<keyof SlideDraft>> = {
  hero: ["eyebrow", "media_type", "object_position", "duration_ms", "href"],
  shortcut: ["eyebrow", "href"],
  material: ["eyebrow", "href"],
  store: [],
  promo: ["eyebrow", "subtitle", "href", "cta_label"],
}

const SECTION_LABELS: Record<SlideSection, string> = {
  hero: "Главный слайдер",
  shortcut: "Разделы каталога",
  material: "Материалы",
  store: "Магазины",
  promo: "Промо-баннер",
}

export { SECTION_LABELS }

interface SlideFormProps {
  open: boolean
  draft: SlideDraft | null
  onClose: () => void
  onSaved: () => void
}

export function SlideForm({ open, draft, onClose, onSaved }: SlideFormProps) {
  const [form, setForm] = useState<SlideDraft>(emptyDraft("hero"))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<"media" | "poster" | null>(null)
  const mediaInput = useRef<HTMLInputElement>(null)
  const posterInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (draft) setForm(draft)
  }, [draft])

  const uses = (field: keyof SlideDraft) => FIELDS[form.section].includes(field)
  const set = <K extends keyof SlideDraft>(key: K, value: SlideDraft[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function upload(file: File, target: "media" | "poster") {
    setUploading(target)
    try {
      const { files } = await sdk.admin.upload.create({ files: [file] })
      const uploaded = files?.[0]
      if (!uploaded?.url) throw new Error("Сервер не вернул ссылку на файл")

      if (target === "media") {
        set("media_url", uploaded.url)
        set("media_key", uploaded.id ?? null)
      } else {
        set("poster_url", uploaded.url)
        set("poster_key", uploaded.id ?? null)
      }
      toast.success("Файл загружен")
    } catch (error) {
      toast.error("Не удалось загрузить файл", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setUploading(null)
    }
  }

  async function save() {
    if (!form.title.trim()) {
      toast.error("Укажите заголовок")
      return
    }
    if (!form.media_url.trim()) {
      toast.error("Добавьте изображение или укажите путь к файлу")
      return
    }

    setSaving(true)
    try {
      // Empty strings are sent as null so the storefront's "is this set?" checks
      // do not have to treat "" and null as two ways of saying the same thing.
      const orNull = (value: string) => (value.trim() === "" ? null : value.trim())

      const payload = {
        section: form.section,
        title: form.title.trim(),
        eyebrow: uses("eyebrow") ? orNull(form.eyebrow) : null,
        subtitle: uses("subtitle") ? orNull(form.subtitle) : null,
        media_type: uses("media_type") ? form.media_type : "image",
        media_url: form.media_url.trim(),
        media_key: form.media_key,
        poster_url: form.media_type === "video" ? orNull(form.poster_url) : null,
        poster_key: form.media_type === "video" ? form.poster_key : null,
        alt: orNull(form.alt),
        object_position: uses("object_position") ? orNull(form.object_position) : null,
        duration_ms:
          uses("duration_ms") && form.duration_ms.trim() !== ""
            ? Number(form.duration_ms)
            : null,
        href: uses("href") ? orNull(form.href) : null,
        cta_label: uses("cta_label") ? orNull(form.cta_label) : null,
        is_active: form.is_active,
      }

      await sdk.client.fetch(
        form.id ? `/admin/content/slides/${form.id}` : "/admin/content/slides",
        { method: "POST", body: payload }
      )

      toast.success(form.id ? "Слайд обновлён" : "Слайд создан")
      onSaved()
      onClose()
    } catch (error) {
      toast.error("Не удалось сохранить", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {form.id ? "Редактировать" : "Добавить"} — {SECTION_LABELS[form.section]}
          </Drawer.Title>
        </Drawer.Header>

        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="title">Заголовок</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>

          {uses("eyebrow") && (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="eyebrow">Надзаголовок</Label>
              <Input
                id="eyebrow"
                value={form.eyebrow}
                onChange={(e) => set("eyebrow", e.target.value)}
                placeholder="Актуальное"
              />
            </div>
          )}

          {uses("subtitle") && (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="subtitle">Подзаголовок</Label>
              <Textarea
                id="subtitle"
                value={form.subtitle}
                onChange={(e) => set("subtitle", e.target.value)}
              />
            </div>
          )}

          {uses("media_type") && (
            <div className="flex flex-col gap-y-2">
              <Label>Тип медиа</Label>
              <Select
                value={form.media_type}
                onValueChange={(value) => set("media_type", value as "image" | "video")}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="image">Изображение</Select.Item>
                  <Select.Item value="video">Видео</Select.Item>
                </Select.Content>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="media_url">
              {form.media_type === "video" ? "Видео" : "Изображение"}
            </Label>
            <Input
              id="media_url"
              value={form.media_url}
              onChange={(e) => {
                set("media_url", e.target.value)
                // Typed by hand, so it is no longer the file we uploaded.
                set("media_key", null)
              }}
              placeholder="/images/hero.png или https://…"
            />
            <input
              ref={mediaInput}
              type="file"
              accept={form.media_type === "video" ? "video/*" : "image/*"}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file, "media")
                e.target.value = ""
              }}
            />
            <div className="flex items-center gap-x-2">
              <Button
                size="small"
                variant="secondary"
                isLoading={uploading === "media"}
                onClick={() => mediaInput.current?.click()}
              >
                Загрузить файл
              </Button>
              <Text size="small" className="text-ui-fg-subtle">
                Или укажите путь к файлу витрины, начиная с «/»
              </Text>
            </div>
            {form.media_url && form.media_type === "image" && (
              <img
                src={form.media_url}
                alt=""
                className="mt-2 max-h-40 w-full rounded-md object-cover"
              />
            )}
          </div>

          {form.media_type === "video" && (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="poster_url">Постер видео</Label>
              <Input
                id="poster_url"
                value={form.poster_url}
                onChange={(e) => {
                  set("poster_url", e.target.value)
                  set("poster_key", null)
                }}
              />
              <input
                ref={posterInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void upload(file, "poster")
                  e.target.value = ""
                }}
              />
              <Button
                size="small"
                variant="secondary"
                isLoading={uploading === "poster"}
                onClick={() => posterInput.current?.click()}
              >
                Загрузить постер
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="alt">Альтернативный текст</Label>
            <Input
              id="alt"
              value={form.alt}
              onChange={(e) => set("alt", e.target.value)}
            />
            <Text size="small" className="text-ui-fg-subtle">
              Описание картинки для читающих программ. Оставьте пустым, если
              изображение декоративное.
            </Text>
          </div>

          {uses("href") && (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="href">Ссылка</Label>
              <Input
                id="href"
                value={form.href}
                onChange={(e) => set("href", e.target.value)}
                placeholder="/catalog?section=new"
              />
            </div>
          )}

          {uses("cta_label") && (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="cta_label">Текст кнопки</Label>
              <Input
                id="cta_label"
                value={form.cta_label}
                onChange={(e) => set("cta_label", e.target.value)}
                placeholder="О бренде"
              />
            </div>
          )}

          {uses("object_position") && (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="object_position">Положение кадра</Label>
              <Input
                id="object_position"
                value={form.object_position}
                onChange={(e) => set("object_position", e.target.value)}
                placeholder="50% 50%"
              />
            </div>
          )}

          {uses("duration_ms") && (
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="duration_ms">Длительность показа, мс</Label>
              <Input
                id="duration_ms"
                type="number"
                value={form.duration_ms}
                onChange={(e) => set("duration_ms", e.target.value)}
                placeholder="6500"
              />
            </div>
          )}

          <div className="flex items-center gap-x-2">
            <Switch
              id="is_active"
              checked={form.is_active}
              onCheckedChange={(checked) => set("is_active", checked)}
            />
            <Label htmlFor="is_active">Показывать на сайте</Label>
          </div>
        </Drawer.Body>

        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={save} isLoading={saving}>
            Сохранить
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

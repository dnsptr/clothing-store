import { useCallback, useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo, PencilSquare, Trash, ArrowUpMini, ArrowDownMini } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  IconButton,
  Table,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"

import { sdk } from "../../lib/sdk"
import { resolveMediaPreviewUrl } from "../../lib/media"
import {
  SlideForm,
  SECTION_LABELS,
  emptyDraft,
  type SlideDraft,
  type SlideSection,
} from "../../components/slide-form"

const SECTIONS = Object.keys(SECTION_LABELS) as SlideSection[]

interface SlideRow {
  id: string
  section: SlideSection
  rank: number
  is_active: boolean
  title: string
  eyebrow: string | null
  subtitle: string | null
  media_type: "image" | "video"
  media_url: string
  media_key: string | null
  poster_url: string | null
  poster_key: string | null
  alt: string | null
  object_position: string | null
  duration_ms: number | null
  href: string | null
  cta_label: string | null
}

const toDraft = (row: SlideRow): SlideDraft => ({
  id: row.id,
  section: row.section,
  title: row.title,
  eyebrow: row.eyebrow ?? "",
  subtitle: row.subtitle ?? "",
  media_type: row.media_type,
  media_url: row.media_url,
  media_key: row.media_key,
  poster_url: row.poster_url ?? "",
  poster_key: row.poster_key,
  alt: row.alt ?? "",
  object_position: row.object_position ?? "",
  duration_ms: row.duration_ms === null ? "" : String(row.duration_ms),
  href: row.href ?? "",
  cta_label: row.cta_label ?? "",
  is_active: row.is_active,
})

const ContentPage = () => {
  const [section, setSection] = useState<SlideSection>("hero")
  const [slides, setSlides] = useState<SlideRow[]>([])
  const [storefrontUrl, setStorefrontUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<SlideDraft | null>(null)
  const prompt = usePrompt()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await sdk.client.fetch<{
        slides: SlideRow[]
        storefront_url: string
      }>(
        "/admin/content/slides",
        { query: { section } }
      )
      setSlides(data.slides ?? [])
      setStorefrontUrl(data.storefront_url ?? "")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить контент")
    } finally {
      setLoading(false)
    }
  }, [section])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Reordering sends the whole section, not the moved slide: the storefront
   * reads these ranks directly, so applying the change as one request keeps a
   * half-reordered home page from ever being visible.
   */
  async function move(index: number, direction: -1 | 1) {
    const next = [...slides]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]

    setSlides(next)
    try {
      await sdk.client.fetch("/admin/content/reorder", {
        method: "POST",
        body: { section, ids: next.map((slide) => slide.id) },
      })
    } catch (err) {
      toast.error("Не удалось изменить порядок", {
        description: err instanceof Error ? err.message : undefined,
      })
      void load()
    }
  }

  async function remove(slide: SlideRow) {
    const confirmed = await prompt({
      title: "Удалить слайд?",
      description: `«${slide.title}» исчезнет с главной страницы. Действие необратимо.`,
      confirmText: "Удалить",
      cancelText: "Отмена",
    })
    if (!confirmed) return

    try {
      await sdk.client.fetch(`/admin/content/slides/${slide.id}`, { method: "DELETE" })
      toast.success("Слайд удалён")
      void load()
    } catch (err) {
      toast.error("Не удалось удалить", {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Контент главной</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Изображения, тексты и порядок блоков на главной странице сайта
          </Text>
        </div>
        <Button onClick={() => setDraft(emptyDraft(section))}>Добавить</Button>
      </div>

      <div className="flex flex-wrap gap-2 px-6 py-3">
        {SECTIONS.map((name) => (
          <Button
            key={name}
            size="small"
            variant={name === section ? "primary" : "secondary"}
            onClick={() => setSection(name)}
          >
            {SECTION_LABELS[name]}
          </Button>
        ))}
      </div>

      {loading && (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-subtle">Загрузка…</Text>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center justify-between px-6 py-8">
          <Text className="text-ui-fg-error">{error}</Text>
          <Button size="small" variant="secondary" onClick={() => void load()}>
            Повторить
          </Button>
        </div>
      )}

      {!loading && !error && slides.length === 0 && (
        <div className="px-6 py-8">
          <Text className="text-ui-fg-subtle">
            В этом блоке пока ничего нет. Нажмите «Добавить», чтобы создать первый
            элемент.
          </Text>
        </div>
      )}

      {!loading && !error && slides.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell className="w-20" />
              <Table.HeaderCell>Заголовок</Table.HeaderCell>
              <Table.HeaderCell>Ссылка</Table.HeaderCell>
              <Table.HeaderCell>Статус</Table.HeaderCell>
              <Table.HeaderCell className="w-40" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {slides.map((slide, index) => (
              <Table.Row key={slide.id}>
                <Table.Cell>
                  {slide.media_type === "image" ? (
                    <img
                      src={resolveMediaPreviewUrl(slide.media_url, storefrontUrl)}
                      alt=""
                      className="h-12 w-12 rounded-md object-cover"
                    />
                  ) : (
                    <div className="bg-ui-bg-subtle flex h-12 w-12 items-center justify-center rounded-md">
                      <Photo className="text-ui-fg-muted" />
                    </div>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text weight="plus">{slide.title}</Text>
                  {slide.eyebrow && (
                    <Text size="small" className="text-ui-fg-subtle">
                      {slide.eyebrow}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">
                  {slide.href ?? "—"}
                </Table.Cell>
                <Table.Cell>
                  <Badge color={slide.is_active ? "green" : "grey"} size="2xsmall">
                    {slide.is_active ? "Показывается" : "Скрыт"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-center justify-end gap-x-1">
                    <IconButton
                      size="small"
                      variant="transparent"
                      disabled={index === 0}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUpMini />
                    </IconButton>
                    <IconButton
                      size="small"
                      variant="transparent"
                      disabled={index === slides.length - 1}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDownMini />
                    </IconButton>
                    <IconButton
                      size="small"
                      variant="transparent"
                      onClick={() => setDraft(toDraft(slide))}
                    >
                      <PencilSquare />
                    </IconButton>
                    <IconButton
                      size="small"
                      variant="transparent"
                      onClick={() => void remove(slide)}
                    >
                      <Trash />
                    </IconButton>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      <SlideForm
        open={draft !== null}
        draft={draft}
        storefrontUrl={storefrontUrl}
        onClose={() => setDraft(null)}
        onSaved={() => void load()}
      />
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Контент главной",
  icon: Photo,
})

export default ContentPage

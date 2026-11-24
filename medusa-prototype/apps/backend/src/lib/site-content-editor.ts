import { randomUUID } from "node:crypto"
import defaults from "../data/site-content-defaults.json"
import { parseSiteContent, type SiteContent } from "./site-content-contract"

export const SITE_CONTENT_KEY = "site_content_editor"
export type SitePublication = { id: string; publishedAt: string; authorId: string; content: SiteContent }
export type SiteEditorState = { revision: number; draft: SiteContent; published: SitePublication | null; history: SitePublication[] }
export type SiteEditorCommand = { revision: number; action: "save"; content: unknown } | { revision: number; action: "publish" } | { revision: number; action: "restore"; publicationId: string }
export class SiteEditorConflict extends Error {}
export function readSiteEditor(metadata: Record<string, unknown>): SiteEditorState {
  const value = metadata[SITE_CONTENT_KEY] as SiteEditorState | undefined
  if (!value) return { revision: 0, draft: parseSiteContent(defaults), published: null, history: [] }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.history)) throw new Error("Invalid site content state")
  const publication = (item: SitePublication): SitePublication => {
    if (!item.id || !item.publishedAt || !item.authorId) throw new Error("Invalid site content publication")
    return { ...item, content: parseSiteContent(item.content) }
  }
  return { revision: value.revision, draft: parseSiteContent(value.draft), published: value.published ? publication(value.published) : null, history: value.history.map(publication) }
}
export async function mutateSiteEditor(dependencies: {
  load: () => Promise<Record<string, unknown>>
  save: (metadata: Record<string, unknown>) => Promise<unknown>
  locked: <T>(operation: () => Promise<T>) => Promise<T>
}, command: SiteEditorCommand, authorId: string) {
  return dependencies.locked(async () => {
    const metadata = await dependencies.load()
    const state = readSiteEditor(metadata)
    if (state.revision !== command.revision) throw new SiteEditorConflict("Контент изменён другим сотрудником. Обновите страницу перед сохранением.")
    let next: SiteEditorState = { ...state, revision: state.revision + 1 }
    if (command.action === "save") next.draft = parseSiteContent(command.content)
    else if (command.action === "publish") next = { ...next, published: { id: randomUUID(), publishedAt: new Date().toISOString(), authorId, content: parseSiteContent(state.draft) }, history: [...(state.published ? [state.published] : []), ...state.history].slice(0, 10) }
    else {
      const entry = [state.published, ...state.history].find(item => item?.id === command.publicationId)
      if (!entry) throw new SiteEditorConflict("Редакция больше недоступна")
      next.draft = parseSiteContent(entry.content)
    }
    await dependencies.save({ ...metadata, [SITE_CONTENT_KEY]: next })
    return next
  })
}

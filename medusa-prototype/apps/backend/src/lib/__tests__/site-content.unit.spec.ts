import defaults from "../../data/site-content-defaults.json"
import { parseSiteContent, REQUIRED_INFO_SLUGS, safeContentHref } from "../site-content-contract"
import { mutateSiteEditor, readSiteEditor, SITE_CONTENT_KEY, SiteEditorConflict } from "../site-content-editor"

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function fixture() {
  let metadata: Record<string, unknown> = { unrelated: { keep: true } }
  let tail: Promise<unknown> = Promise.resolve()
  const save = jest.fn(async (next: Record<string, unknown>) => { metadata = clone(next) })
  const dependencies = { load: async () => clone(metadata), save, locked: <T>(operation: () => Promise<T>) => { const next = tail.then(operation); tail = next.catch(() => {}); return next } }
  return { dependencies, save, state: () => readSiteEditor(metadata), raw: () => metadata }
}
it("preserves all current public texts and the seven document URLs in defaults", () => {
  expect(parseSiteContent(defaults)).toEqual(defaults)
  for (const slug of REQUIRED_INFO_SLUGS) expect(defaults.footer.legalLinks.some(link => link.href === `/info/${slug}`)).toBe(true)
})
it.each(["javascript:alert(1)", "data:text/html,evil", "//evil.test", "/\\evil.test", "/%2f%2fevil.test", "https://user:pass@host.test/x", "https://host.test/\nx"])("rejects unsafe links: %s", href => {
  expect(safeContentHref(href)).toBe(false)
  const draft = clone(defaults); draft.footer.columns[0].links[0].href = href
  expect(() => parseSiteContent(draft)).toThrow()
})
it("rejects dangling pages, duplicate addresses, non-documents and missing mandatory links", () => {
  const dangling = clone(defaults); dangling.footer.columns[0].links[0].href = "/info/missing"
  expect(() => parseSiteContent(dangling)).toThrow()
  const duplicate = clone(defaults); duplicate.pages.push(duplicate.pages[0])
  expect(() => parseSiteContent(duplicate)).toThrow()
  const missing = clone(defaults); missing.footer.legalLinks.pop()
  expect(() => parseSiteContent(missing)).toThrow()
  const executable = parseSiteContent(defaults); executable.pages[0].document = { href: "https://files.test/evil.html", label: "Download" }
  expect(() => parseSiteContent(executable)).toThrow()
})
it("keeps text as text and permits safe PDF/DOCX URLs", () => {
  const draft = parseSiteContent(defaults)
  draft.pages[0].sections[0].paragraphs = ['<script>alert("not executed")</script>']
  draft.pages[0].document = { href: "https://files.test/policy-v2.pdf", label: "Скачать" }
  expect(parseSiteContent(draft).pages[0].sections[0].paragraphs[0]).toContain("<script>")
})
it("does not expose a saved draft as a publication or overwrite unrelated metadata", async () => {
  const f = fixture(); const content = clone(defaults); content.pages[0].title = "DRAFT_SENTINEL"
  const state = await mutateSiteEditor(f.dependencies, { action: "save", revision: 0, content }, "user-1")
  expect(state.revision).toBe(1); expect(state.published).toBeNull()
  expect(f.state().draft.pages[0].title).toBe("DRAFT_SENTINEL")
  expect(f.raw().unrelated).toEqual({ keep: true })
  expect(Object.keys(f.raw())).toEqual(["unrelated", SITE_CONTENT_KEY])
})
it("publishes saved drafts atomically and restores old content only to a draft", async () => {
  const f = fixture()
  const first = await mutateSiteEditor(f.dependencies, { action: "publish", revision: 0 }, "owner")
  const draft = clone(first.draft); draft.footer.contactTitle = "Changed contact"
  await mutateSiteEditor(f.dependencies, { action: "save", revision: 1, content: draft }, "editor")
  expect(f.state().published!.content.footer.contactTitle).toBe(defaults.footer.contactTitle)
  const second = await mutateSiteEditor(f.dependencies, { action: "publish", revision: 2 }, "owner")
  expect(second.history[0].id).toBe(first.published!.id)
  const restored = await mutateSiteEditor(f.dependencies, { action: "restore", revision: 3, publicationId: first.published!.id }, "editor")
  expect(restored.draft.footer.contactTitle).toBe(defaults.footer.contactTitle)
  expect(restored.published!.content.footer.contactTitle).toBe("Changed contact")
})
it("rejects stale concurrent edits under the shared lock without losing the first save", async () => {
  const f = fixture()
  const results = await Promise.allSettled([mutateSiteEditor(f.dependencies, { action: "save", revision: 0, content: defaults }, "a"), mutateSiteEditor(f.dependencies, { action: "publish", revision: 0 }, "b")])
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
  expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(SiteEditorConflict)
  expect(f.state().revision).toBe(1)
  expect(f.save).toHaveBeenCalledTimes(1)
})
it("validates before saving and retains ten previous publications", async () => {
  const f = fixture()
  await expect(mutateSiteEditor(f.dependencies, { action: "save", revision: 0, content: {} }, "owner")).rejects.toThrow()
  expect(f.save).not.toHaveBeenCalled()
  for (let revision = 0; revision < 13; revision++) await mutateSiteEditor(f.dependencies, { action: "publish", revision }, "owner")
  expect(f.state().history).toHaveLength(10)
})

import { useEffect, useState, type ReactNode } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  PencilSquare,
  Trash,
  ArrowUpMini,
  ArrowDownMini,
} from "@medusajs/icons";
import {
  Badge,
  Button,
  Container,
  Heading,
  IconButton,
  Tabs,
} from "@medusajs/ui";
import { sdk } from "../../lib/sdk";
import {
  parseSiteContent,
  REQUIRED_INFO_SLUGS,
  type SiteContent,
  type SiteInfoPage,
  type SiteLink,
} from "../../../lib/site-content-contract";
import type {
  SiteEditorCommand,
  SiteEditorState,
} from "../../../lib/site-content-editor";

function Field({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
}) {
  const className =
    "w-full min-w-0 rounded border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm disabled:opacity-60";
  return (
    <label className="block min-w-0 space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {multiline ? (
        <textarea
          className={className}
          rows={4}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={className}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
function Move({
  index,
  count,
  onMove,
  onRemove,
  removeDisabled = false,
}: {
  index: number;
  count: number;
  onMove: (offset: number) => void;
  onRemove: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton
        size="small"
        title="Выше"
        aria-label="Выше"
        disabled={!index}
        onClick={() => onMove(-1)}
      >
        <ArrowUpMini />
      </IconButton>
      <IconButton
        size="small"
        title="Ниже"
        aria-label="Ниже"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDownMini />
      </IconButton>
      <IconButton
        size="small"
        title="Удалить"
        aria-label="Удалить"
        disabled={removeDisabled}
        onClick={onRemove}
      >
        <Trash />
      </IconButton>
    </div>
  );
}
function moved<T>(list: T[], index: number, offset: number) {
  const next = [...list];
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  return next;
}
function Links({
  links,
  onChange,
  legal = false,
}: {
  links: SiteLink[];
  onChange: (links: SiteLink[]) => void;
  legal?: boolean;
}) {
  return (
    <div className="space-y-3">
      {links.map((link, index) => (
        <div
          key={index}
          className="flex flex-wrap items-end gap-2 border-b border-ui-border-base pb-3"
        >
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <Field
              label="Подпись ссылки"
              value={link.label}
              onChange={(value) =>
                onChange(
                  links.map((item, i) =>
                    i === index ? { ...item, label: value } : item,
                  ),
                )
              }
            />
            <Field
              label="Адрес ссылки"
              value={link.href}
              disabled={
                legal &&
                REQUIRED_INFO_SLUGS.some(
                  (slug) => link.href === `/info/${slug}`,
                )
              }
              onChange={(value) =>
                onChange(
                  links.map((item, i) =>
                    i === index ? { ...item, href: value } : item,
                  ),
                )
              }
            />
          </div>
          <Move
            index={index}
            count={links.length}
            onMove={(offset) => onChange(moved(links, index, offset))}
            onRemove={() => onChange(links.filter((_, i) => i !== index))}
            removeDisabled={
              legal &&
              REQUIRED_INFO_SLUGS.some((slug) => link.href === `/info/${slug}`)
            }
          />
        </div>
      ))}
      <Button
        size="small"
        variant="secondary"
        onClick={() =>
          onChange([...links, { label: "Новая ссылка", href: "/" }])
        }
      >
        Добавить ссылку
      </Button>
    </div>
  );
}
function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-b border-ui-border-base py-5 last:border-0">
      <Heading level="h2">{title}</Heading>
      {children}
    </section>
  );
}

const SiteDocumentsPage = () => {
  const [state, setState] = useState<SiteEditorState>();
  const [draft, setDraft] = useState<SiteContent>();
  const [slug, setSlug] = useState("offer");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const dirty =
    !!draft && !!state && JSON.stringify(draft) !== JSON.stringify(state.draft);
  const page = draft?.pages.find((page) => page.slug === slug);
  useEffect(() => {
    let active = true;
    sdk.client
      .fetch<SiteEditorState>("/admin/content/site")
      .then((data) => {
        if (active) {
          setState(data);
          setDraft(data.draft);
        }
      })
      .catch(() => {
        if (active)
          setError("Не удалось загрузить редактор. Обновите страницу.");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function updatePage(values: Partial<SiteInfoPage>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((item) =>
              item.slug === slug ? { ...item, ...values } : item,
            ),
          }
        : current,
    );
  }
  function footer(values: Partial<SiteContent["footer"]>) {
    setDraft((current) =>
      current
        ? { ...current, footer: { ...current.footer, ...values } }
        : current,
    );
  }
  async function command(
    action: SiteEditorCommand["action"],
    publicationId?: string,
  ) {
    if (!state || !draft) return;
    if (
      action === "publish" &&
      !window.confirm(
        "Опубликовать сохранённую редакцию документов и футера для всех посетителей?",
      )
    )
      return;
    if (
      action === "restore" &&
      dirty &&
      !window.confirm("Заменить несохранённые изменения выбранной редакцией?")
    )
      return;
    try {
      const content = action === "save" ? parseSiteContent(draft) : undefined;
      setBusy(true);
      setError("");
      setStatus("");
      const body =
        action === "save"
          ? { action, revision: state.revision, content }
          : action === "restore"
            ? { action, revision: state.revision, publicationId }
            : { action, revision: state.revision };
      const next = await sdk.client.fetch<SiteEditorState>(
        "/admin/content/site",
        { method: "POST", body },
      );
      setState(next);
      setDraft(next.draft);
      setStatus(
        action === "publish"
          ? "Редакция опубликована"
          : action === "restore"
            ? "Редакция восстановлена в черновик"
            : "Черновик сохранён",
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить изменения",
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (!/\.(pdf|docx)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setError("Выберите PDF или DOCX размером до 10 МБ");
      return;
    }
    const selectedSlug = slug;
    try {
      setUploading(true);
      setError("");
      const { files } = await sdk.admin.upload.create({ files: [file] });
      if (!files[0]?.url)
        throw new Error("Сервер не вернул ссылку на документ");
      const href = files[0].url;
      setDraft((current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((item) =>
                item.slug === selectedSlug
                  ? {
                      ...item,
                      document: {
                        href,
                        label: item.document?.label || "Скачать документ",
                      },
                    }
                  : item,
              ),
            }
          : current,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить документ",
      );
    } finally {
      setUploading(false);
    }
  }
  return (
    <Container className="p-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border-base px-6 py-4">
        <div className="space-y-2">
          <Heading level="h1">Футер и документы</Heading>
          <div className="flex flex-wrap gap-2">
            <Badge color="grey">
              {dirty ? "Есть несохранённые изменения" : "Черновик"}
            </Badge>
            {state?.published && (
              <Badge color="green">
                Опубликовано{" "}
                {new Date(state.published.publishedAt).toLocaleString("ru-RU")}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={busy || uploading || !dirty}
            onClick={() => void command("save")}
          >
            Сохранить черновик
          </Button>
          <Button
            disabled={busy || uploading || !state || dirty}
            onClick={() => void command("publish")}
          >
            Опубликовать
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="break-words px-6 py-4 text-ui-fg-error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="px-6 py-3 text-ui-fg-success">
          {status}
        </p>
      )}
      {!draft || !state ? (
        <p className="px-6 py-6">
          {error ? "Редактор недоступен" : "Загрузка…"}
        </p>
      ) : (
        <fieldset disabled={busy || uploading} className="min-w-0">
        <Tabs defaultValue="pages">
          <div className="overflow-x-auto border-b border-ui-border-base px-6 py-3">
            <Tabs.List className="min-w-max">
              <Tabs.Trigger value="pages">Документы и страницы</Tabs.Trigger>
              <Tabs.Trigger value="footer">Футер</Tabs.Trigger>
              <Tabs.Trigger value="preview">Предпросмотр</Tabs.Trigger>
              <Tabs.Trigger value="history">Редакции</Tabs.Trigger>
            </Tabs.List>
          </div>
          <Tabs.Content value="pages" className="min-w-0 px-6 pb-6">
            <Band title="Страница">
              <div className="flex flex-wrap gap-3">
                <label className="min-w-0 flex-1 space-y-1 text-sm">
                  <span>Выберите страницу</span>
                  <select
                    className="w-full rounded border border-ui-border-base bg-ui-bg-field p-2"
                    value={slug}
                    onChange={(event) => setSlug(event.target.value)}
                  >
                    {draft.pages.map((page) => (
                      <option key={page.slug} value={page.slug}>
                        {page.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  disabled={REQUIRED_INFO_SLUGS.some((item) => item === slug)}
                  onClick={() => {
                    if (window.confirm("Удалить страницу из черновика?")) {
                      setDraft({
                        ...draft,
                        pages: draft.pages.filter((page) => page.slug !== slug),
                      });
                      setSlug("offer");
                    }
                  }}
                >
                  Удалить страницу
                </Button>
              </div>
            </Band>
            {page && (
              <>
                <Band title="Сведения">
                  <p className="text-sm text-ui-fg-subtle">/info/{page.slug}</p>
                  <Field
                    label="Заголовок"
                    value={page.title}
                    onChange={(title) => updatePage({ title })}
                  />
                  <Field
                    label="Краткое описание"
                    multiline
                    value={page.summary}
                    onChange={(summary) => updatePage({ summary })}
                  />
                  <Field
                    label="Статус редакции / примечание"
                    multiline
                    value={page.notice || ""}
                    onChange={(notice) => updatePage({ notice })}
                  />
                </Band>
                <Band title="Файл документа">
                  <Field
                    label="Ссылка на PDF / DOCX"
                    value={page.document?.href || ""}
                    onChange={(href) =>
                      updatePage({
                        document: href
                          ? {
                              href,
                              label: page.document?.label || "Скачать документ",
                            }
                          : undefined,
                      })
                    }
                  />
                  <Field
                    label="Подпись скачивания"
                    value={page.document?.label || ""}
                    onChange={(label) =>
                      updatePage({
                        document: { href: page.document?.href || "", label },
                      })
                    }
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-sm">
                      Загрузить PDF / DOCX
                      <input
                        className="mt-1 block max-w-full text-sm"
                        type="file"
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        disabled={uploading || busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void upload(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {page.document && (
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => updatePage({ document: undefined })}
                      >
                        Убрать ссылку
                      </Button>
                    )}
                  </div>
                </Band>
                <Band title="Содержание">
                  {page.sections.map((section, index) => (
                    <div
                      key={index}
                      className="space-y-3 border-b border-ui-border-base py-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          Раздел {index + 1}
                        </span>
                        <Move
                          index={index}
                          count={page.sections.length}
                          onMove={(offset) =>
                            updatePage({
                              sections: moved(page.sections, index, offset),
                            })
                          }
                          onRemove={() =>
                            updatePage({
                              sections: page.sections.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                          removeDisabled={page.sections.length === 1}
                        />
                      </div>
                      <Field
                        label="Заголовок раздела"
                        value={section.title}
                        onChange={(title) =>
                          updatePage({
                            sections: page.sections.map((item, i) =>
                              i === index ? { ...item, title } : item,
                            ),
                          })
                        }
                      />
                      {section.paragraphs.map((text, n) => (
                        <div key={n} className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <Field
                              label={`Абзац ${n + 1}`}
                              multiline
                              value={text}
                              onChange={(value) =>
                                updatePage({
                                  sections: page.sections.map((item, i) =>
                                    i === index
                                      ? {
                                          ...item,
                                          paragraphs: item.paragraphs.map(
                                            (entry, j) =>
                                              j === n ? value : entry,
                                          ),
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </div>
                          <IconButton
                            title="Удалить абзац"
                            aria-label="Удалить абзац"
                            onClick={() =>
                              updatePage({
                                sections: page.sections.map((item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        paragraphs: item.paragraphs.filter(
                                          (_, j) => j !== n,
                                        ),
                                      }
                                    : item,
                                ),
                              })
                            }
                          >
                            <Trash />
                          </IconButton>
                        </div>
                      ))}
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() =>
                          updatePage({
                            sections: page.sections.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    paragraphs: [...item.paragraphs, ""],
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        Добавить абзац
                      </Button>
                      <Field
                        label="Маркированный список"
                        multiline
                        value={(section.items ?? []).join("\n")}
                        onChange={(value) =>
                          updatePage({
                            sections: page.sections.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    items: value.split("\n"),
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                      <Field
                        label="Примечание раздела"
                        multiline
                        value={section.footnote || ""}
                        onChange={(footnote) =>
                          updatePage({
                            sections: page.sections.map((item, i) =>
                              i === index ? { ...item, footnote } : item,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      updatePage({
                        sections: [
                          ...page.sections,
                          { title: "Новый раздел", paragraphs: [""] },
                        ],
                      })
                    }
                  >
                    Добавить раздел
                  </Button>
                </Band>
              </>
            )}
            <Band title="Новая страница">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  <Field
                    label="Адрес страницы"
                    value={newSlug}
                    onChange={setNewSlug}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (
                      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug) ||
                      draft.pages.some((page) => page.slug === newSlug)
                    ) {
                      setError(
                        "Укажите уникальный адрес латиницей без пробелов",
                      );
                      return;
                    }
                    setDraft({
                      ...draft,
                      pages: [
                        ...draft.pages,
                        {
                          slug: newSlug,
                          title: "Новая страница",
                          summary: "",
                          sections: [{ title: "Содержание", paragraphs: [""] }],
                        },
                      ],
                    });
                    setSlug(newSlug);
                    setNewSlug("");
                  }}
                >
                  Добавить страницу
                </Button>
              </div>
            </Band>
          </Tabs.Content>
          <Tabs.Content value="footer" className="px-6 pb-6">
            <Band title="Контакты">
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["contactTitle", "Заголовок контактов"],
                    ["contactText", "Текст контактов"],
                    ["phone", "Телефон на сайте"],
                    ["phoneHref", "Номер для звонка"],
                    ["email", "Электронная почта"],
                    ["copyright", "Название в подписи"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={draft.footer[key]}
                    onChange={(value) => footer({ [key]: value })}
                  />
                ))}
              </div>
            </Band>
            <Band title="Меню">
              {draft.footer.columns.map((column, index) => (
                <div
                  key={index}
                  className="space-y-4 border-b border-ui-border-base pb-5"
                >
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Field
                        label="Заголовок колонки"
                        value={column.title}
                        onChange={(title) =>
                          footer({
                            columns: draft.footer.columns.map((item, i) =>
                              i === index ? { ...item, title } : item,
                            ),
                          })
                        }
                      />
                    </div>
                    <Move
                      index={index}
                      count={draft.footer.columns.length}
                      onMove={(offset) =>
                        footer({
                          columns: moved(draft.footer.columns, index, offset),
                        })
                      }
                      onRemove={() =>
                        footer({
                          columns: draft.footer.columns.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      removeDisabled={draft.footer.columns.length === 1}
                    />
                  </div>
                  <Links
                    links={column.links}
                    onChange={(links) =>
                      footer({
                        columns: draft.footer.columns.map((item, i) =>
                          i === index ? { ...item, links } : item,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <Button
                size="small"
                variant="secondary"
                disabled={draft.footer.columns.length >= 4}
                onClick={() =>
                  footer({
                    columns: [
                      ...draft.footer.columns,
                      {
                        title: "Новая колонка",
                        links: [{ label: "Главная", href: "/" }],
                      },
                    ],
                  })
                }
              >
                Добавить колонку
              </Button>
            </Band>
            <Band title="Правовая информация">
              <Links
                legal
                links={draft.footer.legalLinks}
                onChange={(legalLinks) => footer({ legalLinks })}
              />
            </Band>
          </Tabs.Content>
          <Tabs.Content value="preview" className="px-6 py-5">
            {page && (
              <article className="max-w-3xl space-y-5 break-words">
                <Heading level="h2">{page.title}</Heading>
                <p className="whitespace-pre-wrap text-sm">{page.summary}</p>
                {page.notice && (
                  <p className="border-l-2 border-ui-border-strong pl-3 text-sm">
                    {page.notice}
                  </p>
                )}
                {page.document && (
                  <p className="break-all text-sm">
                    {page.document.label}: {page.document.href}
                  </p>
                )}
                {page.sections.map((section, i) => (
                  <section
                    key={i}
                    className="space-y-3 border-t border-ui-border-base pt-5"
                  >
                    <Heading level="h3">{section.title}</Heading>
                    {section.paragraphs.map((text, i) => (
                      <p key={i} className="whitespace-pre-wrap text-sm">
                        {text}
                      </p>
                    ))}
                    {section.items && (
                      <ul className="list-disc pl-5 text-sm">
                        {section.items.map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    )}
                    {section.footnote && (
                      <p className="text-sm">{section.footnote}</p>
                    )}
                  </section>
                ))}
              </article>
            )}
            <Band title="Футер">
              <div className="grid gap-5 sm:grid-cols-3">
                {draft.footer.columns.map((column, i) => (
                  <div key={i}>
                    <p className="font-medium">{column.title}</p>
                    {column.links.map((link, n) => (
                      <p key={n} className="mt-2 text-sm">
                        {link.label}
                      </p>
                    ))}
                  </div>
                ))}
                <div>
                  <p className="font-medium">{draft.footer.contactTitle}</p>
                  <p className="text-sm">{draft.footer.contactText}</p>
                  <p className="text-sm">{draft.footer.phone}</p>
                  <p className="break-all text-sm">{draft.footer.email}</p>
                </div>
              </div>
              <p className="text-sm">
                {draft.footer.legalLinks.map((link) => link.label).join(" · ")}
              </p>
            </Band>
          </Tabs.Content>
          <Tabs.Content value="history" className="px-6 py-5">
            <div className="space-y-4">
              {[state.published, ...state.history]
                .filter((item) => item !== null)
                .map((item, i) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border-base pb-4"
                  >
                    <div>
                      <p className="text-sm">
                        {new Date(item.publishedAt).toLocaleString("ru-RU")}
                      </p>
                      <p className="text-xs text-ui-fg-subtle">
                        {i === 0 ? "Текущая публикация" : "Предыдущая редакция"}
                      </p>
                    </div>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void command("restore", item.id)}
                    >
                      Восстановить в черновик
                    </Button>
                  </div>
                ))}
              {!state.published && (
                <p className="text-sm text-ui-fg-subtle">Публикаций пока нет</p>
              )}
            </div>
          </Tabs.Content>
        </Tabs>
        </fieldset>
      )}
    </Container>
  );
};
export const config = defineRouteConfig({
  label: "Футер и документы",
  icon: PencilSquare,
  rank: 85,
});
export default SiteDocumentsPage;

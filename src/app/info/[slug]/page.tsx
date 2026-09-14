import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import { getInfoPage, INFO_PAGES } from "../../../lib/infoPages";
import { withBasePath } from "../../../lib/assets";
import styles from "./info.module.css";

interface InfoPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return INFO_PAGES.map((page) => ({ slug: page.slug }));
}

/**
 * Свои <title>, description, canonical и og-теги для каждого документа.
 *
 * Раньше оферта, политика ПДн и реквизиты отдавали общий заголовок корневого
 * layout — в выдаче и в ссылке, отправленной в поддержку или банку, они были
 * неотличимы друг от друга. Титул склеивается вручную, потому что в
 * `app/layout.tsx` задана строка, а не `title.template`; формат суффикса — тот
 * же, что у карточки товара.
 *
 * `openGraph` не наследуется по полям: своя секция на странице полностью
 * заменяет корневую, поэтому type/locale/siteName повторяются здесь — ровно так
 * же, как в `app/product/[id]/page.tsx`. Относительный canonical разрешается
 * от `metadataBase` корневого layout.
 */
export async function generateMetadata({ params }: InfoPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getInfoPage(slug);

  // Неизвестный slug — это 404 (см. notFound() ниже). Метаданные остаются
  // унаследованными от корневого layout: сочинять заголовок несуществующему
  // документу нечего.
  if (!page) {
    return {};
  }

  const title = `${page.title} | Mario Mikke`;
  const description = page.summary;

  return {
    title,
    description,
    alternates: { canonical: `/info/${page.slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ru_RU",
      siteName: "Mario Mikke",
    },
  };
}

export default async function InfoPage({ params }: InfoPageProps) {
  const { slug } = await params;
  const page = getInfoPage(slug);

  if (!page) {
    notFound();
  }

  return (
    <>
      <Header />
      <main className={styles.page}>
        <div className={styles.shell}>
          <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
            <Link href="/">Главная</Link>
            <span>/</span>
            <span>{page.title}</span>
          </nav>

          <section className={styles.hero}>
            <h1>{page.title}</h1>
            <p>{page.summary}</p>
            {page.document && (
              <p>
                <a className={styles.documentLink} href={withBasePath(page.document.href)} download>
                  {page.document.label}
                </a>
              </p>
            )}
            {/* Статус документа — часть содержимого страницы, а не служебная
                пометка в коде: черновик оферты не должен выглядеть как
                действующая редакция ни для покупателя, ни для проверяющего. */}
            {page.notice && (
              <p className={styles.notice} role="note">
                {page.notice}
              </p>
            )}
          </section>

          <div className={styles.sections}>
            {page.sections.map((section) => (
              <section key={section.title} className={styles.section}>
                <h2>{section.title}</h2>
                <div className={styles.sectionBody}>
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {section.items && (
                    <ul className={styles.list}>
                      {section.items.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {section.footnote && <p>{section.footnote}</p>}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

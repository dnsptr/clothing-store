import { notFound } from "next/navigation";
import Link from "next/link";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import { getInfoPage, INFO_PAGES } from "../../../lib/infoPages";
import styles from "./info.module.css";

interface InfoPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return INFO_PAGES.map((page) => ({ slug: page.slug }));
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
          </section>

          <div className={styles.sections}>
            {page.sections.map((section) => (
              <section key={section.title} className={styles.section}>
                <h2>{section.title}</h2>
                <p>{section.text}</p>
              </section>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

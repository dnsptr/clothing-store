"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEFAULT_SITE_CONTENT } from "../lib/siteContentDefaults";
import { getSiteContent } from "../lib/siteContent";
import styles from "./Footer.module.css";

export default function Footer() {
  const [content, setContent] = useState(DEFAULT_SITE_CONTENT.footer);
  const pathname = usePathname();
  useEffect(() => {
    const controller = new AbortController();
    const update = () => { void getSiteContent(controller.signal).then(data => { if (!controller.signal.aborted) setContent(data.footer); }).catch(() => {}); };
    update();
    window.addEventListener("focus", update);
    return () => { controller.abort(); window.removeEventListener("focus", update); };
  }, [pathname]);
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <nav className={styles.nav} aria-label="Ссылки в подвале">
            {content.columns.map((column, index) => (
              <div className={styles.column} key={index}>
                <h4 className={styles.colTitle}>{column.title}</h4>
                <ul className={styles.links}>
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={styles.link}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className={styles.contactSection}>
            <h4 className={styles.colTitle}>{content.contactTitle}</h4>
            <p className={styles.contactText}>
              {content.contactText}
            </p>
            <a className={styles.link} href={`tel:${content.phoneHref}`}>
              {content.phone}
            </a>
            <a className={styles.link} href={`mailto:${content.email}`}>
              {content.email}
            </a>
          </div>
        </div>

        <nav className={styles.legal} aria-label="Правовая информация">
          {content.legalLinks.map((link) => (
            <Link key={link.href} href={link.href} className={styles.legalLink}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.bottom}>
          <div className={styles.copy}>{content.copyright}, {new Date().getFullYear()}</div>
        </div>
      </div>

    </footer>
  );
}

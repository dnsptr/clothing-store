import Link from "next/link";
import type { BreadcrumbItem } from "../lib/catalog-navigation";
import styles from "./Breadcrumbs.module.css";

export default function Breadcrumbs({ items, className = "" }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav className={`${styles.nav} ${className}`} aria-label="Хлебные крошки">
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li className={styles.item} key={index}>
            {index > 0 && <span className={styles.separator} aria-hidden="true">/</span>}
            {index < items.length - 1 && item.href ? (
              <Link className={styles.link} href={item.href}>{item.label}</Link>
            ) : (
              <span className={styles.current} aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

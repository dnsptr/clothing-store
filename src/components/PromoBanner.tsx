import Image from "next/image";
import Link from "next/link";
import { withBasePath } from "../lib/assets";
import type { ContentSlide } from "../lib/content";
import styles from "./PromoBanner.module.css";

interface PromoBannerProps {
  promo: ContentSlide | null;
}

export default function PromoBanner({ promo }: PromoBannerProps) {
  // A full-bleed banner with nothing in it would be a screen-height empty
  // frame, so an unset banner removes the section instead of rendering a shell.
  if (!promo) return null;

  return (
    <section className={styles.section}>
      <div className={styles.frame}>
        <Image
          src={withBasePath(promo.media.url)}
          alt={promo.alt}
          fill
          sizes="100vw"
          className={styles.image}
        />
        <div className={styles.overlay} />

        <div className={styles.content}>
          {promo.eyebrow && <span className={styles.subtitle}>{promo.eyebrow}</span>}
          <h2 className={styles.title}>{promo.title}</h2>
          {promo.href && promo.ctaLabel && (
            <Link href={promo.href} className={styles.cta}>
              {promo.ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

import Image from "next/image";
import Link from "next/link";
import styles from "./Hero.module.css";

const HERO_SLIDE = {
  src: "/images/collection-women.png",
  alt: "Женский образ для офиса",
  eyebrow: "Актуальное",
  title: "Образы для офиса",
  href: "/catalog",
};

export default function Hero() {
  return (
    <section className={styles.hero} aria-label="Главная кампания">
      <Image
        src={HERO_SLIDE.src}
        alt={HERO_SLIDE.alt}
        fill
        priority
        sizes="100vw"
        className={styles.image}
      />
      <div className={styles.gradient} />

      <div className={`${styles.content} animate-fade-in`}>
        <span className={styles.eyebrow}>{HERO_SLIDE.eyebrow}</span>
        <h1 className={styles.title}>{HERO_SLIDE.title}</h1>
        <Link href={HERO_SLIDE.href} className={styles.link}>
          Смотреть
        </Link>
      </div>

      <div className={styles.progress} aria-hidden="true">
        <span className={styles.progressActive} />
        <span />
        <span />
      </div>
    </section>
  );
}

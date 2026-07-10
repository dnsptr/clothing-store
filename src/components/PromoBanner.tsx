import Image from "next/image";
import Link from "next/link";
import styles from "./PromoBanner.module.css";

export default function PromoBanner() {
  return (
    <section className={styles.section}>
      <Image
        src="/images/hero.png"
        alt="Подарочный сертификат"
        fill
        sizes="100vw"
        className={styles.image}
      />
      <div className={styles.overlay} />

      <div className={styles.content}>
        <span className={styles.subtitle}>Для тех, кто дорог</span>
        <h2 className={styles.title}>Подарочный сертификат</h2>
        <Link href="/catalog" className={styles.cta}>
          Выбрать
        </Link>
      </div>
    </section>
  );
}

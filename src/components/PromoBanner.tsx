import Image from "next/image";
import Link from "next/link";
import styles from "./PromoBanner.module.css";

export default function PromoBanner() {
  return (
    <section className={styles.section}>
      {/* Fullscreen Background Image */}
      <div className={styles.imageWrapper}>
        <Image
          src="/products/8/8-1.png"
          alt="Подарки и аксессуары 12STOREEZ"
          fill
          sizes="100vw"
          className={styles.image}
          priority
        />
        <div className={styles.overlay} />
      </div>

      {/* Center Floating Card */}
      <div className={`${styles.content} animate-fade-in`}>
        <span className={styles.subtitle}>Особая серия</span>
        <h2 className={styles.title}>Летние подарки</h2>
        <Link href="/catalog?category=Аксессуары" className={styles.cta}>
          Выбрать подарок
        </Link>
      </div>
    </section>
  );
}

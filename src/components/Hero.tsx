import Image from "next/image";
import Link from "next/link";
import styles from "./Hero.module.css";

export default function Hero() {
  return (
    <section className={styles.hero}>
      {/* Background Image */}
      <div className={styles.imageWrapper}>
        <Image
          src="/images/hero.png"
          alt="Летняя коллекция одежды"
          fill
          priority
          className={styles.image}
        />
        <div className={styles.overlay} />
      </div>

      {/* Floating Content */}
      <div className={`${styles.content} animate-fade-in`}>
        <span className={styles.subtitle}>Новая кампания</span>
        <h1 className={styles.title}>Летний сезон</h1>
        <Link href="#" className={styles.cta}>
          Смотреть коллекцию
        </Link>
      </div>
    </section>
  );
}

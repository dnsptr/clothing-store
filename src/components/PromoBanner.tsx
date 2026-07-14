import Image from "next/image";
import Link from "next/link";
import styles from "./PromoBanner.module.css";

export default function PromoBanner() {
  return (
    <section className={styles.section}>
      <Image
        src="/images/hero.png"
        alt="Женская коллекция MARIO MIKKE"
        fill
        sizes="100vw"
        className={styles.image}
      />
      <div className={styles.overlay} />

      <div className={styles.content}>
        <span className={styles.subtitle}>MARIO MIKKE</span>
        <h2 className={styles.title}>Современная классика для женщин</h2>
        <Link href="/info/about" className={styles.cta}>
          О бренде
        </Link>
      </div>
    </section>
  );
}

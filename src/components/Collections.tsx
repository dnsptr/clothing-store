import Image from "next/image";
import Link from "next/link";
import { MOCK_COLLECTIONS } from "../data/mockData";
import { withBasePath } from "../lib/assets";
import styles from "./Collections.module.css";

export default function Collections() {
  return (
    <section className={styles.collections}>
      <div className="container">
        <div className={styles.grid}>
          {MOCK_COLLECTIONS.map((collection) => (
            <Link href={collection.link} key={collection.id} className={styles.card}>
              {/* Background Image */}
              <div className={styles.imageWrapper}>
                <Image
                  src={withBasePath(collection.image)}
                  alt={collection.title}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className={styles.image}
                />
                <div className={styles.overlay} />
              </div>

              {/* Text Info */}
              <div className={styles.content}>
                <h2 className={styles.title}>{collection.title}</h2>
                <p className={styles.subtitle}>{collection.subtitle}</p>
                <span className={styles.link}>Смотреть</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

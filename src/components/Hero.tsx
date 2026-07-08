import Image from "next/image";
import Link from "next/link";
import origStyles from "./Hero.module.css";

export default function Hero() {
  return (
    <section className={origStyles.hero}>
      {/* Background Image */}
      <div className={origStyles.imageWrapper}>
        <Image
          src="/images/hero.png"
          alt="Летняя коллекция одежды"
          fill
          priority
          className={origStyles.image}
        />
        <div className={origStyles.overlay} />
      </div>

      {/* Floating Content */}
      <div className={`${origStyles.content} animate-fade-in`}>
        <span className={origStyles.subtitle}>Новая кампания</span>
        <h1 className={origStyles.title}>Летний сезон</h1>
        <Link href="/catalog" className={origStyles.cta}>
          Смотреть коллекцию
        </Link>
      </div>
    </section>
  );
}

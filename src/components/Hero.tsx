"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "../context/CartContext";
import styles from "./Hero.image.module.css"; // We will rename the styles slightly or keep styles
import origStyles from "./Hero.module.css";

export default function Hero() {
  const { gender } = useCart();

  const heroData = {
    women: {
      image: "/images/hero.png",
      title: "Летний сезон",
      subtitle: "Новая кампания",
      link: "/catalog?gender=women",
    },
    men: {
      image: "/images/collection-men.png",
      title: "Мужской сезон",
      subtitle: "Безупречный крой",
      link: "/catalog?gender=men",
    },
  };

  const currentHero = heroData[gender];

  return (
    <section className={origStyles.hero}>
      {/* Background Image */}
      <div className={origStyles.imageWrapper}>
        <Image
          src={currentHero.image}
          alt={currentHero.title}
          fill
          priority
          className={origStyles.image}
          key={gender} // Triggers React state transition for new image zoom
        />
        <div className={origStyles.overlay} />
      </div>

      {/* Floating Content */}
      <div className={`${origStyles.content} animate-fade-in`} key={`content-${gender}`}>
        <span className={origStyles.subtitle}>{currentHero.subtitle}</span>
        <h1 className={origStyles.title}>{currentHero.title}</h1>
        <Link href={currentHero.link} className={origStyles.cta}>
          Смотреть коллекцию
        </Link>
      </div>
    </section>
  );
}

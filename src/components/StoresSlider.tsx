"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import styles from "./StoresSlider.module.css";

const STORES = [
  {
    name: "Флагман Столешников",
    address: "Москва, Столешников переулок, 12",
    hours: "Ежедневно: 10:00 — 22:00",
    image: "/images/collection-women.png",
  },
  {
    name: "Бутик Галерея",
    address: "Санкт-Петербург, Лиговский проспект, 30",
    hours: "Ежедневно: 10:00 — 23:00",
    image: "/images/collection-men.png",
  },
  {
    name: "Бутик Ельцин Центр",
    address: "Екатеринбург, улица Бориса Ельцина, 3",
    hours: "Ежедневно: 10:00 — 21:00",
    image: "/images/hero.png",
  },
];

export default function StoresSlider() {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftState, setScrollLeftState] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!sliderRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - sliderRef.current.offsetLeft);
    setScrollLeftState(sliderRef.current.scrollLeft);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !sliderRef.current) return;
    e.preventDefault();
    const x = e.pageX - sliderRef.current.offsetLeft;
    const distance = x - startX;
    sliderRef.current.scrollLeft = scrollLeftState - distance * 1.25;
  };

  return (
    <section className={styles.section}>
      <div className={styles.titleSection}>
        <span className={styles.subtitle}>Адреса</span>
        <h2 className={styles.title}>Наши магазины</h2>
      </div>

      <div className={styles.sliderWrapper}>
        <div
          ref={sliderRef}
          className={`${styles.slider} ${isDragging ? styles.sliderActive : ""}`}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseLeave}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
        >
          {STORES.map((store, index) => (
            <div key={index} className={styles.card} draggable={false}>
              <div className={styles.imageWrapper}>
                <Image
                  src={store.image}
                  alt={store.name}
                  fill
                  sizes="(max-width: 768px) 280px, 380px"
                  className={styles.image}
                  draggable={false}
                />
              </div>
              <div className={styles.info}>
                <h3 className={styles.storeName}>{store.name}</h3>
                <p className={styles.address}>{store.address}</p>
                <span className={styles.hours}>{store.hours}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

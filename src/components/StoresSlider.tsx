"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import styles from "./StoresSlider.module.css";

const STORES = [
  {
    name: "Магазин 01",
    image: "/images/collection-women.png",
  },
  {
    name: "Магазин 02",
    image: "/images/hero.png",
  },
  {
    name: "Магазин 03",
    image: "/products/1/1-1.jpg",
  },
  {
    name: "Магазин 04",
    image: "/products/5/5-1.png",
  },
  {
    name: "Онлайн",
    image: "/products/8/8-1.png",
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

  const handleMouseLeave = () => setIsDragging(false);
  const handleMouseUp = () => setIsDragging(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !sliderRef.current) return;
    e.preventDefault();
    const x = e.pageX - sliderRef.current.offsetLeft;
    const distance = x - startX;
    sliderRef.current.scrollLeft = scrollLeftState - distance * 1.15;
  };

  return (
    <section className={styles.section}>
      <div className={styles.titleSection}>
        <span className={styles.subtitle}>Магазины и контакты</span>
        <h2 className={styles.title}>10 магазинов сегодня. Одиннадцатый откроется в августе</h2>
      </div>

      <div
        ref={sliderRef}
        className={`${styles.slider} ${isDragging ? styles.sliderActive : ""}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {STORES.map((store) => (
          <article key={store.name} className={styles.card} draggable={false}>
            <Image
              src={store.image}
              alt={store.name}
              fill
              sizes="(max-width: 768px) 76vw, 22vw"
              className={styles.image}
              draggable={false}
            />
            <div className={styles.overlay} />
            <div className={styles.info}>
              <h3 className={styles.storeName}>{store.name}</h3>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

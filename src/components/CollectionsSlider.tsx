"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./CollectionsSlider.module.css";

const STORIES = [
  {
    id: "linen-look",
    title: "Льняной силуэт",
    subtitle: "Летний образ с тренчем и брюками",
    image: "/products/1/1-1.jpg",
    href: "/collection/linen-look",
  },
  {
    id: "cashmere-cozy",
    title: "Теплый трикотаж",
    subtitle: "Мягкие фактуры для прохладных дней",
    image: "/products/2/2-1.png",
    href: "/collection/cashmere-cozy",
  },
  {
    id: "autumn-chic",
    title: "Жакет и шелк",
    subtitle: "Собранный образ для города",
    image: "/products/5/5-1.png",
    href: "/collection/autumn-chic",
  },
  {
    id: "summer-dress",
    title: "Платье миди",
    subtitle: "Легкая линия и чистая графика",
    image: "/products/8/8-1.png",
    href: "/catalog?category=Трикотаж",
  },
  {
    id: "accessory-edit",
    title: "Акценты",
    subtitle: "Сумки, обувь и лаконичные детали",
    image: "/products/4/4-1.png",
    href: "/catalog?category=Аксессуары",
  },
];

export default function CollectionsSlider() {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftState, setScrollLeftState] = useState(0);
  const [draggedDistance, setDraggedDistance] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!sliderRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - sliderRef.current.offsetLeft);
    setScrollLeftState(sliderRef.current.scrollLeft);
    setDraggedDistance(0);
  };

  const handleMouseLeave = () => setIsDragging(false);
  const handleMouseUp = () => setIsDragging(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !sliderRef.current) return;
    e.preventDefault();
    const x = e.pageX - sliderRef.current.offsetLeft;
    const distance = x - startX;
    setDraggedDistance(Math.abs(distance));
    sliderRef.current.scrollLeft = scrollLeftState - distance * 1.15;
  };

  const handleLinkClick = (e: React.MouseEvent) => {
    if (draggedDistance > 5) e.preventDefault();
  };

  return (
    <section id="collections" className={styles.section}>
      <div className={styles.titleSection}>
        <h2 className={styles.title}>Истории</h2>
      </div>

      <div
        ref={sliderRef}
        className={`${styles.slider} ${isDragging ? styles.sliderActive : ""}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {STORIES.map((outfit) => (
          <Link
            key={outfit.id}
            href={outfit.href}
            className={styles.card}
            onClick={handleLinkClick}
            draggable={false}
          >
            <Image
              src={outfit.image}
              alt={outfit.title}
              fill
              sizes="(max-width: 768px) 86vw, 45vw"
              className={styles.image}
              draggable={false}
            />
            <div className={styles.overlay} />
            <div className={styles.info}>
              <h3 className={styles.cardTitle}>{outfit.title}</h3>
              <p className={styles.cardSubtitle}>{outfit.subtitle}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

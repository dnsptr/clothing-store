"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./RecommendationsSlider.module.css";

const RECOMMENDATIONS = [
  {
    name: "Пальто и тренчи",
    image: "/products/1/1-1.jpg",
    link: "/catalog?category=Пальто и тренчи",
  },
  {
    name: "Трикотаж",
    image: "/products/2/2-1.png",
    link: "/catalog?category=Трикотаж",
  },
  {
    name: "Брюки и юбки",
    image: "/products/3/3-1.png",
    link: "/catalog?category=Брюки",
  },
  {
    name: "Обувь",
    image: "/products/9/9-1.png",
    link: "/catalog?category=Обувь",
  },
  {
    name: "Аксессуары",
    image: "/products/4/4-1.png",
    link: "/catalog?category=Аксессуары",
  },
];

export default function RecommendationsSlider() {
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
    setDraggedDistance(Math.abs(distance));
    // Multiply by 1.25 for comfortable scroll responsiveness
    sliderRef.current.scrollLeft = scrollLeftState - distance * 1.25;
  };

  const handleLinkClick = (e: React.MouseEvent) => {
    // If user dragged more than 5 pixels, prevent link trigger
    if (draggedDistance > 5) {
      e.preventDefault();
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.titleSection}>
        <span className={styles.subtitle}>Рекомендации</span>
        <h2 className={styles.title}>Купить по категориям</h2>
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
          {RECOMMENDATIONS.map((item, index) => (
            <Link
              key={index}
              href={item.link}
              className={styles.card}
              onClick={handleLinkClick}
              draggable={false}
            >
              <div className={styles.imageWrapper}>
                <Image
                  src={item.image}
                  alt={item.name}
                  fill
                  sizes="(max-width: 768px) 250px, 320px"
                  className={styles.image}
                  draggable={false}
                  priority={index < 3}
                />
              </div>
              <div className={styles.info}>
                <h3 className={styles.cardTitle}>{item.name}</h3>
                <span className={styles.cardLink}>Смотреть</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

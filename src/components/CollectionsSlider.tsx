"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MOCK_OUTFITS } from "../data/mockData";
import styles from "./CollectionsSlider.module.css";

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
    sliderRef.current.scrollLeft = scrollLeftState - distance * 1.25;
  };

  const handleLinkClick = (e: React.MouseEvent) => {
    if (draggedDistance > 5) e.preventDefault();
  };

  return (
    <section className={styles.section}>
      <div className={styles.titleSection}>
        <span className={styles.subtitle}>Кампания</span>
        <h2 className={styles.title}>Готовые образы</h2>
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
          {MOCK_OUTFITS.map((outfit) => (
            <Link
              key={outfit.id}
              href={`/collection/${outfit.id}`}
              className={styles.card}
              onClick={handleLinkClick}
              draggable={false}
            >
              {/* Full-height outfit image */}
              <Image
                src={outfit.image}
                alt={outfit.title}
                fill
                sizes="(max-width: 768px) 88vw, (max-width: 1024px) 70vw, 40vw"
                className={styles.image}
                draggable={false}
              />

              {/* Dark gradient overlay */}
              <div className={styles.overlay} />

              {/* Text bottom-left on image */}
              <div className={styles.info}>
                <h3 className={styles.cardTitle}>{outfit.title}</h3>
                <p className={styles.cardSubtitle}>{outfit.subtitle}</p>
                <span className={styles.cardLink}>Собрать образ</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

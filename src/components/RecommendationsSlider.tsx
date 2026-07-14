"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { withBasePath } from "../lib/assets";
import { HOME_RECOMMENDATIONS } from "../lib/catalog";
import EditorialCursor, { useEditorialCursor } from "./EditorialCursor";
import styles from "./RecommendationsSlider.module.css";

export default function RecommendationsSlider() {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftState, setScrollLeftState] = useState(0);
  const [draggedDistance, setDraggedDistance] = useState(0);
  const { cursorRef, cursorHandlers } = useEditorialCursor();

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
    <section className={styles.section} aria-label="Разделы каталога">
      <div
        ref={sliderRef}
        className={`${styles.slider} ${isDragging ? styles.sliderActive : ""}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {HOME_RECOMMENDATIONS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.card}
            draggable={false}
            onClick={handleLinkClick}
            {...cursorHandlers}
          >
            <Image
              src={withBasePath(item.image)}
              alt={item.label}
              fill
              sizes="(max-width: 768px) 82vw, 25vw"
              className={styles.image}
              draggable={false}
            />
            <div className={styles.overlay} />
            <div className={styles.info}>
              <span className={styles.eyebrow}>{item.eyebrow}</span>
              <h2 className={styles.title}>{item.label}</h2>
            </div>
          </Link>
        ))}
      </div>
      <EditorialCursor cursorRef={cursorRef} isDragging={isDragging} />
    </section>
  );
}

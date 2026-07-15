"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MOCK_OUTFITS } from "../data/mockData";
import { withBasePath } from "../lib/assets";
import EditorialCursor, { useEditorialCursor } from "./EditorialCursor";
import styles from "./CollectionsSlider.module.css";

export default function CollectionsSlider() {
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
    <section id="collections" className={styles.section}>
      <div className={styles.titleSection}>
        <h2 className={styles.title}>Коллекции</h2>
      </div>

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
            {...cursorHandlers}
          >
            <Image
              src={withBasePath(outfit.image)}
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
      <EditorialCursor cursorRef={cursorRef} isDragging={isDragging} />
    </section>
  );
}

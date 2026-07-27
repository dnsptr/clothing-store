"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { withBasePath } from "../lib/assets";
import type { ContentSlide } from "../lib/content";
import EditorialCursor, { useEditorialCursor } from "./EditorialCursor";
import styles from "./MaterialsSlider.module.css";

/**
 * The editorial material cards on the home page.
 *
 * Not to be confused with the material taxonomy in lib/catalog.ts, which the
 * menu and the catalog filters read: that is a fact about the assortment, this
 * is a promotional row the client curates. They happen to overlap today.
 */
interface MaterialsSliderProps {
  items: ContentSlide[];
}

export default function MaterialsSlider({ items }: MaterialsSliderProps) {
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

  if (!items.length) return null;

  return (
    <section id="materials" className={styles.section} aria-label="Рекомендации по материалам">
      <div
        ref={sliderRef}
        className={`${styles.slider} ${isDragging ? styles.sliderActive : ""}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href ?? "/catalog"}
            className={styles.card}
            onClick={handleLinkClick}
            draggable={false}
            {...cursorHandlers}
          >
            <Image
              src={withBasePath(item.media.url)}
              alt={item.alt || item.title}
              fill
              sizes="(max-width: 768px) 84vw, 46vw"
              className={styles.image}
              draggable={false}
            />
            <div className={styles.overlay} />
            <div className={styles.info}>
              {item.eyebrow && <span className={styles.eyebrow}>{item.eyebrow}</span>}
              <h3 className={styles.cardTitle}>{item.title}</h3>
            </div>
          </Link>
        ))}
      </div>
      <EditorialCursor cursorRef={cursorRef} isDragging={isDragging} />
    </section>
  );
}

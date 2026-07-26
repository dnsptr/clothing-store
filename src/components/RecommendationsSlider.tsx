"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { withBasePath } from "../lib/assets";
import type { ContentSlide } from "../lib/content";
import EditorialCursor, { useEditorialCursor } from "./EditorialCursor";
import styles from "./RecommendationsSlider.module.css";

interface RecommendationsSliderProps {
  items: ContentSlide[];
}

export default function RecommendationsSlider({ items }: RecommendationsSliderProps) {
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

  // The client can empty this section from the admin. Rendering an empty
  // slider would leave a band of whitespace where a row of cards used to be.
  if (!items.length) return null;

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
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href ?? "/catalog"}
            className={styles.card}
            draggable={false}
            onClick={handleLinkClick}
            {...cursorHandlers}
          >
            <Image
              src={withBasePath(item.media.url)}
              alt={item.alt || item.title}
              fill
              sizes="(max-width: 768px) 82vw, 25vw"
              className={styles.image}
              draggable={false}
            />
            <div className={styles.overlay} />
            <div className={styles.info}>
              {item.eyebrow && <span className={styles.eyebrow}>{item.eyebrow}</span>}
              <h2 className={styles.title}>{item.title}</h2>
            </div>
          </Link>
        ))}
      </div>
      <EditorialCursor cursorRef={cursorRef} isDragging={isDragging} />
    </section>
  );
}

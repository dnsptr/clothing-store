"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./MaterialsSlider.module.css";

const MATERIALS = [
  {
    name: "Лен",
    eyebrow: "Материалы в деталях",
    image: "/products/3/3-1.png",
    link: "/catalog?category=Брюки",
  },
  {
    name: "Шелк",
    eyebrow: "Материалы в деталях",
    image: "/products/6/6-1.png",
    link: "/catalog?category=Трикотаж",
  },
  {
    name: "Кашемир",
    eyebrow: "Материалы в деталях",
    image: "/products/2/2-1.png",
    link: "/catalog?category=Трикотаж",
  },
];

export default function MaterialsSlider() {
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
    <section id="materials" className={styles.section} aria-label="Рекомендации по материалам">
      <div
        ref={sliderRef}
        className={`${styles.slider} ${isDragging ? styles.sliderActive : ""}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        {MATERIALS.map((item) => (
          <Link
            key={item.name}
            href={item.link}
            className={styles.card}
            onClick={handleLinkClick}
            draggable={false}
          >
            <Image
              src={item.image}
              alt={item.name}
              fill
              sizes="(max-width: 768px) 84vw, 46vw"
              className={styles.image}
              draggable={false}
            />
            <div className={styles.overlay} />
            <div className={styles.info}>
              <span className={styles.eyebrow}>{item.eyebrow}</span>
              <h3 className={styles.cardTitle}>{item.name}</h3>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

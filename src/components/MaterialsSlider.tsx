"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./MaterialsSlider.module.css";

const MATERIALS = [
  {
    name: "Натуральный лен",
    desc: "Прохлада и легкость натурального льна в летние дни.",
    image: "/products/3/3-1.png",
    link: "/catalog?category=Брюки",
  },
  {
    name: "Премиальный шелк",
    desc: "Струящийся натуральный шелк с деликатным блеском.",
    image: "/products/6/6-1.png",
    link: "/catalog?category=Трикотаж",
  },
  {
    name: "Мягкий кашемир",
    desc: "Нежнейшая кашемировая пряжа для уютных трикотажных сетов.",
    image: "/products/2/2-1.png",
    link: "/catalog?category=Трикотаж",
  },
  {
    name: "Тонкая шерсть",
    desc: "Плотные шерстяные ткани для классических жакетов и пальто.",
    image: "/products/5/5-1.png",
    link: "/catalog?category=Пальто и тренчи",
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
    sliderRef.current.scrollLeft = scrollLeftState - distance * 1.25;
  };

  const handleLinkClick = (e: React.MouseEvent) => {
    if (draggedDistance > 5) {
      e.preventDefault();
    }
  };

  return (
    <section className={styles.section}>
      <div className={styles.titleSection}>
        <span className={styles.subtitle}>Философия</span>
        <h2 className={styles.title}>Выбрать по материалам</h2>
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
          {MATERIALS.map((item, index) => (
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
                  sizes="(max-width: 768px) 220px, 280px"
                  className={styles.image}
                  draggable={false}
                />
              </div>
              <div className={styles.info}>
                <h3 className={styles.cardTitle}>{item.name}</h3>
                <p className={styles.cardDesc}>{item.desc}</p>
                <span className={styles.cardLink}>Смотреть изделия</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

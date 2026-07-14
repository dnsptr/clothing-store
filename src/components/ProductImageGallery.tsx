"use client";

import { PointerEvent, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { withBasePath } from "../lib/assets";
import styles from "./ProductImageGallery.module.css";

interface ProductImageGalleryProps {
  images: string[];
  alt: string;
  href: string;
  sizes: string;
  variant?: "catalog" | "home";
}

export default function ProductImageGallery({
  images,
  alt,
  href,
  sizes,
  variant = "catalog",
}: ProductImageGalleryProps) {
  const frames = images.slice(0, 3);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const hasPreloaded = useRef(false);

  const preloadFrames = () => {
    if (hasPreloaded.current) return;

    frames.slice(1).forEach((src) => {
      const image = new window.Image();
      image.src = withBasePath(src);
    });
    hasPreloaded.current = true;
  };

  const selectFrame = (event: PointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType !== "mouse" || frames.length < 2) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width - 1);
    const nextIndex = Math.min(frames.length - 1, Math.floor((offset / bounds.width) * frames.length));

    setActiveImageIndex(nextIndex);
  };

  return (
    <Link
      href={href}
      className={`${styles.gallery} ${variant === "home" ? styles.galleryHome : ""}`}
      aria-label={`Открыть страницу товара: ${alt}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") preloadFrames();
        selectFrame(event);
      }}
      onPointerMove={selectFrame}
    >
      <Image
        key={frames[activeImageIndex]}
        src={withBasePath(frames[activeImageIndex])}
        alt={alt}
        fill
        sizes={sizes}
        className={styles.image}
      />

      {frames.length > 1 && (
        <span
          className={styles.progress}
          style={{ gridTemplateColumns: `repeat(${frames.length}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {frames.map((src, index) => (
            <span key={src} className={index === activeImageIndex ? styles.progressActive : ""} />
          ))}
        </span>
      )}
    </Link>
  );
}

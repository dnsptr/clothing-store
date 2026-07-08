"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "../context/CartContext";
import styles from "./Header.module.css";

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const { cartCount, toggleCart } = useCart();

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className={`${styles.header} ${isScrolled ? styles.scrolled : ""}`}>
      <div className={styles.container}>
        {/* Left Side: Mobile Menu Button & Desktop Nav */}
        <button className={styles.menuBtn} aria-label="Открыть меню">
          <svg
            className={styles.icon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        <nav className={styles.nav}>
          <Link href="#" className={styles.navLink}>
            Новинки
          </Link>
          <Link href="#" className={styles.navLink}>
            Женское
          </Link>
          <Link href="#" className={styles.navLink}>
            Мужское
          </Link>
          <Link href="#" className={styles.navLink}>
            О бренде
          </Link>
        </nav>

        {/* Center: Brand Logo */}
        <div className={styles.logo}>
          <Link href="/">
            <span className={styles.logoText}>MINIMALIST</span>
          </Link>
        </div>

        {/* Right Side: Action Icons */}
        <div className={styles.actions}>
          <button className={styles.actionBtn} aria-label="Поиск">
            <svg
              className={styles.icon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>

          <button className={styles.actionBtn} aria-label="Избранное">
            <svg
              className={styles.icon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </button>

          <button className={styles.actionBtn} onClick={toggleCart} aria-label="Корзина">
            <svg
              className={styles.icon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
            <span className={styles.cartBadge}>{cartCount}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "../context/CartContext";
import styles from "./Header.module.css";

function MenuIcon() {
  return (
    <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeWidth="1.4" d="M4 8h16M4 16h16" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" d="m20 20-4.6-4.6M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" d="M6.5 4.75h11v15l-5.5-3.4-5.5 3.4v-15Z" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" d="M7 9.25h10l.8 10H6.2l.8-10ZM9 9.25V7a3 3 0 0 1 6 0v2.25" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" d="M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.8 20.25a7.4 7.4 0 0 1 14.4 0" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg className={styles.locationIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" d="m5 12 14-7-7 14-1.7-6.3L5 12Z" />
    </svg>
  );
}

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const pathname = usePathname();
  const { cartCount, favoriteCount, toggleMenu } = useCart();

  const isHome = pathname === "/";
  const isSolid = !isHome || isScrolled;

  useEffect(() => {
    if (!isHome) {
      return;
    }

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 24);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isHome]);

  return (
    <header className={`${styles.header} ${isSolid ? styles.scrolled : ""}`}>
      <div className={styles.frame}>
        <div className={styles.leftSection}>
          <button className={styles.iconButton} onClick={toggleMenu} aria-label="Открыть меню">
            <MenuIcon />
          </button>

          <nav className={styles.genderNav} aria-label="Раздел каталога">
            <Link href="/catalog" className={styles.genderActive}>
              Женщинам
            </Link>
          </nav>
        </div>

        <Link href="/" className={styles.logo} aria-label="12 STOREEZ">
          <Image
            src="/12storeez-logo.svg"
            alt=""
            aria-hidden="true"
            width={193}
            height={43}
            className={`${styles.logoImage} ${styles.logoLight}`}
            priority
          />
          <Image
            src="/12storeez-logo-dark.svg"
            alt=""
            aria-hidden="true"
            width={193}
            height={43}
            className={`${styles.logoImage} ${styles.logoDark}`}
            priority
          />
        </Link>

        <div className={styles.actions}>
          <button className={styles.locationButton} aria-label="Город Москва">
            <LocationIcon />
            <span>Москва</span>
          </button>
          <button className={styles.iconButton} aria-label="Поиск">
            <SearchIcon />
          </button>
          <Link href="/favorites" className={styles.iconButton} aria-label="Избранное">
            <BookmarkIcon />
            {favoriteCount > 0 && <span className={styles.cartBadge}>{favoriteCount}</span>}
          </Link>
          <Link href="/cart" className={styles.iconButton} aria-label="Корзина">
            <BagIcon />
            {cartCount > 0 && <span className={styles.cartBadge}>{cartCount}</span>}
          </Link>
          <Link href="/account" className={styles.iconButton} aria-label="Профиль">
            <UserIcon />
          </Link>
        </div>
      </div>
    </header>
  );
}

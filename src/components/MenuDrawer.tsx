"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCart } from "../context/CartContext";
import { STOREFRONT_OUTFITS } from "../lib/collections";
import { storefrontDataMode } from "../lib/medusa";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import {
  CATALOG_SECTIONS,
  CLOTHING_CATEGORIES,
  MATERIALS,
  SALE_CATEGORIES,
  SHOES_CATEGORIES,
} from "../lib/catalog";
import styles from "./MenuDrawer.module.css";

const subMenus = {
  sale: { label: "Sale", items: SALE_CATEGORIES },
  clothing: { label: CATALOG_SECTIONS.clothing.label, items: CLOTHING_CATEGORIES },
  shoes: { label: CATALOG_SECTIONS.shoes.label, items: SHOES_CATEGORIES },
  materials: { label: "Материалы", items: MATERIALS },
};
type SubMenuType = keyof typeof subMenus;

function Chevron() {
  return (
    <svg aria-hidden="true" className={styles.chevronIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function MenuDrawer() {
  const { isMenuOpen, setIsMenuOpen } = useCart();
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuType | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const focusTargetRef = useRef<string | null>(null);
  useBodyScrollLock(isMenuOpen);
  useOverlayDismiss(isMenuOpen, () => setIsMenuOpen(false));

  useEffect(() => {
    if (!isMenuOpen) {
      const timer = setTimeout(() => setActiveSubMenu(null), 300);
      return () => clearTimeout(timer);
    }

    const trigger = document.querySelector<HTMLButtonElement>('button[aria-controls="site-menu-drawer"]');
    drawerRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("a[href], button") ?? [])
        .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
      const focusable = trigger ? [trigger, ...controls] : controls;
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex].focus();
    };
    window.addEventListener("keydown", trapFocus);
    return () => window.removeEventListener("keydown", trapFocus);
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) return;
    if (activeSubMenu) {
      backRef.current?.focus();
    } else if (focusTargetRef.current) {
      document.getElementById(focusTargetRef.current)?.focus();
      focusTargetRef.current = null;
    }
  }, [activeSubMenu, isMenuOpen]);

  const closeMenu = () => setIsMenuOpen(false);
  const goBack = () => {
    focusTargetRef.current = `menu-${activeSubMenu}`;
    setActiveSubMenu(null);
  };
  const subMenu = activeSubMenu ? subMenus[activeSubMenu] : null;

  const subMenuButton = (name: SubMenuType) => (
    <li key={name}>
      <button
        id={`menu-${name}`}
        type="button"
        className={`${styles.menuItem} ${name === "sale" ? styles.menuItemSale : ""} ${activeSubMenu === name ? styles.menuItemActive : ""}`}
        aria-expanded={activeSubMenu === name}
        aria-controls="site-menu-subpanel"
        onClick={() => {
          if (activeSubMenu === name) goBack();
          else setActiveSubMenu(name);
        }}
      >
        <span>{subMenus[name].label}</span>
        <Chevron />
      </button>
    </li>
  );

  return (
    <>
      <div
        className={`${styles.overlay} ${isMenuOpen ? styles.overlayOpen : ""}`}
        onClick={closeMenu}
        aria-hidden="true"
      />
      <nav
        ref={drawerRef}
        id="site-menu-drawer"
        aria-label="Главное меню"
        aria-hidden={!isMenuOpen}
        inert={!isMenuOpen}
        className={`${styles.drawer} ${isMenuOpen ? styles.drawerOpen : ""} ${activeSubMenu !== null ? styles.drawerExpanded : ""}`}
      >
        <div className={styles.drawerSpacer}>
          <span className={styles.drawerLabel}>Каталог</span>
        </div>
        <div className={`${styles.panelContainer} ${activeSubMenu !== null ? styles.slideSubPanel : ""}`}>
          <div className={`${styles.panel} ${activeSubMenu !== null ? styles.mainPanelInactive : ""}`}>
            <ul className={styles.menuList}>
              <li><Link className={styles.menuItem} href={CATALOG_SECTIONS.new.href} onClick={closeMenu}>{CATALOG_SECTIONS.new.label}</Link></li>
              {storefrontDataMode === "mock" && subMenuButton("sale")}
              {subMenuButton("clothing")}
              {storefrontDataMode === "mock" && subMenuButton("shoes")}
              {storefrontDataMode === "mock" && <li><Link className={styles.menuItem} href={CATALOG_SECTIONS.accessories.href} onClick={closeMenu}>{CATALOG_SECTIONS.accessories.label}</Link></li>}
              {subMenuButton("materials")}
              <li className={styles.menuDivider} aria-hidden="true" />
              {STOREFRONT_OUTFITS.map((outfit) => (
                <li key={outfit.id}>
                  <Link className={`${styles.menuItem} ${styles.menuItemCollection}`} href={`/collection/${outfit.id}`} onClick={closeMenu}>{outfit.title}</Link>
                </li>
              ))}
              <li><Link className={`${styles.menuItem} ${styles.menuItemAll}`} href="/catalog" onClick={closeMenu}>Смотреть все</Link></li>
              <li className={styles.menuDivider} aria-hidden="true" />
              {[
                { href: "/info/about", label: "О бренде" },
                { href: "/info/contacts", label: "Магазины и контакты" },
                { href: "/info/delivery", label: "Доставка" },
                { href: "/info/returns", label: "Условия возврата" },
                { href: "/account", label: "Личный кабинет" },
              ].map((item) => (
                <li key={item.href}><Link className={`${styles.menuItem} ${styles.menuItemInfo}`} href={item.href} onClick={closeMenu}>{item.label}</Link></li>
              ))}
            </ul>
          </div>
          <div id="site-menu-subpanel" className={styles.panel} inert={!subMenu} aria-hidden={!subMenu}>
            {subMenu && (
              <>
                <div className={styles.subPanelHeader}>
                  <button ref={backRef} type="button" className={styles.backBtn} onClick={goBack}>
                    <svg aria-hidden="true" className={styles.backIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 19l-7-7 7-7" />
                    </svg>
                    <span>Назад</span>
                  </button>
                  <h3 className={styles.subPanelTitle}>{subMenu.label}</h3>
                </div>
                <ul className={styles.subMenuList}>
                  {subMenu.items.map((item) => (
                    <li key={item.href + item.label}><Link className={styles.subMenuItem} href={item.href} onClick={closeMenu}>{item.label}</Link></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}

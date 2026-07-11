"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "../context/CartContext";
import { MOCK_OUTFITS } from "../data/mockData";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import {
  CATALOG_SECTIONS,
  CLOTHING_CATEGORIES,
  MATERIALS,
  SALE_CATEGORIES,
  SHOES_CATEGORIES,
} from "../lib/catalog";
import styles from "./MenuDrawer.module.css";

type SubMenuType = "sale" | "clothing" | "shoes" | "materials" | null;

function Chevron() {
  return (
    <svg className={styles.chevronIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function BackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className={styles.subPanelHeader}>
      <button className={styles.backBtn} onClick={onBack}>
        <svg className={styles.backIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 19l-7-7 7-7" />
        </svg>
        <span>Назад</span>
      </button>
      <h3 className={styles.subPanelTitle}>{label}</h3>
    </div>
  );
}

export default function MenuDrawer() {
  const router = useRouter();
  const { isMenuOpen, setIsMenuOpen, toggleMenu } = useCart();
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuType>(null);
  useBodyScrollLock(isMenuOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMenuOpen) setIsMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen, setIsMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      const timer = setTimeout(() => setActiveSubMenu(null), 300);
      return () => clearTimeout(timer);
    }
  }, [isMenuOpen]);

  const go = (path: string) => {
    setIsMenuOpen(false);
    router.push(path);
  };

  return (
    <>
      <div
        className={`${styles.overlay} ${isMenuOpen ? styles.overlayOpen : ""}`}
        onClick={toggleMenu}
      />

      <div className={`${styles.drawer} ${isMenuOpen ? styles.drawerOpen : ""}`}>
        <button className={styles.headerClose} onClick={toggleMenu} aria-label="Закрыть меню">
          <svg className={styles.closeIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className={styles.drawerSpacer} />

        <div
          className={`${styles.panelContainer} ${
            activeSubMenu !== null ? styles.slideSubPanel : ""
          }`}
        >
          <div className={styles.panel}>
            <ul className={styles.menuList}>
              <li className={styles.menuItem} onClick={() => go(CATALOG_SECTIONS.new.href)}>
                <span>{CATALOG_SECTIONS.new.label}</span>
              </li>

              <li className={`${styles.menuItem} ${styles.menuItemSale}`} onClick={() => setActiveSubMenu("sale")}>
                <span>Sale</span>
                <Chevron />
              </li>

              <li className={styles.menuItem} onClick={() => setActiveSubMenu("clothing")}>
                <span>{CATALOG_SECTIONS.clothing.label}</span>
                <Chevron />
              </li>

              <li className={styles.menuItem} onClick={() => setActiveSubMenu("shoes")}>
                <span>{CATALOG_SECTIONS.shoes.label}</span>
                <Chevron />
              </li>

              <li className={styles.menuItem} onClick={() => go(CATALOG_SECTIONS.accessories.href)}>
                <span>{CATALOG_SECTIONS.accessories.label}</span>
              </li>

              <li className={styles.menuItem} onClick={() => setActiveSubMenu("materials")}>
                <span>Материалы</span>
                <Chevron />
              </li>

              <li className={styles.menuDivider} />

              {MOCK_OUTFITS.map((outfit) => (
                <li
                  key={outfit.id}
                  className={`${styles.menuItem} ${styles.menuItemCollection}`}
                  onClick={() => go(`/collection/${outfit.id}`)}
                >
                  <span>{outfit.title}</span>
                </li>
              ))}

              <li className={`${styles.menuItem} ${styles.menuItemAll}`} onClick={() => go("/catalog")}>
                <span>Смотреть все</span>
              </li>
            </ul>
          </div>

          <div className={styles.panel}>
            {activeSubMenu === "sale" && (
              <>
                <BackHeader label="Sale" onBack={() => setActiveSubMenu(null)} />
                <ul className={styles.subMenuList}>
                  {SALE_CATEGORIES.map((item) => (
                    <li key={item.href + item.label} className={styles.subMenuItem} onClick={() => go(item.href)}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {activeSubMenu === "clothing" && (
              <>
                <BackHeader label={CATALOG_SECTIONS.clothing.label} onBack={() => setActiveSubMenu(null)} />
                <ul className={styles.subMenuList}>
                  {CLOTHING_CATEGORIES.map((item) => (
                    <li key={item.href + item.label} className={styles.subMenuItem} onClick={() => go(item.href)}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {activeSubMenu === "shoes" && (
              <>
                <BackHeader label={CATALOG_SECTIONS.shoes.label} onBack={() => setActiveSubMenu(null)} />
                <ul className={styles.subMenuList}>
                  {SHOES_CATEGORIES.map((item) => (
                    <li key={item.href + item.label} className={styles.subMenuItem} onClick={() => go(item.href)}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {activeSubMenu === "materials" && (
              <>
                <BackHeader label="Материалы" onBack={() => setActiveSubMenu(null)} />
                <ul className={styles.subMenuList}>
                  {MATERIALS.map((item) => (
                    <li key={item.slug} className={styles.subMenuItem} onClick={() => go(item.href)}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

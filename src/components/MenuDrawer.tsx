"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "../context/CartContext";
import { MOCK_OUTFITS } from "../data/mockData";
import styles from "./MenuDrawer.module.css";

type SubMenuType = "sale" | "clothing" | "shoes" | "bags" | "materials" | null;

export default function MenuDrawer() {
  const router = useRouter();
  const { isMenuOpen, setIsMenuOpen, toggleMenu } = useCart();
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuType>(null);

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

  const goCategory = (cat?: string) => {
    go(cat ? `/catalog?category=${encodeURIComponent(cat)}` : "/catalog");
  };

  // Sub-menu data
  const saleItems = [
    { name: "До 30%", cat: "" },
    { name: "До 50%", cat: "" },
    { name: "Трикотаж", cat: "Трикотаж" },
    { name: "Аксессуары", cat: "Аксессуары" },
    { name: "Все акции", cat: "" },
  ];

  const clothingItems = [
    { name: "Все товары", cat: "" },
    { name: "Пальто и тренчи", cat: "Пальто и тренчи" },
    { name: "Трикотаж", cat: "Трикотаж" },
    { name: "Брюки", cat: "Брюки" },
    { name: "Юбки и платья", cat: "Брюки" },
  ];

  const shoesItems = [
    { name: "Вся обувь", cat: "Обувь" },
    { name: "Лоферы", cat: "Обувь" },
    { name: "Босоножки", cat: "Обувь" },
  ];

  const materialsItems = [
    { name: "Натуральный лен", cat: "Брюки" },
    { name: "Премиальный шелк", cat: "Трикотаж" },
    { name: "Мягкий кашемир", cat: "Трикотаж" },
    { name: "Тонкая шерсть", cat: "Пальто и тренчи" },
  ];

  // Chevron arrow icon
  const Chevron = () => (
    <svg className={styles.chevronIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5l7 7-7 7" />
    </svg>
  );

  // Back header in sub-panel
  const BackHeader = ({ label }: { label: string }) => (
    <div className={styles.subPanelHeader}>
      <button className={styles.backBtn} onClick={() => setActiveSubMenu(null)}>
        <svg className={styles.backIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 19l-7-7 7-7" />
        </svg>
        <span>Назад</span>
      </button>
      <h3 className={styles.subPanelTitle}>{label}</h3>
    </div>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className={`${styles.overlay} ${isMenuOpen ? styles.overlayOpen : ""}`}
        onClick={toggleMenu}
      />

      {/* Drawer */}
      <div className={`${styles.drawer} ${isMenuOpen ? styles.drawerOpen : ""}`}>
        <button className={styles.headerClose} onClick={toggleMenu} aria-label="Закрыть меню">
          <svg className={styles.closeIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div style={{ height: "55px", borderBottom: "1px solid var(--border-light)" }} />

        {/* Sliding panels */}
        <div
          className={`${styles.panelContainer} ${
            activeSubMenu !== null ? styles.slideSubPanel : ""
          }`}
        >
          {/* ── LEVEL 0: Main ── */}
          <div className={styles.panel}>
            <ul className={styles.menuList}>

              {/* Новинки */}
              <li className={styles.menuItem} onClick={() => goCategory()}>
                <span>Новинки</span>
              </li>

              {/* Sale → sub */}
              <li className={`${styles.menuItem} ${styles.menuItemSale}`} onClick={() => setActiveSubMenu("sale")}>
                <span>Sale</span>
                <Chevron />
              </li>

              {/* Одежда → sub */}
              <li className={styles.menuItem} onClick={() => setActiveSubMenu("clothing")}>
                <span>Одежда</span>
                <Chevron />
              </li>

              {/* Обувь → sub */}
              <li className={styles.menuItem} onClick={() => setActiveSubMenu("shoes")}>
                <span>Обувь</span>
                <Chevron />
              </li>

              {/* Сумки и аксессуары → direct */}
              <li className={styles.menuItem} onClick={() => goCategory("Аксессуары")}>
                <span>Сумки и аксессуары</span>
              </li>

              {/* Материалы → sub */}
              <li className={styles.menuItem} onClick={() => setActiveSubMenu("materials")}>
                <span>Материалы</span>
                <Chevron />
              </li>

              {/* Divider */}
              <li className={styles.menuDivider} />

              {/* Outfit collections — direct links */}
              {MOCK_OUTFITS.map((outfit) => (
                <li
                  key={outfit.id}
                  className={`${styles.menuItem} ${styles.menuItemCollection}`}
                  onClick={() => go(`/collection/${outfit.id}`)}
                >
                  <span>{outfit.title}</span>
                </li>
              ))}

              {/* Смотреть все */}
              <li className={`${styles.menuItem} ${styles.menuItemAll}`} onClick={() => goCategory()}>
                <span>Смотреть все</span>
              </li>

            </ul>
          </div>

          {/* ── LEVEL 1: Sub-panel ── */}
          <div className={styles.panel}>

            {activeSubMenu === "sale" && (
              <>
                <BackHeader label="Sale" />
                <ul className={styles.subMenuList}>
                  {saleItems.map((item) => (
                    <li
                      key={item.name}
                      className={styles.subMenuItem}
                      onClick={() => goCategory(item.cat)}
                    >
                      {item.name}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {activeSubMenu === "clothing" && (
              <>
                <BackHeader label="Одежда" />
                <ul className={styles.subMenuList}>
                  {clothingItems.map((item) => (
                    <li
                      key={item.name}
                      className={styles.subMenuItem}
                      onClick={() => goCategory(item.cat)}
                    >
                      {item.name}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {activeSubMenu === "shoes" && (
              <>
                <BackHeader label="Обувь" />
                <ul className={styles.subMenuList}>
                  {shoesItems.map((item) => (
                    <li
                      key={item.name}
                      className={styles.subMenuItem}
                      onClick={() => goCategory(item.cat)}
                    >
                      {item.name}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {activeSubMenu === "materials" && (
              <>
                <BackHeader label="Материалы" />
                <ul className={styles.subMenuList}>
                  {materialsItems.map((item) => (
                    <li
                      key={item.name}
                      className={styles.subMenuItem}
                      onClick={() => goCategory(item.cat)}
                    >
                      {item.name}
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

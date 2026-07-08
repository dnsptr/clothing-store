"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "../context/CartContext";
import styles from "./MenuDrawer.module.css";

type SubMenuType = "clothing" | "accessories" | null;

interface CategoryItem {
  name: string;
  queryParam: string;
}

export default function MenuDrawer() {
  const router = useRouter();
  const {
    gender,
    setGender,
    isMenuOpen,
    setIsMenuOpen,
    toggleMenu,
  } = useCart();

  // Local state for tracking nested sub-menu sliding panels
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuType>(null);

  // Close left menu drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMenuOpen) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen, setIsMenuOpen]);

  // Reset menu depth when drawer closes or gender switches
  useEffect(() => {
    if (!isMenuOpen) {
      // Small timeout to prevent flickering during slide-out animation
      const timer = setTimeout(() => setActiveSubMenu(null), 300);
      return () => clearTimeout(timer);
    }
  }, [isMenuOpen]);

  useEffect(() => {
    setActiveSubMenu(null);
  }, [gender]);

  const handleGenderChange = (selectedGender: "women" | "men") => {
    setGender(selectedGender);
  };

  const handleNavigate = (categoryName?: string) => {
    setIsMenuOpen(false); // Close menu on navigation
    
    let url = "/catalog";
    const params = new URLSearchParams();
    
    params.set("gender", gender);
    if (categoryName) {
      params.set("category", categoryName);
    }
    
    router.push(`${url}?${params.toString()}`);
  };

  // Define Category lists based on active gender context
  const clothingCategories: CategoryItem[] =
    gender === "women"
      ? [
          { name: "Все товары", queryParam: "" },
          { name: "Пальто и тренчи", queryParam: "Пальто и тренчи" },
          { name: "Трикотаж", queryParam: "Трикотаж" },
          { name: "Брюки", queryParam: "Брюки" },
        ]
      : [
          { name: "Все товары", queryParam: "" },
          { name: "Верхняя одежда", queryParam: "Верхняя одежда" },
          { name: "Трикотаж", queryParam: "Трикотаж" },
          { name: "Брюки", queryParam: "Брюки" },
        ];

  const accessoriesCategories: CategoryItem[] =
    gender === "women"
      ? [
          { name: "Все аксессуары", queryParam: "" },
          { name: "Сумки", queryParam: "Аксессуары" }, // Map to accessories in mock db
          { name: "Обувь", queryParam: "Обувь" },
        ]
      : [
          { name: "Все аксессуары", queryParam: "" },
          { name: "Ремни", queryParam: "Ремни" },
          { name: "Обувь", queryParam: "Обувь" },
        ];

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={`${styles.overlay} ${isMenuOpen ? styles.overlayOpen : ""}`}
        onClick={toggleMenu}
      />

      {/* Sliding Menu Drawer */}
      <div className={`${styles.drawer} ${isMenuOpen ? styles.drawerOpen : ""}`}>
        {/* Header Close button */}
        <button className={styles.headerClose} onClick={toggleMenu} aria-label="Закрыть меню">
          <svg
            className={styles.closeIcon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Gender Switching Tabs */}
        <div className={styles.genderTabs}>
          <button
            className={`${styles.tabBtn} ${gender === "women" ? styles.tabBtnActive : ""}`}
            onClick={() => handleGenderChange("women")}
          >
            Женское
          </button>
          <button
            className={`${styles.tabBtn} ${gender === "men" ? styles.tabBtnActive : ""}`}
            onClick={() => handleGenderChange("men")}
          >
            Мужское
          </button>
        </div>

        {/* Panels Slider */}
        <div
          className={`${styles.panelContainer} ${
            activeSubMenu !== null ? styles.slideSubPanel : ""
          }`}
        >
          {/* LEVEL 0: Main Category list */}
          <div className={styles.panel}>
            <ul className={styles.menuList}>
              <li className={styles.menuItem} onClick={() => handleNavigate()}>
                <span>Новинки</span>
              </li>
              <li className={styles.menuItem} onClick={() => setActiveSubMenu("clothing")}>
                <span>Одежда</span>
                <svg
                  className={styles.chevronIcon}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </li>
              <li className={styles.menuItem} onClick={() => setActiveSubMenu("accessories")}>
                <span>Аксессуары</span>
                <svg
                  className={styles.chevronIcon}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </li>
              <li className={styles.menuItem} onClick={() => { setIsMenuOpen(false); router.push("/"); }}>
                <span>О бренде</span>
              </li>
            </ul>
          </div>

          {/* LEVEL 1: Sub-categories List Panel */}
          <div className={styles.panel}>
            {activeSubMenu === "clothing" && (
              <>
                <div className={styles.subPanelHeader}>
                  <button className={styles.backBtn} onClick={() => setActiveSubMenu(null)}>
                    <svg
                      className={styles.backIcon}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.5"
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    <span>Назад</span>
                  </button>
                  <h3 className={styles.subPanelTitle}>Одежда</h3>
                </div>
                <ul className={styles.subMenuList}>
                  {clothingCategories.map((cat) => (
                    <li
                      key={cat.name}
                      className={styles.subMenuItem}
                      onClick={() => handleNavigate(cat.queryParam)}
                    >
                      {cat.name}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {activeSubMenu === "accessories" && (
              <>
                <div className={styles.subPanelHeader}>
                  <button className={styles.backBtn} onClick={() => setActiveSubMenu(null)}>
                    <svg
                      className={styles.backIcon}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.5"
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    <span>Назад</span>
                  </button>
                  <h3 className={styles.subPanelTitle}>Аксессуары</h3>
                </div>
                <ul className={styles.subMenuList}>
                  {accessoriesCategories.map((cat) => (
                    <li
                      key={cat.name}
                      className={styles.subMenuItem}
                      onClick={() => handleNavigate(cat.queryParam)}
                    >
                      {cat.name}
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

"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "../../context/CartContext";
import { useCatalog } from "../../context/CatalogContext";
import { productImageSrc } from "../../lib/assets";
import { formatPrice, formatPriceOrUnknown } from "../../lib/format";
import { isCheckoutEnabled } from "../../lib/medusa";
import { DEFAULT_RECOMMENDATION_SIZE, findAddableVariant, selectableSizes } from "../../lib/shop";
import styles from "./cart.module.css";

function BookmarkIcon({ active = false }: { active?: boolean }) {
  return (
    <svg fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" d="M6.5 4.75h11v15l-5.5-3.4-5.5 3.4v-15Z" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" d="m6.5 6 12 12M18 6 6 18" />
    </svg>
  );
}

export default function CartPageClient() {
  const { products } = useCatalog();
  const {
    cartItems,
    cartShippingTotal,
    cartTotal,
    addToCart,
    removeFromCart,
    updateQuantity,
    isCartMutating,
    isFavorite,
    toggleFavorite,
  } = useCart();
  const [recommendationSizes, setRecommendationSizes] = useState<Record<string, string>>({});
  const recommendations = products
    .filter((product) => !cartItems.some((item) => item.product.id === product.id))
    .slice(0, 5);

  if (cartItems.length === 0) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyState}>
          <h1>Корзина пуста</h1>
          <p>Добавьте изделия, чтобы оформить заказ.</p>
          <Link href="/catalog" className={styles.catalogLink}>Перейти в каталог</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.cartLayout}>
          <div className={styles.content}>
            <section className={styles.items} aria-label="Товары в корзине">
              {cartItems.map((item, index) => {
                const itemKey = `${item.product.id}-${item.selectedSize}-${item.selectedColor.hex}-${index}`;
                const lineTotal = item.lineTotal ?? item.product.price * item.quantity;
                // Артикул строки — настоящий SKU варианта: он приходит из Medusa
                // вместе с позицией корзины. Раньше номер собирался из id товара
                // (`padStart(6, "0")`), то есть покупатель видел артикул, которого
                // нет ни в складском учёте, ни в заказе. Нет SKU — строки нет.
                const sku = item.product.variants
                  .find((variant) => variant.variantId === item.variantId)
                  ?.sku?.trim();

                return (
                  <article className={styles.item} key={itemKey}>
                    <div className={styles.productCell}>
                      {sku && <p className={styles.article}>Артикул: {sku}</p>}
                      <Link href={`/product/${item.product.id}`} className={styles.productName}>
                        {item.product.name}
                      </Link>
                    </div>

                    <div className={styles.colorCell} aria-label={`Цвет: ${item.selectedColor.name}`}>
                      <span className={styles.colorDot} style={{ backgroundColor: item.selectedColor.hex }} />
                      <span>{item.selectedColor.name}</span>
                    </div>

                    <span className={styles.sizeCell}>{item.selectedSize}</span>

                    <div className={styles.quantity} aria-label="Количество товара">
                      <button
                        type="button"
                        onClick={() => item.quantity === 1
                          ? removeFromCart(item.product.id, item.selectedSize, item.selectedColor.hex)
                          : updateQuantity(item.product.id, item.selectedSize, item.selectedColor.hex, item.quantity - 1)}
                        aria-label="Уменьшить количество"
                        disabled={isCartMutating}
                        aria-busy={isCartMutating}
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.selectedSize, item.selectedColor.hex, item.quantity + 1)}
                        aria-label="Увеличить количество"
                        disabled={isCartMutating}
                        aria-busy={isCartMutating}
                      >
                        +
                      </button>
                    </div>

                    <p className={styles.linePrice}>{formatPrice(lineTotal)}</p>
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeFromCart(item.product.id, item.selectedSize, item.selectedColor.hex)}
                      aria-label={`Удалить ${item.product.name} из корзины`}
                      disabled={isCartMutating}
                      aria-busy={isCartMutating}
                    >
                      <RemoveIcon />
                    </button>
                  </article>
                );
              })}
            </section>

            {recommendations.length > 0 && (
              <section className={styles.recommendations} aria-label="Дополните заказ">
                <h2>Дополните заказ</h2>
                <div className={styles.recommendGrid}>
                  {recommendations.map((product) => {
                    const sizes = selectableSizes(product);
                    const selectedSize = recommendationSizes[product.id] ??
                      (sizes.includes(DEFAULT_RECOMMENDATION_SIZE) ? DEFAULT_RECOMMENDATION_SIZE : sizes[0]);
                    const isSaved = isFavorite(product.id);
                    const addableVariant = findAddableVariant(product, { size: selectedSize });

                    return (
                    <article className={styles.recommendCard} key={product.id}>
                      <div className={styles.recommendImageWrap}>
                        <Link href={`/product/${product.id}`} className={styles.recommendImageLink} aria-label={product.name}>
                          <Image
                            src={productImageSrc(product.images)}
                            alt={product.name}
                            fill
                            sizes="(max-width: 767px) 45vw, 20vw"
                            className={styles.recommendImage}
                          />
                        </Link>
                        <button
                          type="button"
                          className={styles.recommendAdd}
                          onClick={() => toggleFavorite(product.id)}
                          aria-label={isSaved ? `Убрать ${product.name} из избранного` : `Добавить ${product.name} в избранное`}
                          aria-pressed={isSaved}
                        >
                          <BookmarkIcon active={isSaved} />
                        </button>
                      </div>
                      <Link href={`/product/${product.id}`} className={styles.recommendName}>{product.name}</Link>
                      <p className={styles.recommendPrice}>{formatPrice(product.price)}</p>
                      <div className={styles.recommendSizes} aria-label={`Размер для ${product.name}`}>
                        {sizes.map((size) => (
                          <button
                            key={size}
                            type="button"
                            className={`${styles.recommendSize} ${
                              selectedSize === size ? styles.recommendSizeActive : ""
                            }`}
                            onClick={() =>
                              setRecommendationSizes((previous) => ({
                                ...previous,
                                [product.id]: size,
                              }))
                            }
                            aria-pressed={selectedSize === size}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={styles.recommendCartButton}
                        onClick={() => {
                          if (!addableVariant) return;
                          addToCart({
                            product,
                            selectedSize,
                            selectedColor: product.colors[0],
                            variantId: addableVariant.variantId,
                            quantity: 1,
                          });
                        }}
                        disabled={isCartMutating || !addableVariant}
                        aria-busy={isCartMutating}
                      >
                        Добавить
                      </button>
                    </article>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <aside className={styles.summary} aria-label="Итог заказа">
            {/* Якоря #delivery/#returns/#payment вели в никуда: на странице
                корзины нет ни одного элемента с такими id. Ведём на реальные
                информационные страницы. */}
            <nav className={styles.summaryLinks} aria-label="Информация о заказе">
              <Link href="/info/delivery">Условия доставки</Link>
              <Link href="/info/returns">Условия возврата</Link>
              <Link href="/info/offer">Публичная оферта</Link>
              <Link href="/info/faq">Вопросы и ответы</Link>
            </nav>

            {/* Поле промокода убрано до реализации промоакций: у него не было
                ни value, ни onChange, ни отправки — ввести в него что-либо было
                невозможно, а вызовов Medusa promotions в проекте нет. */}

            <dl className={styles.totals}>
              <div>
                <dt>Доставка:</dt>
                <dd>{cartShippingTotal === 0 ? "Бесплатно" : formatPriceOrUnknown(cartShippingTotal)}</dd>
              </div>
              <div>
                <dt>Итого:</dt>
                <dd>{formatPriceOrUnknown(cartTotal)}</dd>
              </div>
            </dl>

            {isCheckoutEnabled ? (
              <>
                <Link href="/checkout" className={styles.checkoutButton}>Оплатить заказ</Link>
                {/* Кнопка ведёт на страницу оформления, а не заключает договор:
                    утверждать, что нажатием покупатель уже с чем-то согласился,
                    нельзя. Согласие фиксируется отдельным чекбоксом в чекауте. */}
                <p className={styles.summaryNote}>
                  Условия покупки — в публичной оферте. Согласие с офертой и политикой
                  обработки персональных данных подтверждается на шаге оформления заказа.
                </p>
              </>
            ) : (
              // Кнопка ведёт на страницу, которая всё равно откажет: ведём себя
              // честно здесь, а не после лишнего перехода.
              <>
                <button type="button" className={styles.checkoutButton} disabled>
                  Оплатить заказ
                </button>
                <p className={styles.summaryNote}>
                  Онлайн-оплата ещё подключается. Корзина сохранится — оформить заказ
                  можно будет сразу после запуска приёма платежей.
                </p>
              </>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

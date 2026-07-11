"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "../../context/CartContext";
import { MOCK_PRODUCTS } from "../../data/mockData";
import { formatPrice } from "../../lib/format";
import { DEFAULT_RECOMMENDATION_SIZE, DELIVERY } from "../../lib/shop";
import styles from "./cart.module.css";

function BookmarkIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
  const { cartItems, cartTotal, addToCart, removeFromCart, updateQuantity } = useCart();
  const delivery = cartTotal >= DELIVERY.cartFreeThreshold ? 0 : DELIVERY.cartPrice;
  const recommendations = MOCK_PRODUCTS
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
                const lineTotal = item.product.price * item.quantity;

                return (
                  <article className={styles.item} key={itemKey}>
                    <div className={styles.productCell}>
                      <p className={styles.article}>Артикул: {item.product.id.padStart(6, "0")}</p>
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
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.product.id, item.selectedSize, item.selectedColor.hex, item.quantity + 1)}
                        aria-label="Увеличить количество"
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
                  {recommendations.map((product) => (
                    <article className={styles.recommendCard} key={product.id}>
                      <div className={styles.recommendImageWrap}>
                        <Link href={`/product/${product.id}`} className={styles.recommendImageLink} aria-label={product.name}>
                          <Image
                            src={product.images[0]}
                            alt={product.name}
                            fill
                            sizes="(max-width: 767px) 45vw, 20vw"
                            className={styles.recommendImage}
                          />
                        </Link>
                        <button
                          type="button"
                          className={styles.recommendAdd}
                          onClick={() => addToCart({
                            product,
                            selectedSize: DEFAULT_RECOMMENDATION_SIZE,
                            selectedColor: product.colors[0],
                            quantity: 1,
                          })}
                          aria-label={`Добавить ${product.name} в корзину`}
                        >
                          <BookmarkIcon />
                        </button>
                      </div>
                      <Link href={`/product/${product.id}`} className={styles.recommendName}>{product.name}</Link>
                      <p className={styles.recommendPrice}>{formatPrice(product.price)}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className={styles.summary} aria-label="Итог заказа">
            <nav className={styles.summaryLinks} aria-label="Информация о заказе">
              <Link href="/account">Войти в личный кабинет</Link>
              <Link href="#delivery">Условия доставки</Link>
              <Link href="#returns">Условия обмена и возврата</Link>
              <Link href="#payment">Информация об оплате</Link>
            </nav>

            <label className={styles.promoControl}>
              <span>Промокод или подарочный сертификат</span>
              <input type="text" aria-label="Промокод или подарочный сертификат" />
            </label>

            <dl className={styles.totals}>
              <div>
                <dt>Доставка:</dt>
                <dd>{delivery === 0 ? "Бесплатно" : formatPrice(delivery)}</dd>
              </div>
              <div>
                <dt>Итого:</dt>
                <dd>{formatPrice(cartTotal + delivery)}</dd>
              </div>
            </dl>

            <Link href="/checkout" className={styles.checkoutButton}>Оплатить заказ</Link>
            <p className={styles.summaryNote}>
              Нажимая на кнопку «Оплатить заказ», вы соглашаетесь с условиями обработки персональных данных и публичной офертой.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}

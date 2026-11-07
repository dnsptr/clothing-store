"use client";

import { useEffect, useState, useCallback, type FormEvent } from "react";
import Link from "next/link";
import { accountRequest, AccountError, type AccountCustomer, type AccountOrder } from "../../lib/account";
import { getStoredCartId, useCart } from "../../context/CartContext";
import { storefrontDataMode } from "../../lib/medusa";
import styles from "./account.module.css";

const errorText = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить запрос. Попробуйте ещё раз.";

function AuthForm({ onSignedIn }: { onSignedIn: (customer: AccountCustomer) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const { customer } = await accountRequest<{ customer: AccountCustomer }>(mode, {
        email: data.get("email"), password: data.get("password"),
        ...(mode === "register" ? { first_name: data.get("first_name"), last_name: data.get("last_name"), password_confirmation: data.get("password_confirmation"), consent: data.get("consent") === "on" } : {}),
      });
      onSignedIn(customer);
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <section className={styles.loginZone} aria-label="Вход и регистрация">
    <div className={styles.authPanel}>
      <h1>Личный кабинет</h1>
      <div className={styles.authModes} role="group" aria-label="Вход или регистрация">
        <button type="button" aria-pressed={mode === "login"} disabled={busy} onClick={() => { setMode("login"); setError(""); }}>Войти</button>
        <button type="button" aria-pressed={mode === "register"} disabled={busy} onClick={() => { setMode("register"); setError(""); }}>Регистрация</button>
      </div>
      <form className={styles.form} onSubmit={submit} key={mode}>
        <fieldset className={styles.fields} disabled={busy}>
          {mode === "register" && <>
            <label className={styles.field}>Имя<input className={styles.input} name="first_name" autoComplete="given-name" maxLength={80} required /></label>
            <label className={styles.field}>Фамилия<input className={styles.input} name="last_name" autoComplete="family-name" maxLength={80} /></label>
          </>}
          <label className={styles.field}>Email<input className={styles.input} name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <label className={styles.field}>Пароль<input className={styles.input} name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : undefined} maxLength={128} required /></label>
          {mode === "register" && <>
            <p className={styles.helperText}>Не менее 8 символов</p>
            <label className={styles.field}>Повторите пароль<input className={styles.input} name="password_confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
            <label className={styles.consent}><input name="consent" type="checkbox" required /><span>Даю <Link href="/info/consent" target="_blank" rel="noopener noreferrer">согласие на обработку персональных данных</Link> и принимаю <Link href="/info/privacy" target="_blank" rel="noopener noreferrer">политику обработки персональных данных</Link>.</span></label>
          </>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Подождите…" : mode === "register" ? "Создать аккаунт" : "Войти"}</button>
        </fieldset>
      </form>
    </div>
  </section>;
}

function Profile({ customer, onChange, onExpired }: { customer: AccountCustomer; onChange: (customer: AccountCustomer) => void; onExpired: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(""); setSaved(false);
    try {
      const result = await accountRequest<{ customer: AccountCustomer }>("profile", { first_name: data.get("first_name"), last_name: data.get("last_name"), phone: data.get("phone") });
      onChange(result.customer); setSaved(true);
    } catch (error) {
      if (error instanceof AccountError && error.status === 401) onExpired();
      else setError(errorText(error));
    } finally { setBusy(false); }
  }
  return <section aria-labelledby="profile-title" className={styles.profile}>
    <h2 id="profile-title">Личные данные</h2>
    <form className={styles.form} onSubmit={submit} onChange={() => setSaved(false)}>
      <fieldset className={styles.fields} disabled={busy}>
        <label className={styles.field}>Имя<input className={styles.input} name="first_name" autoComplete="given-name" defaultValue={customer.first_name} maxLength={80} required /></label>
        <label className={styles.field}>Фамилия<input className={styles.input} name="last_name" autoComplete="family-name" defaultValue={customer.last_name} maxLength={80} /></label>
        <label className={styles.field}>Email<input className={styles.input} type="email" autoComplete="email" value={customer.email} readOnly /></label>
        <label className={styles.field}>Телефон<input className={styles.input} name="phone" type="tel" autoComplete="tel" defaultValue={customer.phone} maxLength={32} /></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {saved && <p className={styles.helperText} role="status">Данные сохранены</p>}
        <button className={styles.primaryButton} disabled={busy} type="submit">{busy ? "Сохраняем…" : "Сохранить изменения"}</button>
      </fieldset>
    </form>
  </section>;
}

const statuses: Record<string, string> = { pending: "В обработке", completed: "Выполнен", canceled: "Отменён", archived: "В архиве", requires_action: "Требует внимания" };
const money = (value: number, currency: string) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : "RUB", maximumFractionDigits: 2 }).format(value);

function Orders({ onExpired }: { onExpired: () => void }) {
  const [data, setData] = useState<{ orders: AccountOrder[]; count: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    accountRequest<{ orders: AccountOrder[]; count: number }>("orders", undefined, controller.signal).then(setData).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof AccountError && error.status === 401) onExpired();
      else setError(errorText(error));
    });
    return () => controller.abort();
  }, [retry, onExpired]);
  async function loadMore() {
    if (!data || busy) return;
    setBusy(true); setError("");
    try {
      const next = await accountRequest<{ orders: AccountOrder[]; count: number }>(`orders?offset=${data.orders.length}`);
      setData({ orders: [...data.orders, ...next.orders], count: next.count });
    } catch (error) {
      if (error instanceof AccountError && error.status === 401) onExpired();
      else setError(errorText(error));
    } finally { setBusy(false); }
  }
  return <section className={styles.orders} aria-labelledby="orders-title">
    <h2 id="orders-title">Мои заказы</h2>
    {error && <div role="alert"><p className={styles.error}>{error}</p><button className={styles.methodButton} type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Повторить</button></div>}
    {!data && !error && <p className={styles.helperText} role="status">Загружаем заказы…</p>}
    {data?.orders.length === 0 && <div className={styles.empty}><p>Пока нет заказов</p><Link href="/catalog" className={styles.catalogLink}>Перейти в каталог</Link></div>}
    {data?.orders.map(order => <details className={styles.order} key={order.id}>
      <summary><span>Заказ № {order.display_id}<small>{new Date(order.created_at).toLocaleDateString("ru-RU")}</small></span><span>{statuses[order.status] || "В обработке"}</span><span>{money(order.total, order.currency_code)}</span></summary>
      <ul>{order.items.map(item => <li key={item.id}><span>{item.title} × {item.quantity}</span><span>{money(item.unit_price * item.quantity, order.currency_code)}</span></li>)}</ul>
    </details>)}
    {data && data.orders.length < data.count && <button type="button" className={styles.methodButton} disabled={busy} onClick={() => void loadMore()}>{busy ? "Загружаем…" : "Показать ещё"}</button>}
  </section>;
}

function AccountPanel({ customer, onChange, onLogout }: { customer: AccountCustomer; onChange: (customer: AccountCustomer) => void; onLogout: () => void }) {
  const [tab, setTab] = useState("profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { clearCart } = useCart();
  const expired = useCallback(() => { clearCart(); onLogout(); }, [clearCart, onLogout]);
  useEffect(() => {
    const cartId = getStoredCartId();
    if (!cartId) return;
    const controller = new AbortController();
    accountRequest("cart", { cart_id: cartId }, controller.signal).catch(error => {
      if (!controller.signal.aborted) setNotice(error instanceof AccountError && error.status === 401 ? "Сессия истекла. Войдите ещё раз." : "Не удалось связать текущую корзину с аккаунтом. Попробуйте войти ещё раз.");
    });
    return () => controller.abort();
  }, []);
  async function logout() {
    setBusy(true); setError("");
    try { await accountRequest("logout", {}); clearCart(); onLogout(); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <div className={styles.accountShell}>
    <header className={styles.accountHeading}><div><h1>Личный кабинет</h1><p>{customer.first_name || customer.email}</p></div><button type="button" className={styles.logoutButton} onClick={() => void logout()} disabled={busy}>{busy ? "Выходим…" : "Выйти"}</button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.helperText} role="status">{notice}</p>}
    <div className={styles.accountBody}>
      <nav className={styles.navigation} aria-label="Разделы личного кабинета">
        <button type="button" aria-current={tab === "profile" ? "page" : undefined} onClick={() => setTab("profile")}>Личные данные</button>
        <button type="button" aria-current={tab === "orders" ? "page" : undefined} onClick={() => setTab("orders")}>Мои заказы</button>
        <Link href="/favorites">Избранное</Link>
      </nav>
      {tab === "profile" ? <Profile customer={customer} onChange={onChange} onExpired={expired} /> : <Orders onExpired={expired} />}
    </div>
  </div>;
}

export default function AccountClient() {
  const [customer, setCustomer] = useState<AccountCustomer | null>(null);
  const [loading, setLoading] = useState(storefrontDataMode === "medusa");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (storefrontDataMode !== "medusa") return;
    const controller = new AbortController();
    accountRequest<{ customer: AccountCustomer | null }>("session", undefined, controller.signal).then(data => setCustomer(data.customer)).catch(error => {
      if (!controller.signal.aborted) setError(errorText(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  const signedOut = useCallback(() => setCustomer(null), []);
  if (storefrontDataMode !== "medusa") return <main className={styles.page}><section className={styles.loginZone}><div className={styles.authPanel}><h1>Личный кабинет</h1><p className={styles.helperText}>Регистрация и вход доступны на основном сайте.</p><a href="https://www.mariomikke.shop/account" className={styles.catalogLink}>Открыть личный кабинет</a></div></section></main>;
  return <main className={styles.page}>
    {loading ? <div className={styles.loginZone}><p role="status">Загружаем личный кабинет…</p></div> : error ? <section className={styles.loginZone}><div className={styles.authPanel}><h1>Личный кабинет</h1><p className={styles.error} role="alert">{error}</p><button type="button" className={styles.methodButton} onClick={() => { setLoading(true); setError(""); setRetry(value => value + 1); }}>Повторить</button></div></section> : customer ? <AccountPanel key={customer.id} customer={customer} onChange={setCustomer} onLogout={signedOut} /> : <AuthForm onSignedIn={setCustomer} />}
  </main>;
}

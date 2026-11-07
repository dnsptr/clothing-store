import "server-only";
import { AccountError, type AccountCustomer, type AccountOrder } from "./account";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

export function accountCredentials(input: RecordValue, registration = false) {
  const email = text(input.email).trim().toLowerCase();
  const password = text(input.password);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError("Укажите корректный email.");
  if (!password || password.length > 128 || (registration && password.length < 8)) throw new AccountError(registration ? "Пароль должен содержать от 8 до 128 символов." : "Укажите пароль.");
  if (registration && password !== input.password_confirmation) throw new AccountError("Пароли не совпадают.");
  if (registration && input.consent !== true) throw new AccountError("Для регистрации необходимо согласие на обработку персональных данных.");
  return { email, password };
}

export function accountProfile(input: RecordValue) {
  const first_name = text(input.first_name).trim();
  const last_name = text(input.last_name).trim();
  const phone = text(input.phone).trim();
  if (!first_name || first_name.length > 80 || last_name.length > 80) throw new AccountError("Укажите имя длиной до 80 символов.");
  if (phone && (phone.length > 32 || !/^\+?[\d\s()\-]+$/.test(phone) || phone.replace(/\D/g, "").length < 10 || phone.replace(/\D/g, "").length > 15)) throw new AccountError("Проверьте номер телефона.");
  return { first_name, last_name, phone };
}

function customerFrom(value: unknown): AccountCustomer {
  const customer = record(record(value).customer);
  if (!text(customer.id) || !text(customer.email)) throw new AccountError("Не удалось загрузить профиль.", 502);
  return { id: text(customer.id), email: text(customer.email), first_name: text(customer.first_name), last_name: text(customer.last_name), phone: text(customer.phone) };
}

function tokenFrom(value: unknown): string {
  const token = text(record(value).token);
  if (!token) throw new AccountError("Не удалось завершить вход.", 502);
  return token;
}

export function createAccountService(fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env) {
  const base = (env.MEDUSA_BACKEND_URL || env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "").replace(/\/$/, "");
  const key = env.MEDUSA_PUBLISHABLE_KEY || env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;

  async function request(endpoint: string, token?: string, body?: unknown) {
    if (!base || !key || (env.DATA_MODE || env.NEXT_PUBLIC_DATA_MODE) !== "medusa") throw new AccountError("Личный кабинет временно недоступен. Попробуйте позже.", 503);
    let response: Response;
    try {
      response = await fetcher(base + endpoint, {
        method: body === undefined ? "GET" : "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-publishable-api-key": key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw new AccountError("Сервис временно недоступен. Попробуйте ещё раз.", 503); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new AccountError("Необходимо войти в личный кабинет.", 401);
      if (response.status === 429) throw new AccountError("Слишком много попыток. Попробуйте немного позже.", 429);
      if (response.status >= 500) throw new AccountError("Сервис временно недоступен. Попробуйте ещё раз.", 503);
      throw new AccountError("Не удалось сохранить данные. Проверьте поля и попробуйте ещё раз.", response.status);
    }
    try { return record(await response.json()); } catch { throw new AccountError("Сервис вернул некорректный ответ.", 502); }
  }

  const customer = async (token: string) => customerFrom(await request("/store/customers/me", token));

  async function login(input: RecordValue) {
    const credentials = accountCredentials(input);
    let token: string;
    try { token = tokenFrom(await request("/auth/customer/emailpass", undefined, credentials)); }
    catch (error) {
      if (error instanceof AccountError && error.status === 401) throw new AccountError("Неверный email или пароль.", 401);
      throw error;
    }
    try { return { token, customer: await customer(token) }; }
    catch (error) {
      if (!(error instanceof AccountError) || error.status !== 401) throw error;
      // Recover an identity if account creation was interrupted after signup.
      await request("/store/customers", token, { email: credentials.email });
      token = tokenFrom(await request("/auth/token/refresh", token, {}));
      return { token, customer: await customer(token) };
    }
  }

  async function register(input: RecordValue) {
    const credentials = accountCredentials(input, true);
    const profile = accountProfile(input);
    let token: string;
    try { token = tokenFrom(await request("/auth/customer/emailpass/register", undefined, credentials)); }
    catch (error) {
      if (error instanceof AccountError && [400, 401, 409, 422].includes(error.status)) throw new AccountError("Не удалось зарегистрировать этот email. Если аккаунт уже есть, войдите с вашим паролем.", 409);
      throw error;
    }
    await request("/store/customers", token, {
      email: credentials.email, ...profile,
      metadata: { registration_consent: { accepted: true, accepted_at: new Date().toISOString(), document: "/info/consent", policy: "/info/privacy", source: "storefront-account" } },
    });
    token = tokenFrom(await request("/auth/token/refresh", token, {}));
    return { token, customer: await customer(token) };
  }

  async function profile(token: string, input: RecordValue) {
    return customerFrom(await request("/store/customers/me", token, accountProfile(input)));
  }

  async function orders(token: string, offset: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new AccountError("Некорректная страница заказов.");
    const query = new URLSearchParams({ limit: "20", offset: String(offset), order: "-created_at", fields: "id,display_id,status,created_at,total,currency_code,*items" });
    const data = await request(`/store/orders?${query}`, token);
    if (!Array.isArray(data.orders) || typeof data.count !== "number" || !Number.isSafeInteger(data.count) || data.count < 0) throw new AccountError("Не удалось загрузить заказы.", 502);
    const orders: AccountOrder[] = data.orders.map(value => {
      const row = record(value);
      if (!text(row.id) || !Number.isFinite(Number(row.total)) || !Number.isSafeInteger(Number(row.display_id)) || !Number.isFinite(Date.parse(text(row.created_at)))) throw new AccountError("Не удалось прочитать данные заказа.", 502);
      return { id: text(row.id), display_id: Number(row.display_id), created_at: text(row.created_at), status: text(row.status), total: Number(row.total), currency_code: text(row.currency_code),
        items: (Array.isArray(row.items) ? row.items : []).map(value => { const item = record(value); return { id: text(item.id), title: text(item.title), quantity: Number(item.quantity), unit_price: Number(item.unit_price) }; }),
      };
    });
    return { orders, count: data.count };
  }

  async function cart(token: string | undefined, input: RecordValue) {
    const id = text(input.cart_id);
    if (id && !/^cart_[a-zA-Z0-9]+$/.test(id)) throw new AccountError("Некорректная корзина.");
    if (id && !token) return { linked: false };
    const owner = token ? await customer(token) : null;
    if (id) {
      const previous = record((await request(`/store/carts/${id}?fields=id,customer_id,customer.has_account`, token)).cart);
      if (previous.customer_id && previous.customer_id !== owner?.id && record(previous.customer).has_account !== false) throw new AccountError("Эта корзина связана с другим аккаунтом. Выйдите из кабинета и создайте новую корзину.", 409);
      await request(`/store/carts/${id}/customer`, token, {});
      return { linked: true };
    }
    const region = env.MEDUSA_REGION_ID || env.NEXT_PUBLIC_MEDUSA_REGION_ID || text(input.region_id);
    if (region && !/^reg_[a-zA-Z0-9]+$/.test(region)) throw new AccountError("Некорректный регион.");
    const result = await request("/store/carts", undefined, region ? { region_id: region } : {});
    const cartId = text(record(result.cart).id);
    if (!cartId) throw new AccountError("Не удалось создать корзину.", 502);
    if (token) return request(`/store/carts/${cartId}/customer`, token, {});
    return result;
  }

  return { customer, login, register, profile, orders, cart };
}

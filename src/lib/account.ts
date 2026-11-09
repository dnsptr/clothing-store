export interface AccountCustomer {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
}

export interface AccountOrder {
  id: string;
  display_id: number;
  created_at: string;
  status: string;
  total: number;
  currency_code: string;
  items: { id: string; title: string; quantity: number; unit_price: number }[];
}

export class AccountError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "AccountError";
  }
}

export async function accountRequest<T>(action: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/account/${action}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  }); } catch (error) {
    if (signal?.aborted) throw error;
    throw new AccountError("Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.", 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new AccountError(data?.message || "Не удалось выполнить запрос. Попробуйте ещё раз.", response.status);
  if (!data || typeof data !== "object") throw new AccountError("Не удалось получить данные. Попробуйте ещё раз.", 502);
  return data as T;
}

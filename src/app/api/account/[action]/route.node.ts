import { NextRequest, NextResponse } from "next/server";
import { AccountError } from "@/lib/account";
import { createAccountService } from "@/lib/account-server";

const COOKIE = "mm_customer_session";
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 86400 };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
type Context = { params: Promise<{ action: string }> };
const service = createAccountService();

function reply(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }
function failure(error: unknown) {
  return reply({ message: error instanceof AccountError ? error.message : "Не удалось выполнить запрос. Попробуйте ещё раз." }, error instanceof AccountError ? error.status : 500);
}
function clearCookie(response: NextResponse) { response.cookies.set(COOKIE, "", { ...cookieOptions, maxAge: 0 }); return response; }

function isSameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || /[\\/?#@,%\s]/.test(host)) return false;
  try {
    const source = new URL(origin);
    if (source.protocol !== "https:" && (process.env.NODE_ENV === "production" || source.protocol !== "http:")) return false;
    if (source.origin !== origin) return false;
    // NextURL can describe the internal HTTP listener behind a TLS proxy.
    // Compare the actual Host authority; forwarded headers are not trusted.
    return source.origin === new URL(`${source.protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest, context: Context) {
  const { action } = await context.params;
  if (!["session", "orders"].includes(action)) return reply({ message: "Страница не найдена." }, 404);
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return action === "session" ? reply({ customer: null }) : reply({ message: "Необходимо войти в личный кабинет." }, 401);
  try {
    if (action === "session") return reply({ customer: await service.customer(token) });
    return reply(await service.orders(token, Number(request.nextUrl.searchParams.get("offset") || 0)));
  } catch (error) {
    if (error instanceof AccountError && error.status === 401) return clearCookie(action === "session" ? reply({ customer: null }) : failure(error));
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { action } = await context.params;
  if (!["login", "register", "logout", "profile", "cart"].includes(action)) return reply({ message: "Страница не найдена." }, 404);
  if (!isSameOrigin(request)) return reply({ message: "Недопустимый источник запроса." }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ message: "Ожидается JSON." }, 415);
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 4096) return reply({ message: "Слишком большой запрос." }, 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return reply({ message: "Некорректный запрос." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ message: "Некорректный запрос." }, 400);
    if (action === "logout") return clearCookie(reply({ success: true }));
    if (action === "login" || action === "register") {
      const { token, customer } = await service[action](body);
      const response = reply({ customer });
      response.cookies.set(COOKIE, token, cookieOptions);
      return response;
    }
    const token = request.cookies.get(COOKIE)?.value;
    if (action === "cart") {
      return reply(await service.cart(token, body));
    }
    if (!token) return reply({ message: "Необходимо войти в личный кабинет." }, 401);
    return reply({ customer: await service.profile(token, body) });
  } catch (error) {
    return error instanceof AccountError && error.status === 401 ? clearCookie(failure(error)) : failure(error);
  }
}

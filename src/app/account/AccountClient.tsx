"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import styles from "./account.module.css";

type AuthMethod = "phone" | "email";

export default function AccountClient() {
  const [method, setMethod] = useState<AuthMethod>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"details" | "code" | "complete">("details");
  const [error, setError] = useState("");

  const value = method === "phone" ? phone : email;
  const isValid = method === "phone"
    ? phone.replace(/\D/g, "").length >= 10
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const requestCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValid) {
      setError(method === "phone" ? "Введите номер телефона полностью" : "Введите корректный e-mail");
      return;
    }

    setError("");
    setStep("code");
  };

  const confirmCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (code.length < 4) {
      setError("Введите код из сообщения");
      return;
    }

    setError("");
    setStep("complete");
  };

  const switchMethod = (nextMethod: AuthMethod) => {
    setMethod(nextMethod);
    setError("");
  };

  return (
    <main className={styles.page}>
      <section className={styles.loginZone} aria-label="Вход в личный кабинет">
        <div className={styles.authPanel}>
          {step === "details" && (
            <>
              <h1>Вход или регистрация</h1>
              <form className={styles.form} onSubmit={requestCode} noValidate>
                {method === "phone" ? (
                  <label className={styles.phoneInput}>
                    <span>+7</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      aria-label="Номер телефона"
                      placeholder="Номер телефона"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </label>
                ) : (
                  <input
                    className={styles.input}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    aria-label="Электронная почта"
                    placeholder="Ваш e-mail"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                )}
                {error && <p className={styles.error}>{error}</p>}
                <button className={styles.primaryButton} type="submit" disabled={!isValid}>
                  Далее
                </button>
              </form>
              <button
                type="button"
                className={styles.methodButton}
                onClick={() => switchMethod(method === "phone" ? "email" : "phone")}
              >
                {method === "phone" ? "Войти через эл. почту" : "Войти по номеру телефона"}
              </button>
            </>
          )}

          {step === "code" && (
            <>
              <h1>Введите код из сообщения</h1>
              <p className={styles.helperText}>Код отправлен на {value}</p>
              <form className={styles.form} onSubmit={confirmCode} noValidate>
                <input
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label="Код из сообщения"
                  placeholder="Код из сообщения"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                />
                {error && <p className={styles.error}>{error}</p>}
                <button className={styles.primaryButton} type="submit" disabled={code.length < 4}>
                  Войти
                </button>
              </form>
              <button type="button" className={styles.methodButton} onClick={() => setStep("details")}>
                Изменить данные
              </button>
            </>
          )}

          {step === "complete" && (
            <>
              <h1>Вы вошли в личный кабинет</h1>
              <p className={styles.helperText}>История заказов и сохранённые изделия появятся здесь.</p>
              <Link href="/catalog" className={styles.catalogLink}>
                Перейти в каталог
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

import { MedusaError } from "@medusajs/framework/utils";

export class TBankAttemptPersistenceError extends MedusaError {
  readonly name = "TBankAttemptPersistenceError";
  readonly cause: unknown;

  constructor(sessionId: string, cause: unknown) {
    super(
      MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      `tbank: не удалось надёжно сохранить попытку платежа для сессии ${sessionId}; Init не выполнен`,
    );
    this.cause = cause;
  }
}

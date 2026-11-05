import "server-only";

/** Аккаунт отключен оператором: вход закрывается (ADR-061). */
export class AccountDisabledError extends Error {
  constructor() {
    super("ACCOUNT_DISABLED");
    this.name = "AccountDisabledError";
  }
}

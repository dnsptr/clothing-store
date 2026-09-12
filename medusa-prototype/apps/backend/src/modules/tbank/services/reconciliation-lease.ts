import type { TbankNotificationStore } from "./reconciliation-contracts";

export class StaleLeaseError extends Error {
  readonly name = "StaleLeaseError";
  constructor(readonly notificationId: string) {
    super(`T-Bank inbox lease lost or expired for notification ${notificationId}`);
  }
}

export class LeaseController {
  constructor(
    private readonly store: TbankNotificationStore,
    private readonly id: string,
    private readonly leaseToken: string,
  ) {}

  private requireMutation(rows: readonly unknown[]): void {
    if (rows.length === 0) throw new StaleLeaseError(this.id);
  }

  async renew(): Promise<void> {
    this.requireMutation(await this.store.renewInboxLease({
      id: this.id,
      leaseToken: this.leaseToken,
      now: new Date(),
    }));
  }

  async complete(): Promise<void> {
    this.requireMutation(await this.store.completeInbox({
      id: this.id,
      leaseToken: this.leaseToken,
      now: new Date(),
    }));
  }

  async fail(): Promise<{ readonly lifecycle_state?: string; readonly attempt_count?: number }> {
    const rows = await this.store.failInbox({
      id: this.id,
      leaseToken: this.leaseToken,
      now: new Date(),
    });
    this.requireMutation(rows);
    return rows[0] ?? {};
  }

  async quarantine(): Promise<void> {
    this.requireMutation(await this.store.quarantineManualReview({
      id: this.id,
      leaseToken: this.leaseToken,
      now: new Date(),
    }));
  }

  async around<T>(sideEffect: () => Promise<T>): Promise<T> {
    await this.renew();
    const result = await sideEffect();
    await this.renew();
    return result;
  }
}

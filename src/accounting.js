import { randomUUID } from "node:crypto";

export class PaymentLedger {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.entries = [];
  }

  recordSettlement(route, metadata = {}) {
    const paymentId = metadata.paymentId ?? cryptoRandomId();
    const settledAt = this.clock().toISOString();

    this.entries.push({
      paymentId,
      settledAt,
      account: "lightning:merchant_payable",
      debitMsat: route.amountMsat,
      creditMsat: 0,
      metadata
    });
    this.entries.push({
      paymentId,
      settledAt,
      account: "expense:lightning_routing_fees",
      debitMsat: route.totalFeeMsat,
      creditMsat: 0,
      metadata
    });
    this.entries.push({
      paymentId,
      settledAt,
      account: "lightning:wallet",
      debitMsat: 0,
      creditMsat: route.totalDebitMsat,
      metadata
    });

    return paymentId;
  }

  trialBalance() {
    const byAccount = new Map();
    for (const entry of this.entries) {
      const current = byAccount.get(entry.account) ?? { debitMsat: 0, creditMsat: 0 };
      current.debitMsat += entry.debitMsat;
      current.creditMsat += entry.creditMsat;
      byAccount.set(entry.account, current);
    }
    return [...byAccount.entries()].map(([account, totals]) => ({ account, ...totals }));
  }
}

function cryptoRandomId() {
  return `pay_${randomUUID()}`;
}

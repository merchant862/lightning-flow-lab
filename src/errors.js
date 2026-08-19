export class LightningFlowError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}

export class RouteNotFoundError extends LightningFlowError {}

export class InsufficientLiquidityError extends LightningFlowError {}

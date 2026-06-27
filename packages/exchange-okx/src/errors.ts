export class OkxAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OkxAdapterError";
  }
}

export class OkxHttpError extends OkxAdapterError {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OkxHttpError";
  }
}

export class OkxApiError extends OkxAdapterError {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OkxApiError";
  }
}

export class OkxDepositVerificationError extends OkxAdapterError {
  constructor(message: string) {
    super(message);
    this.name = "OkxDepositVerificationError";
  }
}

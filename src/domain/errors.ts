export type ErrorCode =
  | "invalid_path"
  | "unsupported_extension"
  | "not_found"
  | "conflict"
  | "io"
  | "serialization"
  | "unknown";

export type GatewayErrorPayload = {
  code: ErrorCode;
  message: string;
  details?: string;
};

export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly details?: string;

  constructor(payload: GatewayErrorPayload) {
    super(payload.message);
    this.name = "GatewayError";
    this.code = payload.code;
    this.details = payload.details;
  }
}

export function mapGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;

  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<GatewayErrorPayload>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return new GatewayError({
        code: candidate.code as ErrorCode,
        message: candidate.message,
        details: typeof candidate.details === "string" ? candidate.details : undefined,
      });
    }
  }

  return new GatewayError({
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
  });
}

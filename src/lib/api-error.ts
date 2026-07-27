export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    // Absent and null both mean "no details" (BACKEND_V1 §0 `details` rule).
    public details?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
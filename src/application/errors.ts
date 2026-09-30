export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) {
    super(message);
  }
}
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const unavailable = () => new AppError(503, 'dependency_unavailable', 'A dependency is temporarily unavailable. Retry with the same request key.', true);

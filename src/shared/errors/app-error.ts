export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not-found'
  | 'conflict'
  | 'network'
  | 'realtime'
  | 'unexpected';

export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly status: number | undefined;

  constructor(category: ErrorCategory, safeMessage: string, status?: number) {
    super(safeMessage);
    this.name = 'AppError';
    this.category = category;
    this.status = status;
  }
}

export type AppErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'already-exists'
  | 'aborted'
  | 'resource-exhausted'
  | 'internal';

/** Error with a code that maps 1:1 onto Firebase HttpsError codes. Messages are safe to show users. */
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const deny = (msg = 'You do not have permission to perform this action.') => new AppError('permission-denied', msg);
export const notFound = (what = 'Record') => new AppError('not-found', `${what} not found.`);
export const invalid = (msg: string, details?: unknown) => new AppError('invalid-argument', msg, details);
export const precondition = (msg: string) => new AppError('failed-precondition', msg);
export const conflict = (msg = 'This record was changed by someone else. Reload and try again.') => new AppError('aborted', msg);

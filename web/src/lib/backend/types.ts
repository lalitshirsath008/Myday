export interface Session {
  uid: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get fieldErrors(): Record<string, string> {
    const d = this.details as { fields?: Record<string, string> } | undefined;
    return d?.fields ?? {};
  }
}

/** Sign-in error codes surfaced to the login screen. */
export type SignInError = 'invalid-credential' | 'user-disabled' | 'too-many-requests' | 'network' | 'unknown';

export class AuthFailure extends Error {
  constructor(public readonly reason: SignInError) {
    super(reason);
  }
}

/**
 * Everything the UI needs from a backend. The Firebase implementation is used in production;
 * the demo implementation runs the same server logic in the browser on fictional test data.
 */
export interface Backend {
  mode: 'firebase' | 'demo' | 'live';
  onAuthChange(cb: (session: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  call(op: string, payload: unknown): Promise<unknown>;
  sendPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(oobCode: string, newPassword: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  resetDemoData?(): Promise<void>;
}

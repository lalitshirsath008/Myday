/** Server-side identity operations. Firebase Admin Auth in production, an in-memory version for tests/demo. */
export interface AuthAdmin {
  createUser(p: { uid: string; email: string; disabled: boolean; password?: string }): Promise<void>;
  setPassword(uid: string, password: string): Promise<void>;
  /** Disabling also revokes refresh tokens so existing sessions end. */
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  updateEmail(uid: string, email: string): Promise<void>;
  /** Permanently removes the sign-in account. Succeeds if it is already gone. */
  deleteUser(uid: string): Promise<void>;
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export function randomToken(bytes = 32): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

async function pbkdf2(password: string, saltHex: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return toHex(bits);
}

interface MemoryAuthUser {
  uid: string;
  email: string;
  disabled: boolean;
  salt: string | null;
  hash: string | null;
  tokensValidAfter: number;
}

/**
 * In-memory identity provider for tests and the clearly-labelled browser demo.
 * Passwords are salted PBKDF2 hashes; plaintext is never kept.
 */
export class MemoryAuth implements AuthAdmin {
  users = new Map<string, MemoryAuthUser>();

  constructor(initial?: MemoryAuthUser[]) {
    for (const u of initial ?? []) this.users.set(u.uid, { ...u });
  }

  snapshot(): MemoryAuthUser[] {
    return [...this.users.values()].map((u) => ({ ...u }));
  }

  async createUser(p: { uid: string; email: string; disabled: boolean; password?: string }): Promise<void> {
    const email = p.email.toLowerCase();
    if ([...this.users.values()].some((u) => u.email === email)) throw new Error('auth/email-already-exists');
    this.users.set(p.uid, { uid: p.uid, email, disabled: p.disabled, salt: null, hash: null, tokensValidAfter: 0 });
    if (p.password) await this.setPassword(p.uid, p.password);
  }

  private must(uid: string): MemoryAuthUser {
    const u = this.users.get(uid);
    if (!u) throw new Error('auth/user-not-found');
    return u;
  }

  async setPassword(uid: string, password: string): Promise<void> {
    const u = this.must(uid);
    u.salt = randomToken(16);
    u.hash = await pbkdf2(password, u.salt);
    u.tokensValidAfter = Date.now();
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    const u = this.must(uid);
    u.disabled = disabled;
    if (disabled) u.tokensValidAfter = Date.now();
  }

  async deleteUser(uid: string): Promise<void> {
    this.users.delete(uid);
  }

  async updateEmail(uid: string, email: string): Promise<void> {
    this.must(uid).email = email.toLowerCase();
  }

  /** Demo sign-in. Returns the uid or a Firebase-style error code. */
  async verify(email: string, password: string): Promise<{ uid: string } | { error: 'auth/invalid-credential' | 'auth/user-disabled' }> {
    const u = [...this.users.values()].find((x) => x.email === email.toLowerCase());
    if (!u || !u.hash || !u.salt) return { error: 'auth/invalid-credential' };
    if ((await pbkdf2(password, u.salt)) !== u.hash) return { error: 'auth/invalid-credential' };
    if (u.disabled) return { error: 'auth/user-disabled' };
    return { uid: u.uid };
  }

  sessionValid(uid: string, issuedAt: number): boolean {
    const u = this.users.get(uid);
    return !!u && !u.disabled && issuedAt >= u.tokensValidAfter;
  }
}

import type { Auth } from 'firebase-admin/auth';
import type { AuthAdmin } from '@rgk/core';

/** Firebase Admin Auth implementation of the core AuthAdmin interface. */
export class FirebaseAuthAdmin implements AuthAdmin {
  constructor(private readonly auth: Auth) {}

  async createUser(p: { uid: string; email: string; disabled: boolean; password?: string }): Promise<void> {
    await this.auth.createUser({ uid: p.uid, email: p.email, disabled: p.disabled, emailVerified: false, ...(p.password ? { password: p.password } : {}) });
  }

  async setPassword(uid: string, password: string): Promise<void> {
    await this.auth.updateUser(uid, { password });
    await this.auth.revokeRefreshTokens(uid);
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    await this.auth.updateUser(uid, { disabled });
    if (disabled) await this.auth.revokeRefreshTokens(uid);
  }

  async deleteUser(uid: string): Promise<void> {
    try {
      await this.auth.deleteUser(uid);
    } catch (e) {
      if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    }
  }

  async updateEmail(uid: string, email: string): Promise<void> {
    await this.auth.updateUser(uid, { email });
  }
}

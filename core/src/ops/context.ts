import { z } from 'zod';
import type { AuthAdmin } from '../authAdmin';
import { AppError, deny } from '../errors';
import { can, type Permission } from '../permissions';
import type { Store } from '../store';
import type { Role, UserDoc } from '../types';

export interface Ctx {
  store: Store;
  auth: AuthAdmin;
  now: () => Date;
  /** The signed-in user's profile, loaded server-side from the verified auth uid. Null for public calls. */
  actor: UserDoc | null;
  correlationId: string;
  /** Base URL of the web app, used to build activation links. */
  appUrl: string;
}

export interface AuthedCtx extends Ctx {
  actor: UserDoc;
}

export interface OpDef<I extends z.ZodType, O> {
  public?: false;
  input: I;
  run: (ctx: AuthedCtx, input: z.output<I>) => Promise<O>;
}

export interface PublicOpDef<I extends z.ZodType, O> {
  public: true;
  input: I;
  run: (ctx: Ctx, input: z.output<I>) => Promise<O>;
}

export type AnyOp = OpDef<z.ZodType, unknown> | PublicOpDef<z.ZodType, unknown>;

export function op<I extends z.ZodType, O>(def: Omit<OpDef<I, O>, 'public'>): OpDef<I, O> {
  return def;
}

export function publicOp<I extends z.ZodType, O>(def: Omit<PublicOpDef<I, O>, 'public'>): PublicOpDef<I, O> {
  return { ...def, public: true };
}

export function requirePermission(ctx: AuthedCtx, permission: Permission): void {
  if (!can(ctx.actor.role, permission)) throw deny();
}

export function requireRole(ctx: AuthedCtx, ...roles: Role[]): void {
  if (!roles.includes(ctx.actor.role)) throw deny();
}

export const empty = z.object({}).default({});

export function nowIso(ctx: Ctx): string {
  return ctx.now().toISOString();
}

export function zodToAppError(err: z.ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const first = err.issues[0];
  const where = first?.path.length ? `${first.path.join('.')}: ` : '';
  return new AppError('invalid-argument', `${where}${first?.message ?? 'Invalid input'}`, { fields });
}

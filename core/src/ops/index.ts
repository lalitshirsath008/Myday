import { z } from 'zod';
import { AppError } from '../errors';
import { StoreError } from '../store';
import { adminOps } from './admin';
import { analyticsOps } from './analytics';
import { authOps } from './auth';
import { calendarOps } from './calendarOps';
import { zodToAppError, type AnyOp, type Ctx, type AuthedCtx } from './context';
import { dailyOps } from './daily';
import { miscOps } from './misc';
import { reviewOps } from './review';
import { routineOps } from './routine';
import { weeklyOps } from './weekly';

export const ops = {
  ...authOps,
  ...dailyOps,
  ...weeklyOps,
  ...reviewOps,
  ...analyticsOps,
  ...adminOps,
  ...calendarOps,
  ...miscOps,
  ...routineOps,
};

export type Ops = typeof ops;
export type OpName = keyof Ops;
export type OpInput<K extends OpName> = z.input<Ops[K]['input']>;
export type OpOutput<K extends OpName> = Awaited<ReturnType<Ops[K]['run']>>;

export function isPublicOp(name: string): boolean {
  return (ops as Record<string, AnyOp>)[name]?.public === true;
}

/**
 * Single entry point for every API call. Authorization starts here: non-public operations require
 * an ACTIVE signed-in user, then each operation enforces its own role and scope checks.
 */
export async function dispatch(ctx: Ctx, name: string, payload: unknown): Promise<unknown> {
  const def = (ops as Record<string, AnyOp>)[name];
  if (!def) throw new AppError('not-found', `Unknown operation: ${name}`);
  if (!def.public) {
    if (!ctx.actor) throw new AppError('unauthenticated', 'Please sign in to continue.');
    if (ctx.actor.accountStatus !== 'ACTIVE') throw new AppError('permission-denied', 'Your account is not active. Contact your administrator.');
  }
  const parsed = def.input.safeParse(payload ?? {});
  if (!parsed.success) throw zodToAppError(parsed.error);
  try {
    return await (def.run as (c: Ctx | AuthedCtx, i: unknown) => Promise<unknown>)(ctx, parsed.data);
  } catch (e) {
    if (e instanceof StoreError && e.code === 'ALREADY_EXISTS') throw new AppError('aborted', 'This record was just created or changed by another request. Reload and try again.');
    throw e;
  }
}

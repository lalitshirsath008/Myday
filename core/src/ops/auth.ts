import { z } from 'zod';
import { randomToken, sha256Hex } from '../authAdmin';
import { AppError, deny, invalid, precondition } from '../errors';
import { can, PERMISSIONS, type Permission } from '../permissions';
import { password, phoneNumber, registrationInput } from '../schemas';
import { COL, type ActivationTokenDoc, type RegistrationRequestDoc, type UniqueKeyDoc, type UserDoc } from '../types';
import { empty, nowIso, op, publicOp, type Ctx } from './context';
import {
  allDepartments,
  audit,
  firstName,
  getSettings,
  notify,
  userProfile,
  userSummary,
  usersById,
} from './helpers';

export const codeKey = (code: string) => `code_${code.toUpperCase()}`;
export const phoneKey = (phone: string) => `phone_${phone}`;

/** Synthetic sign-in address for employees without an official email. Never receives mail. */
export function syntheticEmail(code: string): string {
  return `${code.toLowerCase()}@users.rgk-worktrack.invalid`;
}

export function isSyntheticEmail(email: string): boolean {
  return email.endsWith('.invalid');
}

const ACTIVATION_TTL_HOURS = 72;

/** Issue a single-use activation / set-password link. Only the token hash is stored. */
export async function issueToken(
  ctx: Ctx,
  userId: string,
  purpose: ActivationTokenDoc['purpose'],
): Promise<{ token: string; link: string; expiresAt: string; doc: ActivationTokenDoc }> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const expiresAt = new Date(ctx.now().getTime() + ACTIVATION_TTL_HOURS * 3_600_000).toISOString();
  const doc: ActivationTokenDoc = {
    id: hash,
    userId,
    purpose,
    expiresAt,
    usedAt: null,
    createdAt: nowIso(ctx),
    createdBy: ctx.actor?.id ?? 'SYSTEM',
  };
  return { token, link: `${ctx.appUrl.replace(/\/$/, '')}/activate?token=${token}`, expiresAt, doc };
}

async function lookupToken(ctx: Ctx, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const doc = await ctx.store.get<ActivationTokenDoc & { id: string }>(COL.activationTokens, await sha256Hex(token));
  if (!doc || doc.usedAt || doc.expiresAt < nowIso(ctx)) return null;
  const user = await ctx.store.get<UserDoc & { id: string }>(COL.users, doc.userId);
  if (!user || user.accountStatus === 'DEACTIVATED' || user.accountStatus === 'ARCHIVED') return null;
  return { doc, user };
}

export const authOps = {
  'auth.publicConfig': publicOp({
    input: empty,
    run: async (ctx) => {
      const s = await getSettings(ctx);
      const departments = (await allDepartments(ctx)).filter((d) => d.active).map((d) => ({ id: d.id, name: d.name }));
      return { companyName: s.companyName, allowSelfRegistration: s.allowSelfRegistration, timezone: s.timezone, departments };
    },
  }),

  /**
   * Map an employee code or registered mobile number to the sign-in email. Unknown identifiers
   * return a non-existent address so the login error is identical and accounts cannot be enumerated.
   */
  'auth.resolveIdentifier': publicOp({
    input: z.object({ identifier: z.string().trim().min(2).max(40) }),
    run: async (ctx, { identifier }) => {
      const clean = identifier.trim();
      if (clean.toUpperCase() === 'ADMIN01' || clean.toLowerCase() === 'admin@rgk.com') {
        return { email: 'admin@rgk.com' };
      }
      const isEmail = clean.includes('@');
      const phone = !isEmail ? phoneNumber.safeParse(clean) : null;
      const key = isEmail
        ? `email_${identifier.toLowerCase()}`
        : phone?.success
          ? phoneKey(phone.data)
          : codeKey(identifier);
      const ref = await ctx.store.get<UniqueKeyDoc & { id: string }>(COL.uniqueKeys, key);
      const user = ref ? await ctx.store.get<UserDoc & { id: string }>(COL.users, ref.ownerId) : null;
      if (user) return { email: user.authEmail };
      return { email: `unknown-${(await sha256Hex(key)).slice(0, 16)}@users.rgk-worktrack.invalid` };
    },
  }),

  'auth.checkToken': publicOp({
    input: z.object({ token: z.string().max(100) }),
    run: async (ctx, { token }) => {
      const found = await lookupToken(ctx, token);
      if (!found) return { valid: false as const };
      return {
        valid: true as const,
        purpose: found.doc.purpose,
        firstName: firstName(found.user.fullName),
        employeeCode: found.user.employeeCode,
      };
    },
  }),

  'auth.activateAccount': publicOp({
    input: z.object({ token: z.string().max(100), password }),
    run: async (ctx, input) => {
      const found = await lookupToken(ctx, input.token);
      if (!found) throw precondition('This link is invalid, expired or already used. Ask your administrator for a new one.');
      const { doc, user } = found;
      await ctx.auth.setPassword(user.id, input.password);
      if (user.accountStatus === 'PENDING_ACTIVATION') await ctx.auth.setDisabled(user.id, false);
      const settings = await getSettings(ctx);
      await ctx.store.transaction(async (tx) => {
        const fresh = await tx.get<ActivationTokenDoc & { id: string }>(COL.activationTokens, doc.id);
        if (!fresh || fresh.usedAt) throw precondition('This link has already been used.');
        tx.update(COL.activationTokens, doc.id, { usedAt: nowIso(ctx) });
        const actorCtx = { ...ctx, actor: user };
        if (user.accountStatus === 'PENDING_ACTIVATION') {
          tx.update(COL.users, user.id, { accountStatus: 'ACTIVE', activatedAt: nowIso(ctx), updatedAt: nowIso(ctx) });
          audit(tx, actorCtx, { action: 'ACCOUNT_ACTIVATED', entityType: 'user', entityId: user.id });
          notify(tx, ctx, settings, {
            userId: user.id,
            type: 'ACCOUNT_ACTIVATED',
            title: 'Welcome to RGK WorkTrack',
            body: 'Your account is active. You can now submit your daily reports.',
            link: '/',
            key: 'activated',
          });
        } else {
          audit(tx, actorCtx, { action: 'PASSWORD_SET_VIA_LINK', entityType: 'user', entityId: user.id });
        }
      });
      return { ok: true as const, employeeCode: user.employeeCode };
    },
  }),

  'auth.submitRegistration': publicOp({
    input: registrationInput,
    run: async (ctx, input) => {
      const settings = await getSettings(ctx);
      if (!settings.allowSelfRegistration) throw deny('Self-registration is disabled. Contact your administrator.');
      const pendingSame = await ctx.store.query<RegistrationRequestDoc & { id: string }>(COL.registrationRequests, {
        where: [['employeeCode', '==', input.employeeCode], ['status', '==', 'PENDING']],
        limit: 1,
      });
      const taken = await ctx.store.getMany(COL.uniqueKeys, [codeKey(input.employeeCode), phoneKey(input.phoneNumber)]);
      if (taken.length || pendingSame.length) {
        throw new AppError('already-exists', 'An account or pending request already exists for this employee code or mobile number. Contact your administrator.');
      }
      const id = globalThis.crypto.randomUUID();
      const req: RegistrationRequestDoc = {
        id,
        ...input,
        status: 'PENDING',
        decidedBy: null,
        decidedAt: null,
        decisionReason: '',
        createdUserId: null,
        createdAt: nowIso(ctx),
      };
      await ctx.store.transaction(async (tx) => {
        tx.create(COL.registrationRequests, id, req as unknown as RegistrationRequestDoc & { id: string });
        audit(tx, ctx, { action: 'REGISTRATION_REQUESTED', entityType: 'registrationRequest', entityId: id, afterSnapshot: { employeeCode: input.employeeCode } });
      });
      return { ok: true as const };
    },
  }),

  'me.get': op({
    input: empty,
    run: async (ctx) => {
      const me = ctx.actor;
      const settings = await getSettings(ctx);
      const [people, dept] = await Promise.all([
        usersById(ctx, [me.primaryReportingManagerId, me.secondaryReviewerId]),
        ctx.store.get<{ id: string; name: string }>(COL.departments, me.departmentId),
      ]);
      const summary = (id: string | null) => {
        const u = id ? people.get(id) : undefined;
        return u ? userSummary(u) : null;
      };
      return {
        user: userProfile(me),
        departmentName: dept?.name ?? 'Unknown department',
        primaryManager: summary(me.primaryReportingManagerId),
        secondaryReviewer: summary(me.secondaryReviewerId),
        isReporter: settings.reportingRoles.includes(me.role),
        permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(me.role, p)),
        settings: {
          companyName: settings.companyName,
          timezone: settings.timezone,
          weekStartDay: settings.weekStartDay,
          primaryTaskSlots: settings.primaryTaskSlots,
          minTasksForSubmission: settings.minTasksForSubmission,
          allowAdditionalTasks: settings.allowAdditionalTasks,
          maxAdditionalTasks: settings.maxAdditionalTasks,
          allowOvernightTasks: settings.allowOvernightTasks,
          maxBackdateDays: settings.maxBackdateDays,
          allowProjectRequests: settings.allowProjectRequests,
          taskCategories: settings.taskCategories,
          dailyDeadlineTime: settings.dailyDeadlineTime,
          dailyDeadlineDayOffset: settings.dailyDeadlineDayOffset,
        },
      };
    },
  }),

  /** Clears the "choose your own password" prompt after the user changed their password. */
  'me.passwordChanged': op({
    input: empty,
    run: async (ctx) => {
      await ctx.store.transaction(async (tx) => {
        tx.update(COL.users, ctx.actor.id, { mustChangePassword: false, updatedAt: nowIso(ctx) });
        audit(tx, ctx, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: ctx.actor.id });
      });
      return { ok: true as const };
    },
  }),

  'me.updateProfile': op({
    input: z.object({
      alternatePhone: z.string().trim().max(20).refine((v) => v === '' || /^[+\d\s-]{6,20}$/.test(v), 'Enter a valid phone number'),
      location: z.string().trim().max(120),
    }),
    run: async (ctx, input) => {
      if (input.alternatePhone && input.alternatePhone.replace(/\D/g, '').endsWith(ctx.actor.phoneNumber)) {
        throw invalid('Alternate phone must differ from your registered mobile number.');
      }
      await ctx.store.transaction(async (tx) => {
        tx.update(COL.users, ctx.actor.id, { ...input, updatedAt: nowIso(ctx) });
        audit(tx, ctx, {
          action: 'PROFILE_UPDATED',
          entityType: 'user',
          entityId: ctx.actor.id,
          beforeSnapshot: { alternatePhone: ctx.actor.alternatePhone, location: ctx.actor.location },
          afterSnapshot: input,
        });
      });
      return { ok: true as const };
    },
  }),
};


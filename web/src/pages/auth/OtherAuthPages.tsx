import { zodResolver } from '@hookform/resolvers/zod';
import { password as passwordSchema, registrationInput } from '@rgk/core';
import { CheckCircle2, KeyRound, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Notice, Skeleton } from '@/components/ui/misc';
import { api, backend, errorMessage, useOp } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function NewPasswordForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (password: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: '', confirm: '' } });
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        try {
          await onSubmit(v.password);
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="New password" required error={formState.errors.password?.message} hint="At least 8 characters, with letters and a number.">
        {(p) => <Input {...p} {...register('password')} type="password" autoComplete="new-password" autoFocus />}
      </Field>
      <Field label="Confirm password" required error={formState.errors.confirm?.message}>
        {(p) => <Input {...p} {...register('confirm')} type="password" autoComplete="new-password" />}
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
        <KeyRound /> {submitLabel}
      </Button>
    </form>
  );
}

/** One-time activation / set-password link issued by an administrator. */
export function ActivatePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState<string | null>(null);
  const check = useOp('auth.checkToken', { token }, { enabled: !!token, retry: false });

  if (done) {
    return (
      <AuthLayout title="Password set">
        <Notice tone="success" title="You're all set.">
          Sign in with your employee code <strong>{done}</strong> and your new password.
        </Notice>
        <Button asChild className="mt-5 w-full" size="lg">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthLayout>
    );
  }
  if (!token || check.data?.valid === false || check.error) {
    return (
      <AuthLayout title="Link not valid">
        <Notice tone="warning">This activation link is invalid, expired or already used. Ask your administrator for a new link.</Notice>
        <Button asChild variant="outline" className="mt-5 w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthLayout>
    );
  }
  if (!check.data) {
    return (
      <AuthLayout title="Checking your link…">
        <Skeleton className="h-40" />
      </AuthLayout>
    );
  }
  const info = check.data;
  return (
    <AuthLayout
      title={info.purpose === 'ACTIVATION' ? `Welcome, ${info.firstName}` : `Set a new password, ${info.firstName}`}
      subtitle={info.purpose === 'ACTIVATION' ? `Create a password to activate account ${info.employeeCode}.` : `Choose a new password for ${info.employeeCode}.`}
    >
      <NewPasswordForm
        submitLabel={info.purpose === 'ACTIVATION' ? 'Activate account' : 'Set password'}
        onSubmit={async (password) => {
          const r = await api('auth.activateAccount', { token, password });
          setDone(r.employeeCode);
        }}
      />
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(z.object({ identifier: z.string().trim().min(2, 'Enter your employee code or mobile number') })),
    defaultValues: { identifier: '' },
  });
  return (
    <AuthLayout title="Reset password" subtitle="We'll email a link to your official email">
      {sent ? (
        <div className="space-y-4">
          <Notice tone="success" title="Check your email">
            If your account has an official email address, a reset link has been sent to it. No email on file? Ask your administrator for a secure set-password link.
          </Notice>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit(async ({ identifier }) => {
            // The same message is shown whether or not the account exists.
            try {
              const { email } = await api('auth.resolveIdentifier', { identifier });
              if (!email.endsWith('.invalid')) await backend().sendPasswordReset(email);
            } catch {
              // Intentionally ignored to avoid revealing which accounts exist.
            }
            setSent(true);
          })}
        >
          <Field label="Employee code or mobile number" required error={formState.errors.identifier?.message}>
            {(p) => <Input {...p} {...register('identifier')} autoComplete="username" autoFocus />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
            <Send /> Send reset link
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

/** Target of the Firebase password-reset email (configure the action URL to /reset-password). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const oobCode = params.get('oobCode');
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  if (!oobCode) {
    return (
      <AuthLayout title="Reset link missing">
        <Notice tone="warning">Open the link from your reset email, or request a new one.</Notice>
        <Button asChild variant="outline" className="mt-5 w-full">
          <Link to="/forgot-password">Request a reset link</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={done ? 'Password changed' : 'Choose a new password'}>
      {done ? (
        <Button className="w-full" size="lg" onClick={() => navigate('/login')}>
          <CheckCircle2 /> Sign in
        </Button>
      ) : (
        <NewPasswordForm
          submitLabel="Change password"
          onSubmit={async (pw) => {
            await backend().confirmPasswordReset(oobCode, pw);
            setDone(true);
          }}
        />
      )}
    </AuthLayout>
  );
}

export function RegisterPage() {
  const cfg = useOp('auth.publicConfig', {});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(registrationInput),
    defaultValues: { fullName: '', employeeCode: '', phoneNumber: '', officialEmail: '', departmentId: null as string | null, designation: '' },
  });
  if (cfg.data && !cfg.data.allowSelfRegistration) {
    return (
      <AuthLayout title="Registration closed">
        <Notice tone="info">Accounts are created by your administrator. Contact HR or IT to get access.</Notice>
        <Button asChild variant="outline" className="mt-5 w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthLayout>
    );
  }
  if (done) {
    return (
      <AuthLayout title="Request submitted">
        <Notice tone="success" title="Pending approval">
          An administrator will verify your details and assign your role and Reporting Manager. You'll then receive an activation link.
        </Notice>
        <Button asChild variant="outline" className="mt-5 w-full">
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout wide title="Request access" subtitle="An administrator will review your request">
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async (v) => {
          setError(null);
          try {
            await api('auth.submitRegistration', { ...v, departmentId: v.departmentId || null });
            setDone(true);
          } catch (e) {
            setError(errorMessage(e));
          }
        })}
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <fieldset className="space-y-3.5">
          <legend className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <span className="flex size-6 items-center justify-center rounded-lg bg-brand-soft text-[12px] font-bold text-brand">1</span> About you
          </legend>
          <Field label="Full name" required error={formState.errors.fullName?.message}>
            {(p) => <Input {...p} {...register('fullName')} autoComplete="name" placeholder="As per company records" />}
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Employee code" required error={formState.errors.employeeCode?.message}>
              {(p) => <Input {...p} {...register('employeeCode')} autoCapitalize="characters" placeholder="e.g. EMP245" />}
            </Field>
            <Field label="Mobile number" required error={formState.errors.phoneNumber?.message}>
              {(p) => <Input {...p} {...register('phoneNumber')} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" />}
            </Field>
          </div>
          <Field label="Official email" error={formState.errors.officialEmail?.message} hint="Optional · lets you reset your password by email">
            {(p) => <Input {...p} {...register('officialEmail')} type="email" autoComplete="email" placeholder="name@rgkgroup.net" />}
          </Field>
        </fieldset>
        <fieldset className="space-y-3.5 border-t pt-4">
          <legend className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <span className="flex size-6 items-center justify-center rounded-lg bg-brand-soft text-[12px] font-bold text-brand">2</span> Your work
          </legend>
          <div className="grid gap-3.5">
            <Field label="Department">
              {(p) => (
                <Select {...p} {...register('departmentId')}>
                  <option value="">Select department</option>
                  {cfg.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Designation">{(p) => <Input {...p} {...register('designation')} placeholder="e.g. Production Engineer" />}</Field>
          </div>
        </fieldset>
        <ol className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/60 p-3 text-center text-[11px] font-medium text-muted-foreground">
          <li>
            <span className="mb-1 block text-[15px]" aria-hidden>📝</span>You request
          </li>
          <li>
            <span className="mb-1 block text-[15px]" aria-hidden>✅</span>Admin verifies
          </li>
          <li>
            <span className="mb-1 block text-[15px]" aria-hidden>🔑</span>You get a link
          </li>
        </ol>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          <Send /> Submit request
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

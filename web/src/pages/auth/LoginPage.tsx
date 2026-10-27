import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { api, backend } from '@/lib/api';
import { AuthFailure } from '@/lib/backend';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  identifier: z.string().trim().min(2, 'Enter your employee code or registered mobile number'),
  password: z.string().min(1, 'Enter your password'),
});

const MESSAGES: Record<string, string> = {
  'invalid-credential': 'Employee code / mobile number or password is incorrect.',
  'user-disabled': 'This account is not active. Contact your administrator.',
  'too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  network: 'Cannot reach the server. Check your connection.',
  unknown: 'Sign-in failed. Try again.',
};

export function LoginPage() {
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema), defaultValues: { identifier: '', password: '' } });

  const onSubmit = handleSubmit(async ({ identifier, password }) => {
    setError(null);
    try {
      let email = identifier.trim();
      try {
        const resolved = await api('auth.resolveIdentifier', { identifier: email });
        if (resolved?.email) email = resolved.email;
      } catch {
        // Fallback directly to identifier
      }
      await backend().signIn(email, password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof AuthFailure ? MESSAGES[e.reason]! : (e as Error)?.message || MESSAGES.unknown!);
    }
  });

  return (
    <AuthLayout title="Sign in" subtitle="Use your employee code, mobile number or email">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Employee code, mobile number or email" required error={formState.errors.identifier?.message}>
          {(p) => <Input {...p} {...register('identifier')} autoComplete="username" placeholder="Employee code, mobile or email" autoFocus />}
        </Field>
        <Field label="Password" required error={formState.errors.password?.message}>
          {(p) => (
            <div className="relative">
              <Input {...p} {...register('password')} type={show ? 'text' : 'password'} autoComplete="current-password" className="pr-10" />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link to="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          <LogIn /> Sign in
        </Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        New here?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Request access
        </Link>
      </p>
    </AuthLayout>
  );
}

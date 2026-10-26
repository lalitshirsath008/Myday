import { zodResolver } from '@hookform/resolvers/zod';
import { firstName, password as passwordSchema } from '@rgk/core';
import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { api, backend, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AuthLayout } from './AuthLayout';

const schema = z
  .object({ current: z.string().min(1, 'Enter the password you were given'), next: passwordSchema, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.next !== v.current, { message: 'Choose a different password', path: ['next'] });

/** Shown after sign-in when an admin set the password: the employee picks their own before continuing. */
export function ChoosePasswordPage() {
  const { me, refresh, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema), defaultValues: { current: '', next: '', confirm: '' } });
  const name = me ? firstName(me.user.fullName.replace(/\s*\(.*\)$/, '')) : '';
  return (
    <AuthLayout title={`Welcome, ${name}!`} subtitle="Choose your own password to continue">
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async (v) => {
          setError(null);
          try {
            await backend().changePassword(v.current, v.next);
            await api('me.passwordChanged', {});
            refresh();
          } catch (e) {
            setError(errorMessage(e));
          }
        })}
      >
        {error && <Notice tone="danger">{error}</Notice>}
        <Field label="Password you were given" required error={formState.errors.current?.message}>
          {(p) => <Input {...p} {...register('current')} type="password" autoComplete="current-password" autoFocus />}
        </Field>
        <Field label="New password" required error={formState.errors.next?.message} hint="8+ characters with letters and a number">
          {(p) => <Input {...p} {...register('next')} type="password" autoComplete="new-password" />}
        </Field>
        <Field label="Confirm new password" required error={formState.errors.confirm?.message}>
          {(p) => <Input {...p} {...register('confirm')} type="password" autoComplete="new-password" />}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={formState.isSubmitting}>
          <KeyRound /> Save and continue
        </Button>
        <button type="button" onClick={() => void signOut()} className="mx-auto flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <LogOut className="size-4" aria-hidden /> Sign out
        </button>
      </form>
    </AuthLayout>
  );
}

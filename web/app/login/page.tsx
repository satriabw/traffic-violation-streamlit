'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, LoaderCircle, ScanLine } from 'lucide-react';
import { loginDestination } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Login() {
  const search = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-6 py-12">
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center justify-center gap-2.5 text-sm font-medium"><div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ScanLine className="size-4" strokeWidth={1.75} /></div>Traffic Violation Console</div>
      <div className="rounded-2xl border bg-background p-7 shadow-sm">
        <header className="mb-7 space-y-2 text-center"><h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1><p className="text-sm text-muted-foreground">Sign in to your workspace.</p></header>
        <form className="space-y-5" onSubmit={async event => {
          event.preventDefault(); if (pending) return; setPending(true); setError('');
          try {
            const response = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
            const data = await response.json().catch(() => ({ error: 'Could not sign in. Try again.' }));
            if (!response.ok) throw new Error(data.error || 'Could not sign in. Try again.');
            window.location.assign(loginDestination(search.get('next')));
          } catch (error) { setError(error instanceof Error ? error.message : 'Could not sign in. Try again.'); setPending(false); }
        }}>
          <div className="space-y-2"><Label htmlFor="username">Username</Label><Input id="username" name="username" autoComplete="username" autoFocus required disabled={pending} value={username} onChange={event => { setUsername(event.target.value); setError(''); }} /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{pending ? 'Signing in…' : 'Sign in'}{!pending && <ArrowRight className="size-4" />}</Button>
        </form>
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">Your evidence and conversations, in one place.</p>
    </div>
  </main>;
}

export default function Page() { return <Suspense><Login /></Suspense>; }

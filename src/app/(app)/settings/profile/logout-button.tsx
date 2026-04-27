'use client';

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  return (
    <Button
      variant="danger"
      onClick={() => signOut({ callbackUrl: '/login' })}
    >
      <LogOut size={12} />
      Выйти
    </Button>
  );
}

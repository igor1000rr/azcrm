// Корень — редирект на воронку (главную для всех ролей)
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Root() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  redirect('/funnel');
}

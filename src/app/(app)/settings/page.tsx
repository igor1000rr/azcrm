// Корневой /settings — редиректим на профиль (доступен всем)
import { redirect } from 'next/navigation';

export default function SettingsIndexPage() {
  redirect('/settings/profile');
}

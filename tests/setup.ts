// Глобальные настройки vitest. Подменяем next/server и next/navigation чтобы
// можно было импортировать server actions без полного next runtime.
import { vi, afterEach } from 'vitest';

// Заглушка для revalidatePath — server actions её зовут
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag:  vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  // useRouter/usePathname для client-компонентов под jsdom
  useRouter: vi.fn(() => ({
    push:    vi.fn(),
    replace: vi.fn(),
    back:    vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname:     vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// next/headers — для cookies()/headers() в server actions
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: () => undefined, set: vi.fn() })),
  headers: vi.fn(() => new Map()),
}));

// jest-dom матчеры (toBeInTheDocument, toHaveClass, etc.) — для UI-тестов в jsdom.
// В node-окружении matchers просто не используются, импорт безвреден.
import '@testing-library/jest-dom/vitest';

// Авто-cleanup React DOM между тестами — без него каждый render() накапливает
// элементы в document.body, и getByRole/getByPlaceholderText находят несколько
// и падают с TestingLibraryElementError.
//
// Импорт условный: в node-окружении (server actions tests) cleanup не нужен,
// и динамический import не вызовется.
afterEach(async () => {
  if (typeof window !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});

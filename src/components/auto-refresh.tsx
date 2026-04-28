'use client';

// Глобальное автообновление страницы через router.refresh().
//
// Подключается один раз в (app)/layout.tsx и работает на всех страницах
// внутри защищённой зоны. Раз в N секунд тихо перезапрашивает server-data
// текущего route — в RSC это значит что Next перезапросит компоненты
// которые рендерятся на сервере, но клиентское состояние (формы, scroll,
// открытые модалки, ввод) не теряется.
//
// Особенности:
//   - Полностью отключается когда вкладка не в фокусе (Page Visibility API),
//     чтобы не нагружать сервер открытыми вкладками.
//   - При возврате во вкладку — мгновенный refresh + возобновление цикла.
//   - Не работает в input/textarea — пока юзер пишет, рефреш ставится на
//     паузу, чтобы не было ощущения "застрявшего" интерфейса.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface AutoRefreshProps {
  /** Интервал в миллисекундах. По умолчанию 5 сек. */
  intervalMs?: number;
}

export function AutoRefresh({ intervalMs = 5000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const isUserTyping = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (isUserTyping()) return;
      router.refresh();
    };

    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Мгновенный апдейт при возврате во вкладку (но не если юзер пишет)
        if (!isUserTyping()) router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}

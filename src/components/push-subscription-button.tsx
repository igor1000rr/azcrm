'use client';

// Кнопка подписки/отписки на push-уведомления
import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PushState = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'loading';

export function PushSubscriptionButton() {
  const [state, setState] = useState<PushState>('loading');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'subscribed' : 'unsubscribed'))
      .catch(() => setState('unsubscribed'));
  }, []);

  async function subscribe() {
    setState('loading');
    try {
      // Регистрация SW
      const reg = await navigator.serviceWorker.register('/sw.js');

      // Запрос разрешения
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'unsubscribed');
        return;
      }

      // Получаем VAPID public key
      const vapidRes = await fetch('/api/push/vapid');
      const { key } = await vapidRes.json();
      if (!key) {
        alert('Push-уведомления не настроены на сервере');
        setState('unsubscribed');
        return;
      }

      // Подписываемся
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });

      // Отправляем на сервер
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });

      setState('subscribed');
    } catch (e) {
      console.error(e);
      alert('Не удалось подписаться: ' + (e as Error).message);
      setState('unsubscribed');
    }
  }

  async function unsubscribe() {
    setState('loading');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('unsubscribed');
    } catch (e) {
      console.error(e);
      setState('subscribed');
    }
  }

  if (state === 'unsupported') {
    return <span className="text-[12px] text-ink-4">Браузер не поддерживает push</span>;
  }
  if (state === 'denied') {
    return <span className="text-[12px] text-danger">Разрешение запрещено в браузере</span>;
  }
  if (state === 'loading') {
    return <span className="text-[12px] text-ink-4">...</span>;
  }
  if (state === 'subscribed') {
    return (
      <Button size="sm" onClick={unsubscribe}>
        <BellOff size={11} /> Отключить
      </Button>
    );
  }
  return (
    <Button size="sm" variant="primary" onClick={subscribe}>
      <Bell size={11} /> Включить уведомления
    </Button>
  );
}

// Утилита из официальной документации web-push
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

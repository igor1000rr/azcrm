'use client';

// OnlyOffice editor — встраивается в модалку, подгружает api.js с OO сервера
import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnlyOfficeEditorProps {
  open:        boolean;
  documentId:  string;
  documentName: string;
  mode?:       'edit' | 'view';
  onClose:     () => void;
}

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        elementId: string,
        config: Record<string, unknown>,
      ) => { destroyEditor: () => void };
    };
  }
}

const OO_PUBLIC_URL = process.env.NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL ?? '';

export function OnlyOfficeEditor({
  open, documentId, documentName, mode = 'edit', onClose,
}: OnlyOfficeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef    = useRef<{ destroyEditor: () => void } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);
    let cancelled = false;

    async function init() {
      try {
        // Загружаем api.js если ещё не подгружен
        if (!window.DocsAPI) {
          if (!OO_PUBLIC_URL) {
            throw new Error('OnlyOffice не настроен (NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL)');
          }
          await loadScript(`${OO_PUBLIC_URL}/web-apps/apps/api/documents/api.js`);
        }

        // Получаем конфиг редактора
        const res = await fetch(`/api/onlyoffice/config?docId=${documentId}&mode=${mode}`);
        if (!res.ok) {
          throw new Error('Не удалось получить конфиг редактора');
        }
        const config = await res.json();

        if (cancelled) return;

        // Создаём редактор в div
        const elementId = `oo-editor-${documentId}`;
        if (containerRef.current) {
          containerRef.current.id = elementId;
        }
        editorRef.current = new window.DocsAPI!.DocEditor(elementId, {
          ...config,
          events: {
            onAppReady: () => setLoading(false),
            onDocumentReady: () => setLoading(false),
            onError: (e: { data: { errorCode: number; errorDescription: string } }) => {
              setError(`Ошибка редактора: ${e.data.errorDescription}`);
              setLoading(false);
            },
          },
        });
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (editorRef.current) {
        try { editorRef.current.destroyEditor(); } catch {}
        editorRef.current = null;
      }
    };
  }, [open, documentId, mode]);

  // Esc для закрытия
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex flex-col">
      {/* Шапка */}
      <div className="bg-paper border-b border-line h-12 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12px] text-ink-3 font-mono">DOCX</span>
          <h2 className="text-[14px] font-semibold text-ink truncate">{documentName}</h2>
          {mode === 'view' && (
            <span className="text-[10.5px] px-1.5 py-px bg-bg text-ink-3 rounded">только чтение</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-md border border-line bg-paper text-ink-2 grid place-items-center hover:border-ink-5"
          aria-label="Закрыть"
        >
          <X size={14} />
        </button>
      </div>

      {/* Контейнер редактора */}
      <div className="flex-1 bg-paper relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-bg/95 z-10">
            <div className="flex flex-col items-center gap-3 text-ink-3">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-[13px]">Загрузка редактора...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-bg z-10 p-6">
            <div className="max-w-md text-center">
              <div className="text-danger font-bold text-[15px] mb-2">Не удалось открыть документ</div>
              <div className="text-[13px] text-ink-3 mb-4">{error}</div>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md border border-line bg-paper text-[13px] text-ink-2 hover:border-ink-5"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
        <div ref={containerRef} className={cn('w-full h-full', error && 'invisible')} />
      </div>
    </div>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Не удалось загрузить OnlyOffice api.js'));
    document.head.appendChild(s);
  });
}

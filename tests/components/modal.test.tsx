// Компонентные тесты src/components/ui/modal.tsx.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/ui/modal';

describe('Modal', () => {
  it('open=false — не рендерится', () => {
    render(
      <Modal open={false} onClose={() => {}} title="T">
        Body
      </Modal>,
    );
    expect(screen.queryByText('T')).not.toBeInTheDocument();
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('open=true — рендерит title и children', () => {
    render(
      <Modal open onClose={() => {}} title="Подтверждение">
        Текст вопроса
      </Modal>,
    );
    expect(screen.getByText('Подтверждение')).toBeInTheDocument();
    expect(screen.getByText('Текст вопроса')).toBeInTheDocument();
  });

  it('клик на кнопку закрытия — вызывает onClose', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">B</Modal>,
    );
    await userEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape — вызывает onClose', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">B</Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape при open=false — onClose НЕ вызывается', async () => {
    const onClose = vi.fn();
    render(
      <Modal open={false} onClose={onClose} title="T">B</Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('клик по backdrop (вне окна) — вызывает onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose} title="T">B</Modal>,
    );
    // backdrop — самый внешний div с fixed
    const backdrop = container.querySelector('.fixed') as HTMLElement;
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('клик внутри самого окна — onClose НЕ вызывается', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T">
        <span>inside</span>
      </Modal>,
    );
    await userEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('footer рендерится если передан', () => {
    render(
      <Modal open onClose={() => {}} title="T" footer={<button>OK</button>}>
        B
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('size=lg — большая ширина', () => {
    const { container } = render(
      <Modal open onClose={() => {}} title="T" size="lg">B</Modal>,
    );
    expect(container.querySelector('.max-w-\\[720px\\]')).not.toBeNull();
  });

  it('body overflow блокируется пока открыто', () => {
    const { rerender, unmount } = render(
      <Modal open onClose={() => {}} title="T">B</Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    // После закрытия — восстанавливается
    rerender(<Modal open={false} onClose={() => {}} title="T">B</Modal>);
    // useEffect cleanup срабатывает при изменении deps
    expect(document.body.style.overflow).toBe('');

    unmount();
  });
});

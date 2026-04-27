// Компонентные тесты src/components/ui/button.tsx (под jsdom + @testing-library/react).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('рендерит children', () => {
    render(<Button>ОК</Button>);
    expect(screen.getByRole('button', { name: 'ОК' })).toBeInTheDocument();
  });

  it('onClick срабатывает по клику', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>X</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled блокирует onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>X</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('variant primary применяет bg-navy', () => {
    render(<Button variant="primary">P</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-navy');
  });

  it('variant danger применяет bg-danger', () => {
    render(<Button variant="danger">D</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-danger');
  });

  it('variant ghost — transparent', () => {
    render(<Button variant="ghost">G</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-transparent');
  });

  it('size sm применяет маленький размер', () => {
    render(<Button size="sm">S</Button>);
    expect(screen.getByRole('button').className).toContain('text-[11.5px]');
  });

  it('size icon — квадратный размер 34x34', () => {
    render(<Button size="icon" aria-label="Стоп">i</Button>);
    const btn = screen.getByLabelText('Стоп');
    expect(btn.className).toContain('w-[34px]');
    expect(btn.className).toContain('h-[34px]');
  });

  it('aria-label прокидывается', () => {
    render(<Button aria-label="Удалить">X</Button>);
    expect(screen.getByLabelText('Удалить')).toBeInTheDocument();
  });

  it('type=submit прокидывается', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('forwardRef прокидывает ref на DOM-элемент', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>X</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('кастомный className добавляется к базовым', () => {
    render(<Button className="my-extra">X</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('my-extra');
    // Базовые классы сохраняются
    expect(btn).toHaveClass('inline-flex');
  });
});

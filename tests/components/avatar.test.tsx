// Компонентные тесты src/components/ui/avatar.tsx.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from '@/components/ui/avatar';

describe('Avatar', () => {
  it('без картинки — показывает инициалы', () => {
    render(<Avatar name="Иван Петров" />);
    expect(screen.getByText('ИП')).toBeInTheDocument();
  });

  it('из одного слова — одна буква', () => {
    render(<Avatar name="Anna" />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('пустое имя — вопрос (?)', () => {
    render(<Avatar name="" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('imageUrl — рендерит <img> вместо инициалов', () => {
    render(<Avatar name="Иван" imageUrl="/avatar.jpg" />);
    const img = screen.getByAltText('Иван') as HTMLImageElement;
    expect(img.src).toContain('/avatar.jpg');
    // Инициалов нет поскольку их заменила картинка
    expect(screen.queryByText('И')).not.toBeInTheDocument();
  });

  it('status=online — рендерит индикатор', () => {
    render(<Avatar name="X" status="online" />);
    expect(screen.getByLabelText('online')).toBeInTheDocument();
  });

  it('status=away — жёлтый', () => {
    const { container } = render(<Avatar name="X" status="away" />);
    const indicator = container.querySelector('[aria-label="away"]');
    expect(indicator?.className).toContain('bg-warn');
  });

  it('status=offline — серый', () => {
    const { container } = render(<Avatar name="X" status="offline" />);
    expect(container.querySelector('[aria-label="offline"]')?.className).toContain('bg-ink-5');
  });

  it('без status — индикатор не рендерится', () => {
    const { container } = render(<Avatar name="X" />);
    expect(container.querySelector('[aria-label="online"]')).toBeNull();
    expect(container.querySelector('[aria-label="away"]')).toBeNull();
  });

  it('size=xl — большой', () => {
    const { container } = render(<Avatar name="X" size="xl" />);
    expect(container.querySelector('.w-16')).not.toBeNull();
  });

  it('variant=navy — тёмный фон с золотым текстом', () => {
    const { container } = render(<Avatar name="X" variant="navy" />);
    const inner = container.querySelector('.bg-navy');
    expect(inner).not.toBeNull();
    expect(inner?.className).toContain('text-gold');
  });
});

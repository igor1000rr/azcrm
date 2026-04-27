// Компонентные тесты src/components/ui/badge.tsx.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('рендерит children', () => {
    render(<Badge>Новый</Badge>);
    expect(screen.getByText('Новый')).toBeInTheDocument();
  });

  it('default variant — нейтральные классы', () => {
    const { container } = render(<Badge>X</Badge>);
    const span = container.querySelector('span');
    expect(span?.className).toContain('bg-bg');
  });

  it('variant=danger — красный', () => {
    const { container } = render(<Badge variant="danger">!</Badge>);
    expect(container.querySelector('span')?.className).toContain('text-danger');
  });

  it('variant=success — зелёный', () => {
    const { container } = render(<Badge variant="success">OK</Badge>);
    expect(container.querySelector('span')?.className).toContain('text-success');
  });

  it('variant=navy — фирменный темный', () => {
    const { container } = render(<Badge variant="navy">N</Badge>);
    expect(container.querySelector('span')?.className).toContain('text-navy');
  });

  it('variant=gold — золотистый', () => {
    const { container } = render(<Badge variant="gold">G</Badge>);
    expect(container.querySelector('span')?.className).toContain('bg-gold-pale');
  });

  it('withDot=true — отображается точка-индикатор', () => {
    const { container } = render(<Badge withDot>online</Badge>);
    // Точка — это вложенный span с aria-hidden
    expect(container.querySelector('span[aria-hidden]')).not.toBeNull();
  });

  it('withDot=false по дефолту — точки нет', () => {
    const { container } = render(<Badge>nodot</Badge>);
    expect(container.querySelector('span[aria-hidden]')).toBeNull();
  });

  it('дополнительный className применяется', () => {
    const { container } = render(<Badge className="extra-class">X</Badge>);
    expect(container.querySelector('span')?.className).toContain('extra-class');
  });
});

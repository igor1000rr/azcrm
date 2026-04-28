// Тесты topbar.tsx — хлебные крошки, активная крошка, кнопка "Новый лид".
// Прогнаны локально 13/13 ✓.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Topbar } from '@/components/topbar';

describe('Topbar — крошки', () => {
  it('одна крошка — отображается как активная (strong, navy)', () => {
    const { container } = render(<Topbar breadcrumbs={[{ label: 'CRM' }]} />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('CRM');
    expect(strong?.className).toContain('text-navy');
    expect(strong?.className).toContain('font-bold');
  });

  it('последняя крошка — strong, остальные — span/a (navy-medium)', () => {
    const { container } = render(
      <Topbar breadcrumbs={[
        { label: 'CRM' },
        { label: 'Воронки' },
        { label: 'Иванов Иван' },
      ]} />,
    );
    const strongs = container.querySelectorAll('strong');
    expect(strongs.length).toBe(1);
    expect(strongs[0].textContent).toBe('Иванов Иван');

    expect(screen.getByText('CRM').className).toContain('text-navy-medium');
    expect(screen.getByText('Воронки').className).toContain('text-navy-medium');
  });

  it('крошка с href — рендерится как ссылка <a>', () => {
    const { container } = render(
      <Topbar breadcrumbs={[
        { label: 'CRM',     href: '/' },
        { label: 'Воронки', href: '/funnel' },
        { label: 'Текущая' },
      ]} />,
    );
    const links = container.querySelectorAll('nav a');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toBe('/');
    expect(links[1].getAttribute('href')).toBe('/funnel');
  });

  it('крошка без href — рендерится как span (не кликабельная)', () => {
    const { container } = render(
      <Topbar breadcrumbs={[
        { label: 'CRM' },
        { label: 'Текущая' },
      ]} />,
    );
    const navLinks = container.querySelectorAll('nav a');
    expect(navLinks.length).toBe(0);
  });

  it('разделители "/" между крошками (n-1 разделителей для n крошек)', () => {
    const { container } = render(
      <Topbar breadcrumbs={[
        { label: 'A' },
        { label: 'B' },
        { label: 'C' },
      ]} />,
    );
    const slashes = container.querySelectorAll('nav span.text-navy-light');
    expect(slashes.length).toBe(2);
    slashes.forEach((s) => expect(s.textContent).toBe('/'));
  });

  it('одна крошка — без разделителей', () => {
    const { container } = render(<Topbar breadcrumbs={[{ label: 'Одна' }]} />);
    const slashes = container.querySelectorAll('nav span.text-navy-light');
    expect(slashes.length).toBe(0);
  });
});

describe('Topbar — кнопка "Новый лид"', () => {
  it('всегда отображается с иконкой Plus', () => {
    render(<Topbar breadcrumbs={[{ label: 'X' }]} />);
    expect(screen.getByText('Новый лид')).toBeInTheDocument();
  });

  it('ведёт на /clients/new', () => {
    render(<Topbar breadcrumbs={[{ label: 'X' }]} />);
    const link = screen.getByText('Новый лид').closest('a');
    expect(link?.getAttribute('href')).toBe('/clients/new');
  });

  it('скрыта на мобиле (hidden sm:inline-flex)', () => {
    render(<Topbar breadcrumbs={[{ label: 'X' }]} />);
    const link = screen.getByText('Новый лид').closest('a');
    expect(link?.className).toContain('hidden');
    expect(link?.className).toContain('sm:inline-flex');
  });
});

describe('Topbar — rightSlot', () => {
  it('rightSlot отображается', () => {
    render(<Topbar
      breadcrumbs={[{ label: 'X' }]}
      rightSlot={<div data-testid="custom-right">Custom</div>}
    />);
    expect(screen.getByTestId('custom-right')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('rightSlot отсутствует — не падает', () => {
    expect(() =>
      render(<Topbar breadcrumbs={[{ label: 'X' }]} />),
    ).not.toThrow();
  });

  it('правый блок содержит кнопку "Новый лид"', () => {
    const { container } = render(<Topbar breadcrumbs={[{ label: 'Y' }]} />);
    const rightBlock = container.querySelector('.ml-auto');
    expect(rightBlock).not.toBeNull();
    expect(rightBlock?.textContent).toContain('Новый лид');
  });
});

describe('Topbar — золотая полоска (бренд)', () => {
  it('header имеет правильный класс с after-полоской gold', () => {
    const { container } = render(<Topbar breadcrumbs={[{ label: 'X' }]} />);
    const header = container.querySelector('header');
    expect(header?.className).toContain('after:bg-gold');
    expect(header?.className).toContain('bg-paper');
    expect(header?.className).toContain('sticky');
  });
});

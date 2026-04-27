// Компонентные тесты src/components/ui/input.tsx — Input, Textarea, Select, FormField.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input, Textarea, Select, FormField } from '@/components/ui/input';

describe('Input', () => {
  it('рендерится с placeholder', () => {
    render(<Input placeholder="Имя" />);
    expect(screen.getByPlaceholderText('Имя')).toBeInTheDocument();
  });

  it('onChange вызывается при вводе', async () => {
    const onChange = vi.fn();
    render(<Input placeholder="имя" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('имя'), 'abc');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('disabled — не принимает ввод', async () => {
    render(<Input placeholder="x" disabled defaultValue="исход" />);
    const input = screen.getByPlaceholderText('x') as HTMLInputElement;
    await userEvent.type(input, 'abc');
    expect(input.value).toBe('исход'); // не изменилось
  });

  it('type=email прокидывается', () => {
    render(<Input type="email" placeholder="e" />);
    expect(screen.getByPlaceholderText('e')).toHaveAttribute('type', 'email');
  });
});

describe('Textarea', () => {
  it('по дефолту rows=3', () => {
    render(<Textarea placeholder="t" />);
    expect(screen.getByPlaceholderText('t')).toHaveAttribute('rows', '3');
  });

  it('rows переопределяется', () => {
    render(<Textarea placeholder="t" rows={10} />);
    expect(screen.getByPlaceholderText('t')).toHaveAttribute('rows', '10');
  });

  it('onChange при вводе', async () => {
    const onChange = vi.fn();
    render(<Textarea placeholder="t" onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('t'), 'hi');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('Select', () => {
  it('рендерит options', () => {
    render(
      <Select aria-label="Статус">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    expect(screen.getByLabelText('Статус')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'B' })).toBeInTheDocument();
  });

  it('onChange срабатывает при выборе', async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="s" onChange={onChange} defaultValue="a">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    await userEvent.selectOptions(screen.getByLabelText('s'), 'b');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('FormField', () => {
  it('рендерит label и связывает с input через htmlFor', () => {
    render(
      <FormField label="Имя" htmlFor="name">
        <Input id="name" />
      </FormField>,
    );
    expect(screen.getByText('Имя')).toBeInTheDocument();
    expect(screen.getByLabelText('Имя')).toBeInstanceOf(HTMLInputElement);
  });

  it('required показывает звёздочку', () => {
    render(
      <FormField label="Телефон" required>
        <Input />
      </FormField>,
    );
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('error выводится, hint перекрывается ошибкой', () => {
    render(
      <FormField label="L" error="Неверный формат" hint="Пример: +48...">
        <Input />
      </FormField>,
    );
    expect(screen.getByText('Неверный формат')).toBeInTheDocument();
    expect(screen.queryByText('Пример: +48...')).not.toBeInTheDocument();
  });

  it('hint показывается если нет error', () => {
    render(
      <FormField label="L" hint="Подсказка">
        <Input />
      </FormField>,
    );
    expect(screen.getByText('Подсказка')).toBeInTheDocument();
  });

  it('без label — лейбл не рендерится', () => {
    const { container } = render(
      <FormField>
        <Input placeholder="x" />
      </FormField>,
    );
    expect(container.querySelector('label')).toBeNull();
  });
});

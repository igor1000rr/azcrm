// Client-фильтр месяца для /birthdays.
// Вынесен из page.tsx потому что в Server Component нельзя использовать onChange.
'use client';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export function MonthFilter({ value }: { value: number | null }) {
  return (
    <form method="GET" className="flex items-center gap-2">
      <select
        name="month"
        defaultValue={value ?? ''}
        onChange={(e) => e.currentTarget.form?.submit()}
        className="text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper"
      >
        <option value="">Все месяцы (по порядку)</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>
    </form>
  );
}

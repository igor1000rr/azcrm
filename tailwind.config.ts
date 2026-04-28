import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Основа
        bg:    { DEFAULT: '#FAFAFA', alt: '#F4F4F5' },
        paper: { DEFAULT: '#FFFFFF', alt: '#FCFCFD' },

        // Линии
        line: {
          DEFAULT: '#ECECEC',
          2:       '#F4F4F4',
          strong:  '#DDDDDD',
        },

        // Текст
        ink: {
          DEFAULT: '#18181B',
          2:       '#3F3F46',
          3:       '#71717A',
          4:       '#A1A1AA',
          5:       '#D4D4D8',
        },

        // Бренд navy — расширенная палитра. Раньше было только 3 оттенка
        // и для светлых акцентов использовался opacity-modifier (text-navy/60).
        // Но на белом фоне navy с opacity 60% даёт rgb(108,118,134) —
        // визуально почти неотличимо от обычного серого ink-3 rgb(113,113,122).
        // Поэтому добавили ЯВНЫЕ синеватые оттенки которые точно видны.
        navy: {
          DEFAULT: '#0A1A35',  // основной тёмный navy
          soft:    '#1F2D4A',  // для hover активных элементов
          medium:  '#2D4373',  // для labels и заголовков (ВИДИМО синий)
          light:   '#4A6BA0',  // для подсказок и менее важного текста
          tint:    '#E8EEFA',  // очень лёгкий синеватый фон для активных элементов
          deep:    '#050E1E',
        },
        gold: {
          DEFAULT: '#B8924A',
          light:   '#D4B97A',
          pale:    '#F5EDD9',
        },

        // Семантика
        success: { DEFAULT: '#16A34A', bg: '#F0FDF4' },
        danger:  { DEFAULT: '#DC2626', bg: '#FEF2F2' },
        warn:    { DEFAULT: '#CA8A04', bg: '#FEFCE8' },
        info:    { DEFAULT: '#2563EB', bg: '#EFF6FF' },

        // Каналы
        wa:  { DEFAULT: '#25D366', alt: '#128C7E' },
        tg:  '#229ED9',
      },
      fontFamily: {
        sans:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Мелкие пресеты — соответствуют HTML-макету
        '11':  ['11px', { lineHeight: '1.4' }],
        '12':  ['12px', { lineHeight: '1.5' }],
        '13':  ['13px', { lineHeight: '1.5' }],
        '14':  ['14px', { lineHeight: '1.5' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        md:      '8px',
        lg:      '10px',
        xl:      '12px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.04)',
        md: '0 4px 16px rgba(0,0,0,0.06)',
        lg: '0 12px 32px rgba(0,0,0,0.10)',
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(220,38,38,0.4)' },
          '50%':      { boxShadow: '0 0 0 4px rgba(220,38,38,0)'   },
        },
      },
    },
  },
  plugins: [],
};

export default config;

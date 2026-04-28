import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Основа — фон страницы теперь брендовый лёгко синеватый (не белый).
        // На этом фоне белые карточки (paper) выделяются и выглядят брендированно.
        bg:    { DEFAULT: '#F1F5FC', alt: '#E6ECF7' },     // было #FAFAFA / #F4F4F5
        paper: { DEFAULT: '#FFFFFF', alt: '#FCFCFD' },

        // Линии — лёгко синеватые вместо чисто серых
        line: {
          DEFAULT: '#D9E1ED',  // было #ECECEC
          2:       '#E8EDF6',  // было #F4F4F4
          strong:  '#BFCBDD',  // было #DDDDDD
        },

        // Текст
        ink: {
          DEFAULT: '#18181B',
          2:       '#3F3F46',
          3:       '#71717A',
          4:       '#A1A1AA',
          5:       '#D4D4D8',
        },

        // Бренд navy — расширенная палитра
        navy: {
          DEFAULT: '#0A1A35',  // основной тёмный navy
          soft:    '#1F2D4A',  // для hover активных элементов
          medium:  '#2D4373',  // для labels и заголовков (видимый)
          light:   '#4A6BA0',  // для подсказок
          tint:    '#DCE5F5',  // более насыщенный синий фон для активных
          deep:    '#050E1E',
        },
        gold: {
          DEFAULT: '#B8924A',
          light:   '#D4B97A',
          pale:    '#F5EDD9',
        },

        success: { DEFAULT: '#16A34A', bg: '#F0FDF4' },
        danger:  { DEFAULT: '#DC2626', bg: '#FEF2F2' },
        warn:    { DEFAULT: '#CA8A04', bg: '#FEFCE8' },
        info:    { DEFAULT: '#2563EB', bg: '#EFF6FF' },

        wa:  { DEFAULT: '#25D366', alt: '#128C7E' },
        tg:  '#229ED9',
      },
      fontFamily: {
        sans:    ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
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
        sm: '0 1px 2px rgba(10,26,53,0.05)',         // теперь тень с navy подтоном
        md: '0 4px 16px rgba(10,26,53,0.08)',
        lg: '0 12px 32px rgba(10,26,53,0.12)',
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

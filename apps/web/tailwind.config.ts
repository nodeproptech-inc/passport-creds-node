import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/modules/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          cyan: '#4A9EFF',
          teal: '#3DDBD9',
          'cyan-dark': '#2B7FE0',
          'teal-dark': '#28C5C3',
          navy: '#0D1428',
          'navy-mid': '#141E38',
          'navy-light': '#1E2D4D',
          'navy-card': '#172040',
        },
        surface: {
          light: '#F0F2F6',
          white: '#FFFFFF',
          subtle: '#F8F9FC',
          border: '#DDE1EA',
        },
        content: {
          heading: '#0D1428',
          body: '#4B5568',
          muted: '#9CA3AF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(90deg, #4A9EFF 0%, #3DDBD9 100%)',
        'gradient-card-dark':
          'linear-gradient(135deg, rgba(74,158,255,0.08) 0%, rgba(61,219,217,0.04) 100%)',
      },
    },
  },
  plugins: [],
};

export default config;

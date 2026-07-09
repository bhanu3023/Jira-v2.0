import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        jira: {
          blue: '#1264A3',
          lightBlue: '#4C9AFF',
          dark: '#172B4D',
          gray: '#6B778C',
          lightGray: '#F4F5F7',
          border: '#DFE1E6',
        },
      },
    },
  },
  plugins: [],
};

export default config;

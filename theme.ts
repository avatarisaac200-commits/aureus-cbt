export type AppTheme = 'classic' | 'neo' | 'gold' | 'glass' | 'neo-black' | 'custom';

export interface ThemeOption {
  id: AppTheme;
  name: string;
  description: string;
  previewClass: string;
}

export const THEMES: ThemeOption[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Current slate and amber look.',
    previewClass: 'from-slate-950 via-slate-900 to-amber-500'
  },
  {
    id: 'neo',
    name: 'Neo',
    description: 'Cyan and lime with a sharper digital feel.',
    previewClass: 'from-cyan-500 via-sky-500 to-lime-400'
  },
  {
    id: 'gold',
    name: 'Gold',
    description: 'Warmer brass palette with cream surfaces.',
    previewClass: 'from-amber-700 via-yellow-600 to-orange-300'
  },
  {
    id: 'glass',
    name: 'Pink Dynamic Glass',
    description: 'Pink frosted glass with dynamic accent highlights.',
    previewClass: 'from-pink-200 via-rose-300 to-fuchsia-500'
  },
  {
    id: 'neo-black',
    name: 'Neo Black',
    description: 'Black and white with a sharp monochrome shell.',
    previewClass: 'from-black via-zinc-900 to-white'
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Design your own palette.',
    previewClass: 'from-fuchsia-500 via-orange-400 to-cyan-400'
  }
];

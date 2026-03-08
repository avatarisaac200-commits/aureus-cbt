const GLASS_ACCENT_VAR = '--glass-accent';

const PINK_MAGENTA_PALETTE = [
  '#ff5ea8',
  '#ff4d94',
  '#ff2f87',
  '#f72585',
  '#e11d8a',
  '#d946ef',
  '#c026d3',
  '#be185d',
  '#ec4899',
  '#f472b6'
];

const hexToRgb = (hex: string) => {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
};

const rgbStringToHex = (rgb: string): string | null => {
  const match = rgb.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) return null;
  const r = Math.max(0, Math.min(255, Number(match[1])));
  const g = Math.max(0, Math.min(255, Number(match[2])));
  const b = Math.max(0, Math.min(255, Number(match[3])));
  if (![r, g, b].every(Number.isFinite)) return null;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const colorDistance = (a: string, b: string) => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return Number.POSITIVE_INFINITY;
  return (
    (ca.r - cb.r) * (ca.r - cb.r) +
    (ca.g - cb.g) * (ca.g - cb.g) +
    (ca.b - cb.b) * (ca.b - cb.b)
  );
};

const nearestPink = (hex: string) => {
  let best = PINK_MAGENTA_PALETTE[0];
  let bestDistance = colorDistance(hex, best);
  for (const candidate of PINK_MAGENTA_PALETTE.slice(1)) {
    const distance = colorDistance(hex, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};

const readSystemAccent = (): string | null => {
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('div');
  probe.style.color = 'AccentColor';
  probe.style.position = 'fixed';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  probe.style.top = '-1000px';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return rgbStringToHex(color);
};

export const syncGlassAccent = () => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const systemAccent = readSystemAccent() || '#ff5ea8';
  const mapped = nearestPink(systemAccent);
  root.style.setProperty(GLASS_ACCENT_VAR, mapped);
};

export const clearGlassAccent = () => {
  if (typeof document === 'undefined') return;
  document.documentElement.style.removeProperty(GLASS_ACCENT_VAR);
};

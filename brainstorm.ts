export interface BrainstormWindow {
  id: string;
  label: string;
  opensAtLabel: string;
  closesAtLabel: string;
  openMinute: number;
  closeMinute: number;
}

export const ATTENDANCE_ROUTE = '/attendance';
export const BLACKLIST_ROUTE = '/blacklist';
export const BRAINSTORM_TIMEZONE = 'Africa/Lagos';
export const BRAINSTORM_SESSION_TITLE = 'Brainstorm Attendance Portal';
export const BRAINSTORM_STRIKE_LIMIT = 3;
export const BRAINSTORM_PHRASE_WORD_COUNT = 4;

export const DEFAULT_BRAINSTORM_WINDOWS: BrainstormWindow[] = [
  { id: 'window_1', label: 'Window 1', opensAtLabel: '9:00 PM', closesAtLabel: '9:10 PM', openMinute: 21 * 60, closeMinute: 21 * 60 + 10 },
  { id: 'window_2', label: 'Window 2', opensAtLabel: '10:45 PM', closesAtLabel: '10:55 PM', openMinute: 22 * 60 + 45, closeMinute: 22 * 60 + 55 },
  { id: 'window_3', label: 'Window 3', opensAtLabel: '12:20 AM', closesAtLabel: '12:30 AM', openMinute: 24 * 60 + 20, closeMinute: 24 * 60 + 30 }
];

const WORD_BANK = [
  'anatomy', 'artery', 'axon', 'bacillus', 'biopsy', 'bolus', 'cardiac', 'cellular', 'cortex', 'cranial',
  'cytology', 'density', 'dermis', 'enzyme', 'fibrosis', 'frontal', 'gastric', 'genome', 'glucose', 'hepatic',
  'histology', 'humerus', 'immunity', 'incision', 'insulin', 'isotope', 'kidney', 'larynx', 'ligament', 'medulla',
  'membrane', 'mitosis', 'molecule', 'mucosa', 'muscular', 'nephron', 'neuron', 'nucleus', 'optics', 'orbital',
  'oxygen', 'pelvis', 'peptide', 'plasma', 'platelet', 'protein', 'pulmonary', 'radius', 'reflex', 'retina',
  'ribosome', 'sodium', 'spinal', 'sternum', 'synapse', 'tendon', 'thorax', 'thyroid', 'tissue', 'trachea',
  'ulna', 'ureter', 'vaccine', 'venous', 'ventral', 'vertebra', 'vision', 'vitamin', 'waveform', 'zygote'
];

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const getLagosDateParts = (date = new Date()) => {
  const lagosShiftMs = 60 * 60 * 1000;
  const shifted = new Date(date.getTime() + lagosShiftMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  return {
    year,
    month,
    day,
    hours,
    minutes,
    totalMinutes,
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
};

const shiftDateKey = (dateKey: string, dayOffset: number) => {
  const [year, month, day] = String(dateKey || '').split('-').map((part) => Number(part));
  const next = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + dayOffset));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

const normalizeRelativeMinute = (minute: number) => {
  const modulo = ((Math.trunc(minute) % 1440) + 1440) % 1440;
  return modulo;
};

export const minutesToTimeInputValue = (totalMinutes: number) => {
  const safe = normalizeRelativeMinute(totalMinutes);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const timeInputValueToMinutes = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const minutesToLabel = (totalMinutes: number) => {
  const safe = normalizeRelativeMinute(totalMinutes);
  const hours24 = Math.floor(safe / 60);
  const minutes = safe % 60;
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  return `${hours12}:${String(minutes).padStart(2, '0')} ${meridiem}`;
};

export const sanitizeBrainstormWindows = (value: any): BrainstormWindow[] => {
  if (!Array.isArray(value)) return DEFAULT_BRAINSTORM_WINDOWS;

  const rows = value
    .map((item, index) => {
      const openMinute = Number(item?.openMinute);
      const closeMinute = Number(item?.closeMinute);
      if (!Number.isFinite(openMinute) || !Number.isFinite(closeMinute) || closeMinute <= openMinute) return null;
      return {
        id: String(item?.id || `window_${index + 1}`),
        label: String(item?.label || `Window ${index + 1}`),
        openMinute: Math.max(0, Math.min(2 * 1440, Math.trunc(openMinute))),
        closeMinute: Math.max(0, Math.min(2 * 1440, Math.trunc(closeMinute))),
        opensAtLabel: minutesToLabel(openMinute),
        closesAtLabel: minutesToLabel(closeMinute)
      } as BrainstormWindow;
    })
    .filter(Boolean) as BrainstormWindow[];

  return rows.length > 0 ? rows.sort((a, b) => a.openMinute - b.openMinute) : DEFAULT_BRAINSTORM_WINDOWS;
};

export const getBrainstormSessionCloseMinute = (windows: BrainstormWindow[] = DEFAULT_BRAINSTORM_WINDOWS) => {
  return windows.reduce((max, window) => Math.max(max, window.closeMinute), 0);
};

export const getBrainstormSessionContext = (date = new Date(), windows: BrainstormWindow[] = DEFAULT_BRAINSTORM_WINDOWS) => {
  const lagos = getLagosDateParts(date);
  const hasAfterMidnightWindow = windows.some((window) => window.openMinute >= 1440 || window.closeMinute > 1440);
  const overnightCutoff = windows.reduce((max, window) => {
    if (window.closeMinute <= 1440) return max;
    return Math.max(max, window.closeMinute - 1440);
  }, 0);

  if (hasAfterMidnightWindow && overnightCutoff > 0 && lagos.totalMinutes < overnightCutoff) {
    return {
      ...lagos,
      dateKey: shiftDateKey(lagos.dateKey, -1),
      totalMinutes: lagos.totalMinutes + 1440
    };
  }

  return lagos;
};

export const getCurrentBrainstormWindow = (date = new Date(), windows: BrainstormWindow[] = DEFAULT_BRAINSTORM_WINDOWS) => {
  const { totalMinutes } = getBrainstormSessionContext(date, windows);
  return windows.find((window) => totalMinutes >= window.openMinute && totalMinutes < window.closeMinute) || null;
};

export const generateBrainstormPhrase = (userId: string, dateKey: string) => {
  const seed = hashString(`${userId}:${dateKey}:brainstorm`);
  const chosen: string[] = [];

  for (let i = 0; chosen.length < BRAINSTORM_PHRASE_WORD_COUNT && i < WORD_BANK.length * 2; i += 1) {
    const index = (seed + i * 17 + i * i * 13) % WORD_BANK.length;
    const candidate = WORD_BANK[index];
    if (!chosen.includes(candidate)) chosen.push(candidate);
  }

  return chosen.join(' ');
};

export const normalizePhrase = (value: string) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

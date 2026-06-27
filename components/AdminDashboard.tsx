
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { User, Question, TestSection, MockTest, ExamResult, DifficultyLevel, TestGenerationMode, CsvBundleCategoryField, CsvQuestionBundle, QuestionTagInsight, PrepMode } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, getDoc, deleteDoc, doc, query, updateDoc, setDoc, writeBatch, limit, where, documentId, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { GoogleGenAI } from '@google/genai';
import ScientificText from './ScientificText';
import AdminAnalytics from './AdminAnalytics';
import AdminVideoManager from './AdminVideoManager';
import logo from '../assets/scholar-main.png';
import PartnershipLogos from './PartnershipLogos';
import { DEFAULT_PREP_MODE, PREP_MODE_LABELS, PREP_MODES } from '../lib/prepModes';
import { toast } from './ui/Toast';
import { confirmDialog } from './ui/ConfirmDialog';
import { DEFAULT_BRAINSTORM_WINDOWS, minutesToLabel, minutesToTimeInputValue, sanitizeBrainstormWindows, timeInputValueToMinutes } from '../brainstorm';

interface AdminDashboardProps {
  user: User;
  initialTab?: AdminTab;
  onLogout: () => void;
  onSwitchToStudent: () => void;
  onOpenCourses?: () => void;
}

type AdminTab = 'questions' | 'create-test' | 'tests' | 'import' | 'analytics' | 'videos' | 'attendance' | 'license-keys';
type StagedQuestion = Omit<Question, 'id' | 'createdAt' | 'createdBy'> & { selected?: boolean };
type EditableCsvQuestion = StagedQuestion & { id: string };
type EditingMediaTarget =
  | { kind: 'question-form' }
  | { kind: 'csv-test-question'; id: string }
  | { kind: 'test-question'; id: string };
type EditableBrainstormWindow = { id: string; label: string; openTime: string; closeTime: string };
type TestEditAutosaveDraft = {
  version: 1;
  testId: string;
  userId: string;
  generationMode: TestGenerationMode;
  prepMode: PrepMode;
  updatedAt: string;
  name: string;
  description: string;
  durationMinutes: number;
  passwordEnabled: boolean;
  password: string;
  isArchived: boolean;
  csvQuestionCount: number;
  csvMarksPerQuestion: number;
  csvBundleEnabled: boolean;
  csvBundleCategoryField: CsvBundleCategoryField;
  csvBundleSize: number;
  testQuestions: EditableCsvQuestion[];
  csvQuestions: EditableCsvQuestion[];
};

const normalizeText = (text: string) => text.toLowerCase().trim().replace(/\s+/g, ' ');
const normalizeOptions = (options: string[]) => options.map(opt => opt.trim());
const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const toSortableTime = (value?: string) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};
const padNumber = (value: number, width: number) => String(Math.max(0, Math.trunc(value))).padStart(width, '0');
const toLeaderboardSortKey = (averagePercent: number, bestPercent: number, attempts: number, lastCompletedAt?: string) => {
  const avgBasisPoints = Math.round(clampPercent(averagePercent) * 100);
  const bestBasisPoints = Math.round(clampPercent(bestPercent) * 100);
  return [
    padNumber(avgBasisPoints, 5),
    padNumber(bestBasisPoints, 5),
    padNumber(Math.min(Math.max(0, attempts), 99999), 5),
    padNumber(Math.min(toSortableTime(lastCompletedAt), 9999999999999), 13)
  ].join(':');
};
const areOptionsChanged = (prev: string[], next: string[]) => {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].trim() !== next[i].trim()) return true;
  }
  return false;
};
const chunkArray = <T,>(arr: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};
const toEditableBrainstormWindows = (windows: ReturnType<typeof sanitizeBrainstormWindows>): EditableBrainstormWindow[] =>
  windows.map((window) => ({
    id: window.id,
    label: window.label,
    openTime: minutesToTimeInputValue(window.openMinute),
    closeTime: minutesToTimeInputValue(window.closeMinute)
  }));
const DEADLINE_CONFIG_DOC_ID = 'deadline_config';
const DEFAULT_FREE_ACCESS_ENDS_AT_ISO = '2026-04-01T23:00:00.000Z'; // April 2, 2026 00:00 WAT

const toWatInputValue = (iso: string) => {
  const ms = Date.parse(iso);
  const safeMs = Number.isFinite(ms) ? ms : Date.parse(DEFAULT_FREE_ACCESS_ENDS_AT_ISO);
  const wat = new Date(safeMs + 60 * 60 * 1000);
  const y = wat.getUTCFullYear();
  const m = String(wat.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wat.getUTCDate()).padStart(2, '0');
  const h = String(wat.getUTCHours()).padStart(2, '0');
  const min = String(wat.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
};

const watInputToIso = (value: string): string | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const h = Number(match[4]);
  const min = Number(match[5]);
  if ([y, m, d, h, min].some(v => !Number.isFinite(v))) return null;
  return new Date(Date.UTC(y, m - 1, d, h - 1, min, 0, 0)).toISOString();
};

const makeLicenseKey = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${part()}-${part()}-${part()}`;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DEFAULT_DIFFICULTY: DifficultyLevel = 'medium';
const TEST_EDIT_AUTOSAVE_PREFIX = 'adminTestEditAutosave';
const TEST_EDIT_ACTIVE_AUTOSAVE_PREFIX = 'adminTestEditAutosaveActive';
const MEDIA_PICKER_ORIGIN = 'https://aureus-cbt-question-media.pages.dev';
const MEDIA_PICKER_URL = `${MEDIA_PICKER_ORIGIN}/picker.html`;
const CSV_IMPORT_HEADERS = [
  'subject',
  'topic',
  'text',
  'optionA',
  'optionB',
  'optionC',
  'optionD',
  'correctAnswer',
  'explanation',
  'difficulty',
  'tags',
  'source',
  'year',
  'examType',
  'imageUrl',
  'imageAlt',
  'status',
  'isActive'
] as const;
const CSV_IMPORT_HEADER_LINE = CSV_IMPORT_HEADERS.join(',');

const parseList = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
const sanitizeOptionalUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    return '';
  }
  return '';
};
const CSV_BUNDLE_CATEGORY_OPTIONS: CsvBundleCategoryField[] = ['subject', 'topic', 'difficulty', 'examType'];
const normalizeDifficulty = (value: string): DifficultyLevel => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'easy' || normalized === 'hard') return normalized;
  return 'medium';
};
const getCsvBundleCategoryValue = (q: Pick<Question, 'subject' | 'topic' | 'difficulty' | 'examType'>, field: CsvBundleCategoryField) => {
  if (field === 'subject') return (q.subject || 'General').trim() || 'General';
  if (field === 'topic') return (q.topic || 'General').trim() || 'General';
  if (field === 'difficulty') return normalizeDifficulty(String(q.difficulty || DEFAULT_DIFFICULTY));
  return (q.examType || 'General').trim() || 'General';
};
const buildCsvBundles = (
  questionsWithIds: Array<{ id: string; question: StagedQuestion }>,
  categoryField: CsvBundleCategoryField,
  bundleSize: number
): CsvQuestionBundle[] => {
  const normalizedSize = Math.max(1, Number(bundleSize) || 1);
  const grouped: Record<string, string[]> = {};
  questionsWithIds.forEach(({ id, question }) => {
    const category = getCsvBundleCategoryValue(question, categoryField);
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(id);
  });

  const bundles: CsvQuestionBundle[] = [];
  let serial = 1;
  Object.entries(grouped)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([category, ids]) => {
      for (let i = 0; i < ids.length; i += normalizedSize) {
        const slice = ids.slice(i, i + normalizedSize);
        bundles.push({
          id: `bundle_${serial}`,
          name: `Bundle ${serial} - ${slice.length} Questions`,
          category,
          categoryField,
          questionIds: slice,
          questionCount: slice.length
        });
        serial++;
      }
    });
  return bundles;
};
const toEditableQuestionRow = (q: Question): EditableCsvQuestion => ({
  id: q.id,
  subject: q.subject || 'General',
  topic: q.topic || 'General',
  text: q.text || '',
  options: Array.isArray(q.options) ? q.options.slice(0, 4) : ['', '', '', ''],
  correctAnswerIndex: Number.isFinite(Number(q.correctAnswerIndex)) ? Number(q.correctAnswerIndex) : 0,
  explanation: q.explanation || '',
  difficulty: normalizeDifficulty(String(q.difficulty || DEFAULT_DIFFICULTY)),
  tags: Array.isArray(q.tags) ? q.tags : [],
  source: q.source || '',
  year: q.year ?? null,
  examType: q.examType || '',
  imageUrl: q.imageUrl || '',
  imageAlt: q.imageAlt || '',
  status: q.status || 'approved',
  isActive: q.isActive !== false,
  normalizedText: q.normalizedText || normalizeText(q.text || '')
});
const toBoolean = (value: string, fallback = true) => {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;
  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
  return fallback;
};

const matchesSectionFilters = (q: Question, section: TestSection) => {
  if (q.isActive === false) return false;
  if ((q.status || 'approved') === 'draft') return false;
  const subjects = new Set((section.sampleFilters?.subjects || []).map(s => s.toLowerCase().trim()).filter(Boolean));
  const topics = new Set((section.sampleFilters?.topics || []).map(s => s.toLowerCase().trim()).filter(Boolean));
  const tags = new Set((section.sampleFilters?.tags || []).map(s => s.toLowerCase().trim()).filter(Boolean));
  const difficulties = new Set((section.sampleFilters?.difficulties || []).map(d => d.toLowerCase().trim()).filter(Boolean));

  if (subjects.size > 0 && !subjects.has((q.subject || '').toLowerCase().trim())) return false;
  if (topics.size > 0 && !topics.has((q.topic || '').toLowerCase().trim())) return false;
  if (difficulties.size > 0 && !difficulties.has(normalizeDifficulty(q.difficulty || DEFAULT_DIFFICULTY))) return false;
  if (tags.size > 0) {
    const qTags = (q.tags || []).map(t => t.toLowerCase().trim());
    if (!qTags.some(t => tags.has(t))) return false;
  }
  return true;
};
const parseCsvRows = (text: string): Array<Record<string, string>> => {
  const rowsRaw: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\n' && !inQuotes) {
      row.push(cell.trim());
      if (row.some(v => v.length > 0)) rowsRaw.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some(v => v.length > 0)) rowsRaw.push(row);
  }

  if (rowsRaw.length < 2) return [];
  const headers = rowsRaw[0].map(h => h.trim().toLowerCase());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < rowsRaw.length; i++) {
    const values = rowsRaw[i];
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
};

const mapCsvRowsToStagedQuestions = (rows: Array<Record<string, string>>) => {
  rows.forEach((row) => {
    if (!row.correctanswer && row.correctanswerindex) row.correctanswer = row.correctanswerindex;
  });

  const required = ['text', 'optiona', 'optionb', 'optionc', 'optiond', 'correctanswer'];
  const first = rows[0] || {};
  const missing = required.filter(col => !(col in first));
  if (missing.length > 0) {
    throw new Error(`Missing required CSV columns: ${missing.join(', ')}`);
  }

  const mapped: StagedQuestion[] = [];
  const errors: string[] = [];
  rows.forEach((row, idx) => {
    const rowNo = idx + 2;
    const textValue = (row.text || '').trim();
    const options = [row.optiona || '', row.optionb || '', row.optionc || '', row.optiond || ''].map(v => v.trim());
    const answerRaw = (row.correctanswer || '').trim();

    if (!textValue || options.some(opt => !opt)) {
      errors.push(`Row ${rowNo}: text/options missing.`);
      return;
    }

    let correctAnswerIndex = Number(answerRaw);
    if (!Number.isFinite(correctAnswerIndex)) {
      const map: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
      correctAnswerIndex = map[answerRaw.toLowerCase()];
    }
    if (!Number.isFinite(correctAnswerIndex) || correctAnswerIndex < 0 || correctAnswerIndex > 3) {
      errors.push(`Row ${rowNo}: correctAnswer must be A-D or 0-3.`);
      return;
    }

    mapped.push({
      subject: (row.subject || 'General').trim() || 'General',
      topic: (row.topic || 'General').trim() || 'General',
      text: textValue,
      options,
      correctAnswerIndex,
      explanation: (row.explanation || '').trim(),
      difficulty: normalizeDifficulty(row.difficulty || DEFAULT_DIFFICULTY),
      tags: parseList(row.tags || ''),
      source: (row.source || '').trim(),
      year: row.year ? (Number.isFinite(Number(row.year)) ? Number(row.year) : null) : null,
      examType: (row.examtype || '').trim(),
      imageUrl: sanitizeOptionalUrl(row.imageurl || ''),
      imageAlt: (row.imagealt || '').trim(),
      status: (row.status || 'approved').trim().toLowerCase() === 'draft' ? 'draft' : 'approved',
      isActive: toBoolean(row.isactive || 'true', true),
      selected: true
    });
  });

  if (mapped.length === 0) {
    throw new Error(errors[0] || 'No valid rows were found in CSV.');
  }

  return { mapped, errors };
};

const escapeCsvCell = (value: unknown) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const toAnswerLetter = (index: unknown) => {
  const n = Number(index);
  const letters = ['A', 'B', 'C', 'D'];
  if (Number.isFinite(n) && n >= 0 && n <= 3) return letters[n];
  return 'A';
};

const buildQuestionsCsv = (rows: Array<Pick<Question, 'subject' | 'topic' | 'text' | 'options' | 'correctAnswerIndex' | 'explanation' | 'difficulty' | 'tags' | 'source' | 'year' | 'examType' | 'imageUrl' | 'imageAlt' | 'status' | 'isActive'>>) => {
  const lines = [
    CSV_IMPORT_HEADER_LINE,
    ...rows.map((q) => {
      const options = Array.isArray(q.options) ? q.options : [];
      const ordered = [options[0] || '', options[1] || '', options[2] || '', options[3] || ''];
      const values = [
        (q.subject || 'General').trim() || 'General',
        (q.topic || 'General').trim() || 'General',
        (q.text || '').trim(),
        ordered[0],
        ordered[1],
        ordered[2],
        ordered[3],
        toAnswerLetter(q.correctAnswerIndex),
        q.explanation || '',
        normalizeDifficulty(String(q.difficulty || DEFAULT_DIFFICULTY)),
        Array.isArray(q.tags) ? q.tags.join(', ') : '',
        q.source || '',
        q.year ?? '',
        q.examType || '',
        q.imageUrl || '',
        q.imageAlt || '',
        q.status === 'draft' ? 'draft' : 'approved',
        q.isActive === false ? 'false' : 'true'
      ];
      return values.map(escapeCsvCell).join(',');
    })
  ];
  return lines.join('\n');
};

const downloadCsv = (fileName: string, csvContent: string) => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const pickCsvFile = (files: FileList | null) => {
  if (!files || files.length === 0) return null;
  const list = Array.from(files);
  return list.find((file) => file.name.toLowerCase().endsWith('.csv') || file.type.toLowerCase().includes('csv')) || null;
};

const normalizeExtractedQuestions = (input: any): StagedQuestion[] => {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((item: any) => {
      const optionsRaw = Array.isArray(item?.options) ? item.options : [];
      const options = optionsRaw
        .map((opt: any) => String(opt ?? '').trim())
        .filter(Boolean)
        .slice(0, 4);
      while (options.length < 4) options.push('');

      const correctAnswerIndex = Number(item?.correctAnswerIndex);
      if (!Number.isFinite(correctAnswerIndex) || correctAnswerIndex < 0 || correctAnswerIndex > 3) return null;

      const text = String(item?.text ?? '').trim();
      if (!text || options.some((opt: string) => !opt)) return null;

      return {
        subject: String(item?.subject ?? 'General').trim() || 'General',
        topic: String(item?.topic ?? 'General').trim() || 'General',
        text,
        options,
        correctAnswerIndex,
        explanation: String(item?.explanation ?? '').trim(),
        difficulty: normalizeDifficulty(String(item?.difficulty ?? DEFAULT_DIFFICULTY)),
        tags: Array.isArray(item?.tags) ? item.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
        status: 'approved',
        isActive: true,
        selected: true
      } as StagedQuestion;
    })
    .filter(Boolean) as StagedQuestion[];
};

const decodePdfBase64ToText = (base64Data: string) => {
  try {
    const binary = atob(base64Data);
    const textFragments = binary.match(/[ -~\r\n\t]{4,}/g) || [];
    return textFragments.join('\n');
  } catch {
    return '';
  }
};

const extractQuestionsFromPdfTextFallback = (rawText: string): StagedQuestion[] => {
  if (!rawText) return [];
  const text = rawText.replace(/\r/g, '\n');
  const blocks = text.split(/\n(?=\s*(?:\d+[\).\s]|Q(?:UESTION)?\s*\d+[:.]?))/i);
  const results: StagedQuestion[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 5) continue;

    const firstLine = lines[0];
    const qMatch = firstLine.match(/^(?:\d+[\).\s-]*|Q(?:UESTION)?\s*\d+[:.]?\s*)(.+)$/i);
    const questionText = (qMatch?.[1] || firstLine).trim();
    if (!questionText || questionText.length < 10) continue;

    const options: string[] = [];
    let answerIndex = -1;

    for (const line of lines.slice(1)) {
      const optMatch = line.match(/^[\(\[]?([A-D])[\)\].:\s-]+(.+)$/i);
      if (optMatch && options.length < 4) {
        options.push(optMatch[2].trim());
        continue;
      }

      const answerMatch = line.match(/^(?:ANS|ANSWER)[:\s]+([A-D])$/i);
      if (answerMatch) {
        answerIndex = answerMatch[1].toUpperCase().charCodeAt(0) - 65;
      }
    }

    if (options.length === 4 && answerIndex >= 0 && answerIndex <= 3) {
      results.push({
        subject: 'General',
        topic: 'General',
        text: questionText,
        options,
        correctAnswerIndex: answerIndex,
        explanation: '',
        difficulty: DEFAULT_DIFFICULTY,
        tags: [],
        status: 'approved',
        isActive: true,
        selected: true
      });
    }
  }

  return results;
};

const renderPdfPagesToBase64Images = async (_base64Data: string, _maxPages: number): Promise<string[]> => {
  // Placeholder: browser-side PDF rasterization requires pdf.js, which is not currently bundled.
  return [];
};

const extractQuestionsFromImagesWithGemini = async (ai: GoogleGenAI, pageImages: string[]): Promise<StagedQuestion[]> => {
  if (pageImages.length === 0) return [];
  const prompt = `
Extract CBT multiple-choice questions from these page images.
Return ONLY a JSON array in this exact shape:
[
  {
    "subject": "string",
    "topic": "string",
    "text": "string",
    "options": ["string","string","string","string"],
    "correctAnswerIndex": 0,
    "explanation": "string"
  }
]
Rules:
- Exactly 4 options per question.
- correctAnswerIndex must be 0..3.
- Skip incomplete questions.
`.trim();

  try {
    const parts: any[] = pageImages.slice(0, 8).map((img) => ({
      inlineData: { mimeType: 'image/png', data: img }
    }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: { parts },
      config: { responseMimeType: 'application/json' }
    });

    const raw = (response.text || '').trim();
    if (!raw) return [];
    const cleaned = raw.startsWith('```')
      ? raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
      : raw;
    return normalizeExtractedQuestions(JSON.parse(cleaned));
  } catch {
    return [];
  }
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, initialTab = 'questions', onLogout, onSwitchToStudent, onOpenCourses }) => {
  const notify = (message: string) => {
    toast.info('Notice', String(message));
  };
  const canManageKeys = user.role === 'root-admin';
  const [activeTab, setActiveTab] = useState<AdminTab>(canManageKeys || initialTab !== 'license-keys' ? initialTab : 'questions');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [bankSearchQuery, setBankSearchQuery] = useState('');
  const [builderSearchQuery, setBuilderSearchQuery] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [collapsedSubjects, setCollapsedSubjects] = useState<Record<string, boolean>>({});
  const [tagInsights, setTagInsights] = useState<QuestionTagInsight[]>([]);
  const [tagInsightsLoading, setTagInsightsLoading] = useState(false);
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [managedTests, setManagedTests] = useState<MockTest[]>([]);
  const [managedTestsLoading, setManagedTestsLoading] = useState(false);
  const [editingTestId, setEditingTestId] = useState<string | null>(null);
  const [editingTest, setEditingTest] = useState<MockTest | null>(null);
  const [adminPrepModeFilter, setAdminPrepModeFilter] = useState<PrepMode | 'all'>('all');
  const [editTestPrepMode, setEditTestPrepMode] = useState<PrepMode>(DEFAULT_PREP_MODE);
  const [editTestName, setEditTestName] = useState('');
  const [editTestDesc, setEditTestDesc] = useState('');
  const [editTestDuration, setEditTestDuration] = useState(60);
  const [editTestPasswordEnabled, setEditTestPasswordEnabled] = useState(false);
  const [editTestPassword, setEditTestPassword] = useState('');
  const [editTestArchived, setEditTestArchived] = useState(false);
  const [editingTestQuestions, setEditingTestQuestions] = useState<EditableCsvQuestion[]>([]);
  const [editingTestQuestionsLoading, setEditingTestQuestionsLoading] = useState(false);
  const [editingCsvQuestions, setEditingCsvQuestions] = useState<EditableCsvQuestion[]>([]);
  const [editingCsvLoading, setEditingCsvLoading] = useState(false);
  const [editingCsvQuestionCount, setEditingCsvQuestionCount] = useState(20);
  const [editingCsvMarksPerQuestion, setEditingCsvMarksPerQuestion] = useState(1);
  const [editingCsvBundleEnabled, setEditingCsvBundleEnabled] = useState(false);
  const [editingCsvBundleCategoryField, setEditingCsvBundleCategoryField] = useState<CsvBundleCategoryField>('subject');
  const [editingCsvBundleSize, setEditingCsvBundleSize] = useState(100);
  const [editAutosaveStatus, setEditAutosaveStatus] = useState('');
  const editAutosaveReadyRef = useRef(false);
  const editAutosaveTimerRef = useRef<number | null>(null);
  const pendingAutosaveRestoreRef = useRef<string | null>(null);
  const restoringAutosaveRef = useRef(false);
  
  // Test Builder State
  const [testName, setTestName] = useState('');
  const [testDesc, setTestDesc] = useState('');
  const [testPrepMode, setTestPrepMode] = useState<PrepMode>(DEFAULT_PREP_MODE);
  const [testDuration, setTestDuration] = useState(60);
  const [testGenerationMode, setTestGenerationMode] = useState<TestGenerationMode>('fixed');
  const [csvDynamicQuestions, setCsvDynamicQuestions] = useState<StagedQuestion[]>([]);
  const [csvDynamicFileName, setCsvDynamicFileName] = useState('');
  const [csvDynamicQuestionCount, setCsvDynamicQuestionCount] = useState(20);
  const [csvDynamicMarksPerQuestion, setCsvDynamicMarksPerQuestion] = useState(1);
  const [csvBundleEnabled, setCsvBundleEnabled] = useState(false);
  const [csvBundleCategoryField, setCsvBundleCategoryField] = useState<CsvBundleCategoryField>('subject');
  const [csvBundleSize, setCsvBundleSize] = useState(100);
  const [allowRetake, setAllowRetake] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState<number | ''>('');
  const [testPasswordEnabled, setTestPasswordEnabled] = useState(false);
  const [testPassword, setTestPassword] = useState('');
  const [testArchived, setTestArchived] = useState(false);
  const [sections, setSections] = useState<TestSection[]>([
    {
      id: 'sec_' + Date.now(),
      name: 'Section 1',
      questionIds: [],
      marksPerQuestion: 1,
      questionCount: 20,
      sampleFilters: { subjects: [], topics: [], difficulties: ['easy', 'medium', 'hard'], tags: [] },
      difficultyMix: { easy: 30, medium: 50, hard: 20 }
    }
  ]);
  const [activeBuilderSection, setActiveBuilderSection] = useState(0);

  // Question Form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qSubject, setQSubject] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qText, setQText] = useState('');
  const [qOptions, setQOptions] = useState(['', '', '', '']);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState('');
  const [qPrepMode, setQPrepMode] = useState<PrepMode>(DEFAULT_PREP_MODE);
  const [qDifficulty, setQDifficulty] = useState<DifficultyLevel>(DEFAULT_DIFFICULTY);
  const [qTags, setQTags] = useState('');
  const [qImageUrl, setQImageUrl] = useState('');
  const [qImageAlt, setQImageAlt] = useState('');
  const [qIsActive, setQIsActive] = useState(true);
  const [editingMediaTarget, setEditingMediaTarget] = useState<EditingMediaTarget>({ kind: 'question-form' });

  // AI Import State
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'review'>('idle');
  const [stagedQuestions, setStagedQuestions] = useState<StagedQuestion[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const dynamicCsvInputRef = useRef<HTMLInputElement>(null);
  const [isImportCsvDragActive, setIsImportCsvDragActive] = useState(false);
  const [isDynamicCsvDragActive, setIsDynamicCsvDragActive] = useState(false);
  const [singleKeyDurationDays, setSingleKeyDurationDays] = useState(365);
  const [bulkKeyCount, setBulkKeyCount] = useState(10);
  const [bulkKeyDurationDays, setBulkKeyDurationDays] = useState(365);
  const [licenseKeyPrepMode, setLicenseKeyPrepMode] = useState<PrepMode>(DEFAULT_PREP_MODE);
  const [generatedKeys, setGeneratedKeys] = useState<string[]>([]);
  const [keyToolLoading, setKeyToolLoading] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState(toWatInputValue(DEFAULT_FREE_ACCESS_ENDS_AT_ISO));
  const [deadlineSaving, setDeadlineSaving] = useState(false);
  const [attendanceWindows, setAttendanceWindows] = useState<EditableBrainstormWindow[]>(toEditableBrainstormWindows(DEFAULT_BRAINSTORM_WINDOWS));
  const [attendanceSaving, setAttendanceSaving] = useState(false);

  useEffect(() => {
    const handleMediaPickerMessage = (event: MessageEvent) => {
      if (event.origin !== MEDIA_PICKER_ORIGIN) return;
      const data = event.data || {};
      if (data.type !== 'aureus-media-selected' || typeof data.url !== 'string') return;
      const imageUrl = sanitizeOptionalUrl(data.url);
      if (!imageUrl) return;
      const imageAlt = String(data.name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      if (editingMediaTarget.kind === 'csv-test-question') {
        setEditingCsvQuestions(prev => prev.map(item => item.id === editingMediaTarget.id ? {
          ...item,
          imageUrl,
          imageAlt: item.imageAlt || imageAlt
        } : item));
      } else if (editingMediaTarget.kind === 'test-question') {
        setEditingTestQuestions(prev => prev.map(item => item.id === editingMediaTarget.id ? {
          ...item,
          imageUrl,
          imageAlt: item.imageAlt || imageAlt
        } : item));
      } else {
        setQImageUrl(imageUrl);
        setQImageAlt((prev) => prev || imageAlt);
      }
      notify('Image selected.');
    };

    window.addEventListener('message', handleMediaPickerMessage);
    return () => window.removeEventListener('message', handleMediaPickerMessage);
  }, [editingMediaTarget]);

  const questionMatchesAdminPrepFilter = (q: Question) => {
    if (adminPrepModeFilter === 'all') return true;
    return ((q.prepMode as PrepMode) || DEFAULT_PREP_MODE) === adminPrepModeFilter;
  };

  const filteredQuestions = useMemo(() => {
    return questions.filter(questionMatchesAdminPrepFilter);
  }, [questions, adminPrepModeFilter]);

  const groupedQuestions = useMemo(() => {
    const groups: Record<string, Question[]> = {};
    filteredQuestions.forEach(q => {
      const subject = q.subject?.trim() || 'General';
      if (!groups[subject]) groups[subject] = [];
      groups[subject].push(q);
    });
    return groups;
  }, [filteredQuestions]);

  const builderQuestions = useMemo(() => {
    const q = builderSearchQuery.toLowerCase().trim();
    if (!q) return filteredQuestions;
    return filteredQuestions.filter(item =>
      item.text.toLowerCase().includes(q) ||
      item.subject.toLowerCase().includes(q) ||
      (item.topic || '').toLowerCase().includes(q)
    );
  }, [filteredQuestions, builderSearchQuery]);

  const visibleManagedTests = useMemo(() => {
    if (adminPrepModeFilter === 'all') return managedTests;
    return managedTests.filter((test) => ((test.prepMode as PrepMode) || DEFAULT_PREP_MODE) === adminPrepModeFilter);
  }, [managedTests, adminPrepModeFilter]);

  const csvBundlePreview = useMemo(() => {
    if (!csvBundleEnabled || csvDynamicQuestions.length === 0) return [];
    const staged = csvDynamicQuestions.map((q, idx) => ({ id: `preview_${idx}`, question: q }));
    return buildCsvBundles(staged, csvBundleCategoryField, csvBundleSize);
  }, [csvBundleEnabled, csvDynamicQuestions, csvBundleCategoryField, csvBundleSize]);

  const editingCsvBundlePreview = useMemo(() => {
    if (!editingCsvBundleEnabled || editingCsvQuestions.length === 0) return [];
    const staged = editingCsvQuestions.map((q) => ({ id: q.id, question: q as StagedQuestion }));
    return buildCsvBundles(staged, editingCsvBundleCategoryField, editingCsvBundleSize);
  }, [editingCsvBundleEnabled, editingCsvQuestions, editingCsvBundleCategoryField, editingCsvBundleSize]);

  const getTestEditAutosaveKey = (testId: string) => `${TEST_EDIT_AUTOSAVE_PREFIX}:${user.id}:${testId}`;
  const getActiveTestEditAutosaveKey = () => `${TEST_EDIT_ACTIVE_AUTOSAVE_PREFIX}:${user.id}`;

  const readTestEditAutosaveDraft = (testId: string): TestEditAutosaveDraft | null => {
    try {
      const raw = window.localStorage.getItem(getTestEditAutosaveKey(testId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as TestEditAutosaveDraft;
      if (parsed?.version !== 1 || parsed.testId !== testId || parsed.userId !== user.id) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const clearTestEditAutosaveDraft = (testId: string) => {
    try {
      window.localStorage.removeItem(getTestEditAutosaveKey(testId));
      if (window.localStorage.getItem(getActiveTestEditAutosaveKey()) === testId) {
        window.localStorage.removeItem(getActiveTestEditAutosaveKey());
      }
    } catch {
      // Ignore storage failures; the manual save path still works.
    }
  };

  const applyTestEditAutosaveDraft = (draft: TestEditAutosaveDraft) => {
    setEditTestPrepMode((draft.prepMode as PrepMode) || DEFAULT_PREP_MODE);
    setEditTestName(draft.name || '');
    setEditTestDesc(draft.description || '');
    setEditTestDuration(Math.max(1, Number(draft.durationMinutes) || 1));
    setEditTestPasswordEnabled(Boolean(draft.passwordEnabled));
    setEditTestPassword(draft.password || '');
    setEditTestArchived(Boolean(draft.isArchived));
    setEditingCsvQuestionCount(Math.max(1, Number(draft.csvQuestionCount) || 1));
    setEditingCsvMarksPerQuestion(Math.max(1, Number(draft.csvMarksPerQuestion) || 1));
    setEditingCsvBundleEnabled(Boolean(draft.csvBundleEnabled));
    setEditingCsvBundleCategoryField((draft.csvBundleCategoryField || 'subject') as CsvBundleCategoryField);
    setEditingCsvBundleSize(Math.max(1, Number(draft.csvBundleSize) || 1));
    if ((draft.generationMode || 'fixed') === 'csv-dynamic') {
      setEditingCsvQuestions(Array.isArray(draft.csvQuestions) ? draft.csvQuestions : []);
    } else {
      setEditingTestQuestions(Array.isArray(draft.testQuestions) ? draft.testQuestions : []);
    }
    setEditAutosaveStatus(`Restored autosave from ${new Date(draft.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  };

  useEffect(() => {
    if (activeTab === 'tests') {
      loadManagedTests();
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      const activeDraftTestId = window.localStorage.getItem(getActiveTestEditAutosaveKey());
      if (activeDraftTestId) {
        pendingAutosaveRestoreRef.current = activeDraftTestId;
        setActiveTab('tests');
      }
    } catch {
      // Storage may be unavailable in private browsing; autosave simply stays inactive.
    }
  }, []);

  useEffect(() => {
    const pendingTestId = pendingAutosaveRestoreRef.current;
    if (!pendingTestId || activeTab !== 'tests' || editingTestId || managedTestsLoading) return;
    const test = managedTests.find(item => item.id === pendingTestId);
    if (!test) return;
    pendingAutosaveRestoreRef.current = null;
    restoringAutosaveRef.current = true;
    startEditTest(test).finally(() => {
      restoringAutosaveRef.current = false;
    });
  }, [activeTab, editingTestId, managedTests, managedTestsLoading]);

  useEffect(() => {
    if (!editingTestId || !editAutosaveReadyRef.current || restoringAutosaveRef.current) return;
    if (editAutosaveTimerRef.current) {
      window.clearTimeout(editAutosaveTimerRef.current);
    }
    setEditAutosaveStatus('Autosave pending...');
    editAutosaveTimerRef.current = window.setTimeout(() => {
      const activeEditTest = managedTests.find((test) => test.id === editingTestId) || editingTest;
      if (!activeEditTest) return;
      const draft: TestEditAutosaveDraft = {
        version: 1,
        testId: editingTestId,
        userId: user.id,
        generationMode: (activeEditTest.generationMode || 'fixed') as TestGenerationMode,
        prepMode: editTestPrepMode,
        updatedAt: new Date().toISOString(),
        name: editTestName,
        description: editTestDesc,
        durationMinutes: Math.max(1, Number(editTestDuration) || 1),
        passwordEnabled: editTestPasswordEnabled,
        password: editTestPassword,
        isArchived: editTestArchived,
        csvQuestionCount: Math.max(1, Number(editingCsvQuestionCount) || 1),
        csvMarksPerQuestion: Math.max(1, Number(editingCsvMarksPerQuestion) || 1),
        csvBundleEnabled: editingCsvBundleEnabled,
        csvBundleCategoryField: editingCsvBundleCategoryField,
        csvBundleSize: Math.max(1, Number(editingCsvBundleSize) || 1),
        testQuestions: editingTestQuestions,
        csvQuestions: editingCsvQuestions
      };
      try {
        window.localStorage.setItem(getTestEditAutosaveKey(editingTestId), JSON.stringify(draft));
        window.localStorage.setItem(getActiveTestEditAutosaveKey(), editingTestId);
        setEditAutosaveStatus(`Autosaved ${new Date(draft.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      } catch {
        setEditAutosaveStatus('Autosave unavailable');
      }
    }, 1200);

    return () => {
      if (editAutosaveTimerRef.current) {
        window.clearTimeout(editAutosaveTimerRef.current);
        editAutosaveTimerRef.current = null;
      }
    };
  }, [
    editingTestId,
    editingTest,
    managedTests,
    user.id,
    editTestName,
    editTestPrepMode,
    editTestDesc,
    editTestDuration,
    editTestPasswordEnabled,
    editTestPassword,
    editTestArchived,
    editingTestQuestions,
    editingCsvQuestions,
    editingCsvQuestionCount,
    editingCsvMarksPerQuestion,
    editingCsvBundleEnabled,
    editingCsvBundleCategoryField,
    editingCsvBundleSize
  ]);

  useEffect(() => {
    if (!canManageKeys && activeTab === 'license-keys') {
      setActiveTab('questions');
    }
  }, [activeTab, canManageKeys]);

  useEffect(() => {
    if (activeTab !== 'questions') return;
    setTagInsightsLoading(true);
    const unsub = onSnapshot(
      query(collection(db, 'questionTagInsights'), limit(100)),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ ...(d.data() as Omit<QuestionTagInsight, 'id'>), id: d.id } as QuestionTagInsight))
          .filter((row) => row.status !== 'reviewed')
          .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
        setTagInsights(rows);
        setTagInsightsLoading(false);
      },
      () => {
        setTagInsights([]);
        setTagInsightsLoading(false);
      }
    );
    return () => unsub();
  }, [activeTab]);

  useEffect(() => {
    const loadDeadline = async () => {
      if (!canManageKeys || activeTab !== 'license-keys') return;
      try {
        const snap = await getDoc(doc(db, 'licenseKeys', DEADLINE_CONFIG_DOC_ID));
        const configured = snap.exists() ? (snap.data() as any)?.freeAccessEndsAt : null;
        if (typeof configured === 'string' && Number.isFinite(Date.parse(configured))) {
          setDeadlineInput(toWatInputValue(configured));
        } else {
          setDeadlineInput(toWatInputValue(DEFAULT_FREE_ACCESS_ENDS_AT_ISO));
        }
      } catch {
        setDeadlineInput(toWatInputValue(DEFAULT_FREE_ACCESS_ENDS_AT_ISO));
      }
    };
    loadDeadline();
  }, [activeTab, canManageKeys]);

  useEffect(() => {
    const loadAttendanceConfig = async () => {
      if (activeTab !== 'attendance') return;
      try {
        const snap = await getDoc(doc(db, 'brainstormConfig', 'global'));
        const windows = sanitizeBrainstormWindows(snap.exists() ? (snap.data() as any)?.windows : null);
        setAttendanceWindows(toEditableBrainstormWindows(windows));
      } catch {
        setAttendanceWindows(toEditableBrainstormWindows(DEFAULT_BRAINSTORM_WINDOWS));
      }
    };
    loadAttendanceConfig();
  }, [activeTab]);

  const runQuestionSearch = async (rawQuery: string) => {
    const q = rawQuery.trim();
    setBankSearchQuery(rawQuery);
    setHasSearched(!!q);
    if (!q) {
      setQuestions([]);
      return;
    }
    setIsSearching(true);
    setDbError(null);
    try {
      const snap = await getDocs(query(collection(db, 'questions'), limit(2000)));
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id } as Question));
      const lowerQ = q.toLowerCase();
      const filtered = data.filter(item =>
        item.text.toLowerCase().includes(lowerQ) ||
        item.subject.toLowerCase().includes(lowerQ) ||
        (item.topic || '').toLowerCase().includes(lowerQ) ||
        (item.tags || []).some(tag => tag.toLowerCase().includes(lowerQ))
      );
      setQuestions(filtered);
      setCollapsedSubjects({});
    } catch (err: any) {
      console.error('Question search error:', err);
      if (err.code === 'permission-denied') {
        setDbError('Permission denied. Verify your account and admin role.');
      } else if (err.code === 'unavailable' || !navigator.onLine) {
        setDbError('You appear to be offline.');
      } else {
        setDbError('Unable to load questions. Check console for details.');
      }
    } finally {
      setIsSearching(false);
    }
  };

  const recalculateResultsForTests = async (tests: MockTest[]) => {
    if (tests.length === 0) return 0;

    const affectedQuestionIds = new Set<string>();
    tests.forEach(test => {
      test.sections.forEach(section => {
        section.questionIds.forEach(id => affectedQuestionIds.add(id));
      });
    });

    const questionMap: Record<string, Question> = {};
    const ids = Array.from(affectedQuestionIds);
    for (const chunk of chunkArray(ids, 10)) {
      const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
      qSnap.docs.forEach(d => {
        questionMap[d.id] = { ...d.data(), id: d.id } as Question;
      });
    }

    let changedResults = 0;
    const pendingUpdates: { id: string; score: number; maxScore: number; sectionBreakdown: ExamResult['sectionBreakdown'] }[] = [];

    for (const test of tests) {
      const resultsSnap = await getDocs(query(collection(db, 'results'), where('testId', '==', test.id)));

      for (const resultDoc of resultsSnap.docs) {
        const result = { ...resultDoc.data(), id: resultDoc.id } as ExamResult;
        const sectionsToScore = Array.isArray(result.resolvedSections) && result.resolvedSections.length > 0
          ? result.resolvedSections
          : test.sections;

        const missingIds = Array.from(new Set(
          sectionsToScore.flatMap(section => section.questionIds).filter(qId => !questionMap[qId])
        ));
        for (const chunk of chunkArray(missingIds, 10)) {
          const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
          qSnap.docs.forEach(d => {
            questionMap[d.id] = { ...d.data(), id: d.id } as Question;
          });
        }

        const sectionBreakdown = sectionsToScore.map(section => {
          let sectionScore = 0;
          section.questionIds.forEach(qId => {
            const question = questionMap[qId];
            if (!question) return;
            if (result.userAnswers?.[qId] === question.correctAnswerIndex) {
              sectionScore += section.marksPerQuestion;
            }
          });
          return {
            sectionName: section.name,
            score: sectionScore,
            total: section.questionIds.length * section.marksPerQuestion
          };
        });

        const totalScore = sectionBreakdown.reduce((sum, section) => sum + section.score, 0);
        const maxScore = sectionBreakdown.reduce((sum, section) => sum + section.total, 0);
        const breakdownChanged = JSON.stringify(result.sectionBreakdown || []) !== JSON.stringify(sectionBreakdown);

        if (result.score !== totalScore || result.maxScore !== maxScore || breakdownChanged) {
          pendingUpdates.push({
            id: result.id,
            score: totalScore,
            maxScore,
            sectionBreakdown
          });
          changedResults++;
        }
      }
    }

    let batch = writeBatch(db);
    let writes = 0;
    for (const update of pendingUpdates) {
      batch.update(doc(db, 'results', update.id), {
        score: update.score,
        maxScore: update.maxScore,
        sectionBreakdown: update.sectionBreakdown,
        scoreRecalculatedAt: new Date().toISOString()
      });
      writes++;
      if (writes >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        writes = 0;
      }
    }

    if (writes > 0) {
      await batch.commit();
    }

    return changedResults;
  };

  const recalculateScoresForQuestion = async (questionId: string) => {
    const testsSnap = await getDocs(collection(db, 'tests'));
    const tests = testsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest));
    const affectedTests = tests.filter(test =>
      test.sections.some(section => section.questionIds.includes(questionId))
    );
    return recalculateResultsForTests(affectedTests);
  };

  const recalculateAllScores = async () => {
    const shouldRecalculate = await confirmDialog({
      title: 'Recalculate scores?',
      message: 'Recalculate all stored results using current question answers? This may take some time.',
      confirmText: 'Recalculate',
      variant: 'danger'
    });
    if (!shouldRecalculate) return;
    setLoading(true);
    try {
      const testsSnap = await getDocs(collection(db, 'tests'));
      const tests = testsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest));
      const changedResults = await recalculateResultsForTests(tests);
      notify(`Recalculation complete. Updated ${changedResults} result(s).`);
    } catch (err: any) {
      notify('Score recalculation failed. ' + (err?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const rebuildLeaderboardPublic = async () => {
    const shouldRebuild = await confirmDialog({
      title: 'Rebuild leaderboard?',
      message: 'Rebuild leaderboardPublic from all results now?',
      confirmText: 'Rebuild',
      variant: 'danger'
    });
    if (!shouldRebuild) return;
    setLoading(true);
    try {
      const resultsSnap = await getDocs(query(collection(db, 'results'), limit(3000)));
      const buckets: Record<string, {
        userName: string;
        attempts: number;
        totalPercent: number;
        bestPercent: number;
        lastCompletedAt: string;
      }> = {};

      resultsSnap.docs.forEach((d) => {
        const row = d.data() as ExamResult;
        const userId = String(row.userId || '').trim();
        if (!userId) return;
        const maxScore = Number(row.maxScore || 0);
        if (maxScore <= 0) return;
        const percent = clampPercent((Number(row.score || 0) / maxScore) * 100);
        if (!buckets[userId]) {
          buckets[userId] = {
            userName: row.userName || 'Unknown User',
            attempts: 0,
            totalPercent: 0,
            bestPercent: 0,
            lastCompletedAt: ''
          };
        }
        buckets[userId].attempts += 1;
        buckets[userId].totalPercent += percent;
        buckets[userId].bestPercent = Math.max(buckets[userId].bestPercent, percent);
        if (row.userName?.trim()) {
          buckets[userId].userName = row.userName.trim();
        }
        if (toSortableTime(row.completedAt) >= toSortableTime(buckets[userId].lastCompletedAt)) {
          buckets[userId].lastCompletedAt = row.completedAt;
        }
      });

      const existingSnap = await getDocs(query(collection(db, 'leaderboardPublic'), limit(3000)));
      const existingTestLeaderboardSnap = await getDocs(query(collection(db, 'testLeaderboardPublic'), limit(3000)));
      let batch = writeBatch(db);
      let writes = 0;

      for (const d of existingSnap.docs) {
        batch.delete(doc(db, 'leaderboardPublic', d.id));
        writes++;
        if (writes >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          writes = 0;
        }
      }
      if (writes > 0) {
        await batch.commit();
        batch = writeBatch(db);
        writes = 0;
      }

      for (const d of existingTestLeaderboardSnap.docs) {
        batch.delete(doc(db, 'testLeaderboardPublic', d.id));
        writes++;
        if (writes >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          writes = 0;
        }
      }
      if (writes > 0) {
        await batch.commit();
        batch = writeBatch(db);
        writes = 0;
      }

      for (const [userId, bucket] of Object.entries(buckets)) {
        const attempts = bucket.attempts;
        const avg = attempts > 0 ? bucket.totalPercent / attempts : 0;
        batch.set(doc(db, 'leaderboardPublic', userId), {
          userId,
          userName: bucket.userName,
          attempts,
          averagePercent: Number(avg.toFixed(2)),
          bestPercent: Number(bucket.bestPercent.toFixed(2)),
          lastCompletedAt: bucket.lastCompletedAt,
          sortKey: toLeaderboardSortKey(avg, bucket.bestPercent, attempts, bucket.lastCompletedAt),
          updatedAt: new Date().toISOString()
        });
        writes++;
        if (writes >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          writes = 0;
        }
      }

      for (const d of resultsSnap.docs) {
        const row = d.data() as ExamResult;
        const maxScore = Number(row.maxScore || 0);
        const score = Number(row.score || 0);
        if (!row.userId || !row.testId || maxScore <= 0) continue;
        batch.set(doc(db, 'testLeaderboardPublic', d.id), {
          userId: row.userId,
          userName: row.userName || 'Unknown User',
          testId: row.testId,
          testName: row.testName || '',
          score,
          maxScore,
          scorePercent: Number(clampPercent((score / maxScore) * 100).toFixed(2)),
          completedAt: row.completedAt,
          status: row.status
        });
        writes++;
        if (writes >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          writes = 0;
        }
      }

      if (writes > 0) {
        await batch.commit();
      }

      notify(`Leaderboards rebuilt for ${Object.keys(buckets).length} user(s).`);
    } catch (err: any) {
      notify('Leaderboard rebuild failed. ' + (err?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const loadManagedTests = async () => {
    setManagedTestsLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'tests'), limit(300)));
      const data = snap.docs
        .map(d => ({ ...d.data(), id: d.id } as MockTest))
        .sort((a, b) => {
          const aMs = Date.parse(((a as any).updatedAt || a.createdAt || ''));
          const bMs = Date.parse(((b as any).updatedAt || b.createdAt || ''));
          return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
        });
      setManagedTests(data);
    } catch (err: any) {
      notify('Unable to load tests. ' + (err?.message || ''));
    } finally {
      setManagedTestsLoading(false);
    }
  };

  const findDuplicateQuestion = async (rawText: string, ignoreId?: string) => {
    const normalized = normalizeText(rawText);
    const colRef = collection(db, 'questions');
    const [normSnap, rawSnap] = await Promise.all([
      getDocs(query(colRef, where('normalizedText', '==', normalized), limit(1))),
      getDocs(query(colRef, where('text', '==', rawText), limit(1)))
    ]);

    const candidate = [...normSnap.docs, ...rawSnap.docs].find(d => d.id !== ignoreId);
    return candidate ? candidate.id : null;
  };

  const runBankCleanup = async () => {
    const shouldClean = await confirmDialog({
      title: 'Clean question bank?',
      message: 'Find and remove identical questions? This cannot be undone.',
      confirmText: 'Clean',
      variant: 'danger'
    });
    if (!shouldClean) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'questions'));
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id } as Question));
      
      const seenTexts = new Map<string, string>(); 
      const duplicatesToDelete: string[] = [];

      all.forEach(q => {
        const cleanText = q.text.toLowerCase().trim().replace(/\s+/g, ' ');
        if (seenTexts.has(cleanText)) {
          duplicatesToDelete.push(q.id);
        } else {
          seenTexts.set(cleanText, q.id);
        }
      });

      if (duplicatesToDelete.length > 0) {
        const batch = writeBatch(db);
        duplicatesToDelete.forEach(id => {
          batch.delete(doc(db, 'questions', id));
        });
        await batch.commit();
        notify(`Cleanup successful. Removed ${duplicatesToDelete.length} duplicates.`);
      } else {
        notify("No duplicate questions found.");
      }
    } catch (err: any) {
      console.error("Cleanup Error:", err);
      if (err.code === 'unavailable' || !navigator.onLine) {
        notify("Operation failed: You are currently offline or the database is unreachable.");
      } else {
        notify("Cleanup failed: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const processPDF = async (file: File) => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!apiKey) {
      notify('Missing Gemini API key. Add VITE_GEMINI_API_KEY to .env.local.');
      return;
    }

    setImportStatus('parsing');
    try {
      const fileToBase64 = (f: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve((r.result as string).split(',')[1]);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
      };

      const base64Data = await fileToBase64(file);
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `
Extract CBT multiple-choice questions from this PDF.
Return ONLY a JSON array.
Each item must use this exact shape:
{
  "subject": "string",
  "topic": "string",
  "text": "string",
  "options": ["string","string","string","string"],
  "correctAnswerIndex": 0,
  "explanation": "string"
}
Rules:
- Exactly 4 options per question.
- correctAnswerIndex must be 0,1,2,3.
- Skip incomplete questions.
      `.trim();

      let parsedQuestions: StagedQuestion[] = [];
      const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
      let lastError: any = null;

      // New extraction algorithm:
      // 1) Try lower-cost models first.
      // 2) Retry with exponential backoff on quota spikes.
      for (const model of models) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: {
                parts: [
                  { inlineData: { mimeType: 'application/pdf', data: base64Data } },
                  { text: prompt }
                ]
              },
              config: { responseMimeType: "application/json" }
            });

            const raw = (response.text || '').trim();
            if (!raw) throw new Error('EMPTY_RESPONSE');

            const cleaned = raw.startsWith('```')
              ? raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
              : raw;

            const normalized = normalizeExtractedQuestions(JSON.parse(cleaned));
            if (normalized.length === 0) {
              throw new Error('NO_VALID_QUESTIONS');
            }

            parsedQuestions = normalized;
            break;
          } catch (err: any) {
            lastError = err;
            const isRateLimited = String(err?.message || '').includes('429') || String(err?.status || '') === '429';
            if (isRateLimited && attempt < 2) {
              await wait((attempt + 1) * 1500);
              continue;
            }
          }
        }
        if (parsedQuestions.length > 0) break;
      }

      if (parsedQuestions.length === 0) {
        // Non-AI fallback: attempt regex extraction directly from PDF text fragments.
        const fallbackQuestions = extractQuestionsFromPdfTextFallback(decodePdfBase64ToText(base64Data));
        if (fallbackQuestions.length > 0) {
          setStagedQuestions(fallbackQuestions);
          setImportStatus('review');
          notify(`AI extraction failed, but fallback parser found ${fallbackQuestions.length} question(s). Please review carefully.`);
          return;
        }

        // OCR + vision fallback for scanned/image PDFs.
        try {
          const pageImages = await renderPdfPagesToBase64Images(base64Data, 8);
          if (pageImages.length > 0) {
            const imageQuestions = await extractQuestionsFromImagesWithGemini(ai, pageImages);
            if (imageQuestions.length > 0) {
              setStagedQuestions(imageQuestions);
              setImportStatus('review');
              notify(`AI PDF parser failed, but OCR/vision fallback found ${imageQuestions.length} question(s). Please review carefully.`);
              return;
            }
          }
        } catch (ocrErr) {
          console.error('OCR fallback error:', ocrErr);
        }

        const errorText = String(lastError?.message || '').includes('429')
          ? 'Extraction limit reached. Please wait 1-2 minutes and try again.'
          : 'AI extraction failed and fallback parser found no valid questions.';
        throw new Error(errorText);
      }

      setStagedQuestions(parsedQuestions);
      setImportStatus('review');
    } catch (err: any) {
      notify(err?.message || "AI reading failed. Check your API key and file.");
      setImportStatus('idle');
    }
  };

  const processCSV = async (file: File) => {
    setImportStatus('parsing');
    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (rows.length === 0) throw new Error('CSV has no valid data rows.');
      const { mapped, errors } = mapCsvRowsToStagedQuestions(rows);

      if (mapped.length === 0) {
        throw new Error(errors[0] || 'No valid rows were found in CSV.');
      }
      if (errors.length > 0) {
        notify(`Imported with ${errors.length} skipped row(s). First issue: ${errors[0]}`);
      }

      setStagedQuestions(mapped);
      setImportStatus('review');
    } catch (err: any) {
      notify(err?.message || 'CSV import failed.');
      setImportStatus('idle');
    }
  };

  const processCsvForDynamicTest = async (file: File) => {
    setLoading(true);
    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (rows.length === 0) throw new Error('CSV has no valid data rows.');
      const { mapped, errors } = mapCsvRowsToStagedQuestions(rows);
      setCsvDynamicQuestions(mapped);
      setCsvDynamicFileName(file.name);
      setCsvDynamicQuestionCount(prev => Math.max(1, Math.min(mapped.length, prev || mapped.length)));
      setCsvBundleSize(prev => Math.max(1, Math.min(mapped.length, prev || 100)));
      if (errors.length > 0) {
        notify(`CSV loaded with ${errors.length} skipped row(s). First issue: ${errors[0]}`);
      }
    } catch (err: any) {
      notify(err?.message || 'Could not load CSV for dynamic test.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const imageUrl = sanitizeOptionalUrl(qImageUrl);
    if (qImageUrl.trim() && !imageUrl) {
      notify('Image URL must be a valid http or https URL.');
      setLoading(false);
      return;
    }
    const data = {
      subject: qSubject || 'General',
      topic: qTopic || 'General',
      text: qText.trim(),
      options: normalizeOptions(qOptions),
      correctAnswerIndex: qCorrect,
      explanation: qExplanation.trim(),
      prepMode: qPrepMode,
      difficulty: qDifficulty,
      tags: parseList(qTags),
      imageUrl,
      imageAlt: qImageAlt.trim(),
      status: 'approved' as const,
      isActive: qIsActive,
      normalizedText: normalizeText(qText)
    };
    try {
      const duplicateId = await findDuplicateQuestion(data.text, editingId || undefined);
      if (duplicateId) {
        notify('This question already exists.');
        setLoading(false);
        return;
      }
      if (editingId) {
        const existingQuestion = questions.find(q => q.id === editingId);
        const optionsChanged = existingQuestion
          ? areOptionsChanged(existingQuestion.options || [], data.options) || existingQuestion.correctAnswerIndex !== data.correctAnswerIndex
          : true;

        await updateDoc(doc(db, 'questions', editingId), { ...data, updatedAt: new Date().toISOString() });
        if (optionsChanged) {
          const updatedCount = await recalculateScoresForQuestion(editingId);
          if (updatedCount > 0) {
            notify(`Question updated. ${updatedCount} result(s) were recalculated.`);
          }
        }
      } else {
        await addDoc(collection(db, 'questions'), { ...data, createdBy: user.id, createdAt: new Date().toISOString() });
      }
      resetForm();
      setIsQuestionModalOpen(false);
      if (hasSearched) {
        await runQuestionSearch(bankSearchQuery);
      }
    } catch (e: any) {
      notify("Could not save to database. " + (e?.message || ""));
    }
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setEditingId(null);
    setQSubject('');
    setQTopic('');
    setQText('');
    setQOptions(['','','','']);
    setQCorrect(0);
    setQExplanation('');
    setQPrepMode(DEFAULT_PREP_MODE);
    setQDifficulty(DEFAULT_DIFFICULTY);
    setQTags('');
    setQImageUrl('');
    setQImageAlt('');
    setQIsActive(true);
  };

  const openMediaPicker = (target: EditingMediaTarget = { kind: 'question-form' }) => {
    setEditingMediaTarget(target);
    const popup = window.open(MEDIA_PICKER_URL, 'aureus-media-picker', 'width=1100,height=760,noopener=false,noreferrer=false');
    if (!popup) {
      notify('Allow popups to open the media picker.');
    }
  };

  const buildDynamicSectionsWithPools = async (baseSections: TestSection[], prepMode: PrepMode) => {
    const allSnap = await getDocs(query(collection(db, 'questions'), limit(5000)));
    const allQuestions = allSnap.docs.map(d => ({ ...d.data(), id: d.id } as Question));
    const sectionsWithPools = baseSections.map((section) => {
      const poolIds = allQuestions
        .filter(q => ((q.prepMode as PrepMode) || DEFAULT_PREP_MODE) === prepMode)
        .filter(q => matchesSectionFilters(q, section))
        .map(q => q.id);
      return {
        ...section,
        questionIds: poolIds
      };
    });
    const insufficient = sectionsWithPools.find(s => s.questionIds.length < Number(s.questionCount || 0));
    if (insufficient) {
      throw new Error(
        `Section "${insufficient.name}" has only ${insufficient.questionIds.length} pool question(s), but needs ${insufficient.questionCount}.`
      );
    }
    return sectionsWithPools;
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testName) return notify("Test name is required.");
    if (testPasswordEnabled && !testPassword.trim()) {
      return notify("Enter a password or turn password protection off.");
    }
    if (testGenerationMode === 'csv-dynamic' && csvDynamicQuestions.length === 0) {
      return notify("Upload a CSV file for CSV Dynamic mode.");
    }
    if (testGenerationMode === 'csv-dynamic' && (csvDynamicQuestionCount <= 0 || csvDynamicQuestionCount > csvDynamicQuestions.length)) {
      return notify(`Question count must be between 1 and ${csvDynamicQuestions.length}.`);
    }
    if (testGenerationMode === 'csv-dynamic' && csvBundleEnabled && (csvBundleSize <= 0 || csvBundleSize > csvDynamicQuestions.length)) {
      return notify(`Bundle size must be between 1 and ${csvDynamicQuestions.length}.`);
    }
    if (testGenerationMode === 'fixed' && sections.some(s => s.questionIds.length === 0)) {
      return notify("One or more sections are empty.");
    }
    if (testGenerationMode === 'dynamic' && sections.some(s => Number(s.questionCount || 0) <= 0)) {
      return notify("Each dynamic section must have a question count greater than zero.");
    }
    if (!allowRetake && maxAttempts !== '' && Number(maxAttempts) > 1) {
      return notify("Retake is off, so max attempts must be 1.");
    }
    
    setLoading(true);
    try {
      let sectionsToPersist = sections;
      let csvMeta: Record<string, any> = {};
      if (testGenerationMode === 'dynamic') {
        sectionsToPersist = await buildDynamicSectionsWithPools(sections, testPrepMode);
      } else if (testGenerationMode === 'csv-dynamic') {
        const nowIso = new Date().toISOString();
        const csvPoolId = `csvpool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const persistedRows: Array<{ id: string; question: StagedQuestion }> = [];
        let batch = writeBatch(db);
        let writes = 0;
        for (const q of csvDynamicQuestions) {
          const ref = doc(collection(db, 'questions'));
          persistedRows.push({ id: ref.id, question: q });
          batch.set(ref, {
            subject: q.subject || 'General',
            topic: q.topic || 'General',
            text: q.text,
            options: q.options,
            correctAnswerIndex: q.correctAnswerIndex,
            explanation: q.explanation || '',
            difficulty: q.difficulty || DEFAULT_DIFFICULTY,
            tags: Array.isArray(q.tags) ? q.tags : [],
            source: q.source || csvDynamicFileName || 'csv-dynamic',
            year: q.year ?? null,
            examType: q.examType || '',
            imageUrl: q.imageUrl || '',
            imageAlt: q.imageAlt || '',
            status: 'approved',
            isActive: q.isActive !== false,
            normalizedText: normalizeText(q.text),
            createdBy: user.id,
            createdAt: nowIso,
            prepMode: testPrepMode,
            csvPoolId
          });
          writes++;
          if (writes >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            writes = 0;
          }
        }
        if (writes > 0) {
          await batch.commit();
        }

        sectionsToPersist = [{
          id: 'sec_csv_' + Date.now(),
          name: 'CSV Section',
          questionIds: persistedRows.map(item => item.id),
          marksPerQuestion: Math.max(1, Number(csvDynamicMarksPerQuestion) || 1),
          questionCount: Math.max(1, Number(csvDynamicQuestionCount) || 1),
          sampleFilters: { subjects: [], topics: [], difficulties: ['easy', 'medium', 'hard'], tags: [] },
          difficultyMix: { easy: 30, medium: 50, hard: 20 }
        }];
        const bundles = csvBundleEnabled
          ? buildCsvBundles(persistedRows, csvBundleCategoryField, csvBundleSize)
          : [];
        csvMeta = {
          csvPoolId,
          csvPoolSourceFile: csvDynamicFileName || null,
          csvPoolSize: persistedRows.length,
          csvBundlesEnabled: csvBundleEnabled,
          csvBundleCategoryField: csvBundleCategoryField,
          csvBundleSize: Math.max(1, Number(csvBundleSize) || 1),
          csvBundles: bundles
        };
      }

      const createdTestRef = await addDoc(collection(db, 'tests'), {
        name: testName,
        description: testDesc,
        prepMode: testPrepMode,
        totalDurationSeconds: testDuration * 60,
        sections: sectionsToPersist,
        generationMode: testGenerationMode,
        allowRetake,
        maxAttempts: allowRetake ? (maxAttempts === '' ? null : Number(maxAttempts)) : 1,
        accessPassword: testPasswordEnabled ? testPassword.trim() : '',
        isArchived: testArchived,
        createdBy: user.id,
        creatorName: user.name,
        isApproved: true,
        createdAt: new Date().toISOString(),
        ...csvMeta
      });
      await addDoc(collection(db, 'broadcastNotifications'), {
        type: 'new-test',
        title: 'New test available',
        message: `${testName} is now available.`,
        testId: createdTestRef.id,
        testName: testName,
        createdAt: new Date().toISOString(),
        createdBy: user.id,
        createdByName: user.name
      });
      notify("Test published.");
      if (testGenerationMode === 'csv-dynamic') {
        setCsvDynamicQuestions([]);
        setCsvDynamicFileName('');
        setCsvBundleEnabled(false);
      }
      setTestPasswordEnabled(false);
      setTestPassword('');
      setTestArchived(false);
      setActiveTab('tests');
    } catch (e: any) { notify("Error creating test. " + (e?.message || "")); }
    finally { setLoading(false); }
  };

  const rebuildDynamicPools = async (test: MockTest) => {
    if ((test.generationMode || 'fixed') !== 'dynamic') {
      notify('This test is not dynamic.');
      return;
    }
    const shouldRebuildPools = await confirmDialog({
      title: 'Rebuild dynamic pools?',
      message: `Rebuild dynamic pools for "${test.name}" using current question bank?`,
      confirmText: 'Rebuild',
      variant: 'danger'
    });
    if (!shouldRebuildPools) return;
    setLoading(true);
    try {
      const nextSections = await buildDynamicSectionsWithPools(test.sections, ((test.prepMode as PrepMode) || DEFAULT_PREP_MODE));
      await updateDoc(doc(db, 'tests', test.id), {
        sections: nextSections,
        poolsRebuiltAt: new Date().toISOString(),
        poolRebuiltBy: user.id
      });
      await loadManagedTests();
      notify('Dynamic pools rebuilt successfully.');
    } catch (e: any) {
      notify('Could not rebuild pools. ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const addSection = () => {
    setSections([
      ...sections,
      {
        id: 'sec_' + Date.now(),
        name: `Section ${sections.length + 1}`,
        questionIds: [],
        marksPerQuestion: 1,
        questionCount: 20,
        sampleFilters: { subjects: [], topics: [], difficulties: ['easy', 'medium', 'hard'], tags: [] },
        difficultyMix: { easy: 30, medium: 50, hard: 20 }
      }
    ]);
    setActiveBuilderSection(sections.length);
  };

  const updateActiveSection = (updater: (section: TestSection) => TestSection) => {
    const next = [...sections];
    next[activeBuilderSection] = updater(next[activeBuilderSection]);
    setSections(next);
  };

  const toggleQuestionInActiveSection = (qId: string) => {
    const newSections = [...sections];
    const currentIds = newSections[activeBuilderSection].questionIds;
    if (currentIds.includes(qId)) {
      newSections[activeBuilderSection].questionIds = currentIds.filter(id => id !== qId);
    } else {
      newSections[activeBuilderSection].questionIds = [...currentIds, qId];
    }
    setSections(newSections);
  };

  const openNewQuestionModal = () => {
    resetForm();
    setIsQuestionModalOpen(true);
  };

  const openEditModal = (q: Question) => {
    setEditingId(q.id);
    setQSubject(q.subject);
    setQTopic(q.topic || '');
    setQText(q.text);
    setQOptions(q.options);
    setQCorrect(q.correctAnswerIndex);
    setQExplanation(q.explanation || '');
    setQPrepMode((q.prepMode as PrepMode) || DEFAULT_PREP_MODE);
    setQDifficulty((q.difficulty as DifficultyLevel) || DEFAULT_DIFFICULTY);
    setQTags((q.tags || []).join(', '));
    setQImageUrl(q.imageUrl || '');
    setQImageAlt(q.imageAlt || '');
    setQIsActive(q.isActive !== false);
    setIsQuestionModalOpen(true);
  };

  const openTaggedQuestion = async (questionId: string) => {
    try {
      const snap = await getDoc(doc(db, 'questions', questionId));
      if (!snap.exists()) {
        notify('Question no longer exists.');
        return;
      }
      const question = { ...snap.data(), id: snap.id } as Question;
      openEditModal(question);
    } catch (err: any) {
      notify('Could not open question. ' + (err?.message || ''));
    }
  };

  const markTagInsightReviewed = async (tag: QuestionTagInsight) => {
    try {
      await updateDoc(doc(db, 'questionTagInsights', tag.id), {
        status: 'reviewed',
        reviewedAt: new Date().toISOString(),
        reviewedBy: user.id
      });
    } catch (err: any) {
      notify('Could not mark as reviewed. ' + (err?.message || ''));
    }
  };

  const toggleSubjectCollapse = (subject: string) => {
    setCollapsedSubjects(prev => ({ ...prev, [subject]: !prev[subject] }));
  };

  const commitImportedQuestions = async () => {
    setLoading(true);
    try {
      const selected = stagedQuestions.filter(q => q.selected);
      if (selected.length === 0) {
        notify('Select at least one question to import.');
        setLoading(false);
        return;
      }

      const seen = new Set<string>();
      const uniqueSelected: StagedQuestion[] = [];
      selected.forEach(q => {
        const norm = normalizeText(q.text);
        if (!seen.has(norm)) {
          seen.add(norm);
          uniqueSelected.push(q);
        }
      });

      const normalizedList = uniqueSelected.map(q => normalizeText(q.text));
      const textList = uniqueSelected.map(q => q.text.trim());

      const existingNormalized = new Set<string>();
      const existingRaw = new Set<string>();

      for (const chunk of chunkArray(normalizedList, 10)) {
        const snap = await getDocs(query(collection(db, 'questions'), where('normalizedText', 'in', chunk)));
        snap.docs.forEach(d => {
          const data = d.data() as Question;
          if (data.normalizedText) existingNormalized.add(data.normalizedText);
        });
      }

      for (const chunk of chunkArray(textList, 10)) {
        const snap = await getDocs(query(collection(db, 'questions'), where('text', 'in', chunk)));
        snap.docs.forEach(d => {
          const data = d.data() as Question;
          if (data.text) existingRaw.add(normalizeText(data.text));
        });
      }

      const finalList = uniqueSelected.filter(q => {
        const norm = normalizeText(q.text);
        return !existingNormalized.has(norm) && !existingRaw.has(norm);
      });

      if (finalList.length === 0) {
        notify('All selected questions are already in the bank.');
        setLoading(false);
        return;
      }

      const invalidImageRow = finalList.find(q => String(q.imageUrl || '').trim() && !sanitizeOptionalUrl(String(q.imageUrl || '')));
      if (invalidImageRow) {
        notify('One selected question has an invalid image URL.');
        setLoading(false);
        return;
      }

      const batch = writeBatch(db);
      finalList.forEach(q => {
        const persistable = { ...q } as any;
        delete persistable.selected;
        const ref = doc(collection(db, 'questions'));
        batch.set(ref, {
          ...persistable,
          difficulty: persistable.difficulty || DEFAULT_DIFFICULTY,
          tags: Array.isArray(persistable.tags) ? persistable.tags : [],
          imageUrl: sanitizeOptionalUrl(String(persistable.imageUrl || '')),
          imageAlt: String(persistable.imageAlt || '').trim(),
          status: persistable.status || 'approved',
          isActive: persistable.isActive !== false,
          prepMode: persistable.prepMode || qPrepMode || DEFAULT_PREP_MODE,
          normalizedText: normalizeText(persistable.text),
          createdBy: user.id,
          createdAt: new Date().toISOString()
        });
      });
      await batch.commit();

      const skipped = uniqueSelected.length - finalList.length;
      if (skipped > 0) {
        notify(`Bank updated. Skipped ${skipped} duplicate(s).`);
      } else {
        notify('Bank updated successfully.');
      }

      setImportStatus('idle');
      setStagedQuestions([]);
    } catch (e: any) {
      notify('Import failed. ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const startEditTest = async (test: MockTest) => {
    editAutosaveReadyRef.current = false;
    if (editAutosaveTimerRef.current) {
      window.clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    const autosaveDraft = readTestEditAutosaveDraft(test.id);
    setEditingTestId(test.id);
    setEditingTest(test);
    setEditTestPrepMode((test.prepMode as PrepMode) || DEFAULT_PREP_MODE);
    setEditTestName(test.name || '');
    setEditTestDesc(test.description || '');
    setEditTestDuration(Math.max(1, Math.floor((test.totalDurationSeconds || 3600) / 60)));
    setEditTestPasswordEnabled(Boolean(test.accessPassword));
    setEditTestPassword(test.accessPassword || '');
    setEditTestArchived(Boolean(test.isArchived));
    const primarySection = test.sections?.[0];
    const csvCountFallback = primarySection
      ? Math.max(1, Number(primarySection.questionCount || primarySection.questionIds.length || 1))
      : 1;
    setEditingCsvQuestionCount(csvCountFallback);
    setEditingCsvMarksPerQuestion(Math.max(1, Number(primarySection?.marksPerQuestion || 1)));
    setEditingCsvBundleEnabled(Boolean((test as any).csvBundlesEnabled));
    setEditingCsvBundleCategoryField(((test as any).csvBundleCategoryField || 'subject') as CsvBundleCategoryField);
    setEditingCsvBundleSize(Math.max(1, Number((test as any).csvBundleSize || 100)));
    setEditAutosaveStatus(autosaveDraft ? 'Restoring autosave...' : 'Autosave ready');
    setEditingTestQuestions([]);

    if ((test.generationMode || 'fixed') !== 'csv-dynamic') {
      setEditingCsvQuestions([]);
      setEditingTestQuestionsLoading(true);
      try {
        const ids = Array.from(new Set((test.sections || []).flatMap(section => section.questionIds || [])));
        if (ids.length === 0) {
          setEditingTestQuestions([]);
        } else {
          const map: Record<string, Question> = {};
          for (const chunk of chunkArray(ids, 10)) {
            const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
            qSnap.docs.forEach((d) => {
              map[d.id] = { ...d.data(), id: d.id } as Question;
            });
          }

          const rows = ids.map((id) => map[id]).filter(Boolean).map(toEditableQuestionRow);
          const missing = ids.length - rows.length;
          if (missing > 0) {
            notify(`Loaded ${rows.length} test question(s). ${missing} question(s) were missing from the bank.`);
          }
          setEditingTestQuestions(rows);
        }
      } catch (err: any) {
        notify('Could not load test questions for image editing. ' + (err?.message || ''));
        setEditingTestQuestions([]);
      } finally {
        setEditingTestQuestionsLoading(false);
      }
      if (autosaveDraft) {
        applyTestEditAutosaveDraft(autosaveDraft);
      }
      editAutosaveReadyRef.current = true;
      return;
    }

    setEditingCsvLoading(true);
    setEditingCsvQuestions([]);
    try {
      const ids = Array.from(new Set((test.sections || []).flatMap(section => section.questionIds || [])));
      if (ids.length === 0) {
        setEditingCsvQuestions([]);
      } else {
        const map: Record<string, Question> = {};
        for (const chunk of chunkArray(ids, 10)) {
          const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
          qSnap.docs.forEach((d) => {
            map[d.id] = { ...d.data(), id: d.id } as Question;
          });
        }

        const rows: EditableCsvQuestion[] = ids.map((id) => map[id]).filter(Boolean).map(toEditableQuestionRow);

        const missing = ids.length - rows.length;
        if (missing > 0) {
          notify(`Loaded ${rows.length} CSV question(s). ${missing} question(s) were missing from the bank.`);
        }
        setEditingCsvQuestions(rows);
      }
    } catch (err: any) {
      notify('Could not load CSV question pool for editing. ' + (err?.message || ''));
      setEditingCsvQuestions([]);
    } finally {
      setEditingCsvLoading(false);
    }
    if (autosaveDraft) {
      applyTestEditAutosaveDraft(autosaveDraft);
    }
    editAutosaveReadyRef.current = true;
  };

  const cancelEditTest = () => {
    if (editingTestId) {
      clearTestEditAutosaveDraft(editingTestId);
    }
    editAutosaveReadyRef.current = false;
    if (editAutosaveTimerRef.current) {
      window.clearTimeout(editAutosaveTimerRef.current);
      editAutosaveTimerRef.current = null;
    }
    setEditingTestId(null);
    setEditingTest(null);
    setEditTestName('');
    setEditTestPrepMode(DEFAULT_PREP_MODE);
    setEditTestDesc('');
    setEditTestDuration(60);
    setEditTestPasswordEnabled(false);
    setEditTestPassword('');
    setEditTestArchived(false);
    setEditingTestQuestions([]);
    setEditingTestQuestionsLoading(false);
    setEditingCsvQuestions([]);
    setEditingCsvLoading(false);
    setEditingCsvQuestionCount(20);
    setEditingCsvMarksPerQuestion(1);
    setEditingCsvBundleEnabled(false);
    setEditingCsvBundleCategoryField('subject');
    setEditingCsvBundleSize(100);
    setEditAutosaveStatus('');
  };

  const saveEditedTest = async (testId: string) => {
    const activeEditTest = managedTests.find((test) => test.id === testId) || editingTest;
    if (!activeEditTest) {
      notify('Could not find selected test.');
      return;
    }
    const isCsvDynamic = (activeEditTest.generationMode || 'fixed') === 'csv-dynamic';
    setLoading(true);
    try {
      if (editTestPasswordEnabled && !editTestPassword.trim()) {
        notify('Enter a password or turn password protection off.');
        return;
      }
      if (isCsvDynamic) {
        if (editingCsvQuestions.length === 0) {
          notify('No CSV questions loaded for this test.');
          return;
        }
        if (editingCsvQuestionCount <= 0 || editingCsvQuestionCount > editingCsvQuestions.length) {
          notify(`Question count must be between 1 and ${editingCsvQuestions.length}.`);
          return;
        }
        if (editingCsvBundleEnabled && (editingCsvBundleSize <= 0 || editingCsvBundleSize > editingCsvQuestions.length)) {
          notify(`Bundle size must be between 1 and ${editingCsvQuestions.length}.`);
          return;
        }

        for (let i = 0; i < editingCsvQuestions.length; i++) {
          const row = editingCsvQuestions[i];
          const options = Array.isArray(row.options) ? row.options.map(opt => String(opt || '').trim()) : [];
          if (!String(row.text || '').trim()) {
            notify(`Question ${i + 1} has empty text.`);
            return;
          }
          if (options.length !== 4 || options.some(opt => !opt)) {
            notify(`Question ${i + 1} must have exactly 4 non-empty options.`);
            return;
          }
          const answerIndex = Number(row.correctAnswerIndex);
          if (!Number.isFinite(answerIndex) || answerIndex < 0 || answerIndex > 3) {
            notify(`Question ${i + 1} has an invalid correct answer index.`);
            return;
          }
          if (String(row.imageUrl || '').trim() && !sanitizeOptionalUrl(String(row.imageUrl || ''))) {
            notify(`Question ${i + 1} has an invalid image URL.`);
            return;
          }
        }

        let batch = writeBatch(db);
        let writes = 0;
        const nowIso = new Date().toISOString();
        for (const row of editingCsvQuestions) {
          const cleanedText = String(row.text || '').trim();
          const cleanedOptions = row.options.map(opt => String(opt || '').trim()).slice(0, 4);
          batch.update(doc(db, 'questions', row.id), {
            subject: String(row.subject || 'General').trim() || 'General',
            topic: String(row.topic || 'General').trim() || 'General',
            text: cleanedText,
            options: cleanedOptions,
            correctAnswerIndex: Number(row.correctAnswerIndex),
            explanation: String(row.explanation || '').trim(),
            difficulty: normalizeDifficulty(String(row.difficulty || DEFAULT_DIFFICULTY)),
            tags: Array.isArray(row.tags) ? row.tags.map(tag => String(tag || '').trim()).filter(Boolean) : [],
            source: String(row.source || (activeEditTest as any).csvPoolSourceFile || 'csv-dynamic').trim() || 'csv-dynamic',
            year: row.year ?? null,
            examType: String(row.examType || '').trim(),
            prepMode: editTestPrepMode,
            imageUrl: sanitizeOptionalUrl(String(row.imageUrl || '')),
            imageAlt: String(row.imageAlt || '').trim(),
            status: 'approved',
            isActive: row.isActive !== false,
            normalizedText: normalizeText(cleanedText),
            updatedAt: nowIso
          });
          writes++;
          if (writes >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            writes = 0;
          }
        }
        if (writes > 0) {
          await batch.commit();
        }

        const nextSection: TestSection = activeEditTest.sections?.[0]
          ? {
            ...activeEditTest.sections[0],
            questionIds: editingCsvQuestions.map(item => item.id),
            marksPerQuestion: Math.max(1, Number(editingCsvMarksPerQuestion) || 1),
            questionCount: Math.max(1, Number(editingCsvQuestionCount) || 1)
          }
          : {
            id: 'sec_csv_' + Date.now(),
            name: 'CSV Section',
            questionIds: editingCsvQuestions.map(item => item.id),
            marksPerQuestion: Math.max(1, Number(editingCsvMarksPerQuestion) || 1),
            questionCount: Math.max(1, Number(editingCsvQuestionCount) || 1),
            sampleFilters: { subjects: [], topics: [], difficulties: ['easy', 'medium', 'hard'], tags: [] },
            difficultyMix: { easy: 30, medium: 50, hard: 20 }
          };
        const nextSections = [nextSection];
        const nextBundles = editingCsvBundleEnabled
          ? buildCsvBundles(
            editingCsvQuestions.map((item) => ({ id: item.id, question: item as StagedQuestion })),
            editingCsvBundleCategoryField,
            editingCsvBundleSize
          )
          : [];

        await updateDoc(doc(db, 'tests', testId), {
          name: editTestName.trim(),
          description: editTestDesc.trim(),
          prepMode: editTestPrepMode,
          totalDurationSeconds: Math.max(1, editTestDuration) * 60,
          accessPassword: editTestPasswordEnabled ? editTestPassword.trim() : '',
          isArchived: editTestArchived,
          sections: nextSections,
          csvPoolSize: editingCsvQuestions.length,
          csvBundlesEnabled: editingCsvBundleEnabled,
          csvBundleCategoryField: editingCsvBundleCategoryField,
          csvBundleSize: Math.max(1, Number(editingCsvBundleSize) || 1),
          csvBundles: nextBundles,
          updatedAt: nowIso
        });

        const changedResults = await recalculateResultsForTests([{ ...activeEditTest, sections: nextSections }]);
        notify(`Test updated. Recalculated ${changedResults} result(s).`);
      } else {
        const invalidImageRow = editingTestQuestions.find(q => String(q.imageUrl || '').trim() && !sanitizeOptionalUrl(String(q.imageUrl || '')));
        if (invalidImageRow) {
          const rowNumber = editingTestQuestions.findIndex(q => q.id === invalidImageRow.id) + 1;
          notify(`Question ${rowNumber || ''} has an invalid image URL.`);
          return;
        }
        if (editingTestQuestions.length > 0) {
          let batch = writeBatch(db);
          let writes = 0;
          const nowIso = new Date().toISOString();
          for (const row of editingTestQuestions) {
            batch.update(doc(db, 'questions', row.id), {
              imageUrl: sanitizeOptionalUrl(String(row.imageUrl || '')),
              imageAlt: String(row.imageAlt || '').trim(),
              prepMode: editTestPrepMode,
              updatedAt: nowIso
            });
            writes++;
            if (writes >= 450) {
              await batch.commit();
              batch = writeBatch(db);
              writes = 0;
            }
          }
          if (writes > 0) {
            await batch.commit();
          }
        }
        await updateDoc(doc(db, 'tests', testId), {
          name: editTestName.trim(),
          description: editTestDesc.trim(),
          prepMode: editTestPrepMode,
          totalDurationSeconds: Math.max(1, editTestDuration) * 60,
          accessPassword: editTestPasswordEnabled ? editTestPassword.trim() : '',
          isArchived: editTestArchived,
          updatedAt: new Date().toISOString()
        });
      }
      await loadManagedTests();
      cancelEditTest();
    } catch (err: any) {
      notify('Failed to update test. ' + (err?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const togglePauseTest = async (test: MockTest) => {
    try {
      const nextPaused = !(test as any).isPaused;
      await updateDoc(doc(db, 'tests', test.id), {
        isPaused: nextPaused,
        updatedAt: new Date().toISOString()
      });
      await loadManagedTests();
    } catch (err: any) {
      notify('Failed to update test status. ' + (err?.message || ''));
    }
  };

  const moveTestToTop = async (test: MockTest) => {
    try {
      await updateDoc(doc(db, 'tests', test.id), {
        updatedAt: new Date().toISOString()
      });
      await loadManagedTests();
      notify(`"${test.name}" moved to top.`);
    } catch (err: any) {
      notify('Failed to move test. ' + (err?.message || ''));
    }
  };

  const toggleArchiveTest = async (test: MockTest) => {
    try {
      const nextArchived = !test.isArchived;
      await updateDoc(doc(db, 'tests', test.id), {
        isArchived: nextArchived,
        archivedAt: nextArchived ? new Date().toISOString() : '',
        archivedBy: nextArchived ? user.id : '',
        updatedAt: new Date().toISOString()
      });
      await loadManagedTests();
      notify(nextArchived ? 'Test moved to archived tests.' : 'Test restored to active tests.');
    } catch (err: any) {
      notify('Failed to update archive status. ' + (err?.message || ''));
    }
  };

  const removeTest = async (test: MockTest) => {
    const shouldDelete = await confirmDialog({
      title: 'Delete test?',
      message: `Delete test "${test.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!shouldDelete) return;
    try {
      await deleteDoc(doc(db, 'tests', test.id));
      setManagedTests(prev => prev.filter(item => item.id !== test.id));
    } catch (err: any) {
      notify('Failed to delete test. ' + (err?.message || ''));
    }
  };

  const copyTestLink = async (test: MockTest) => {
    const link = `${window.location.origin}/test/${test.id}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const temp = document.createElement('input');
        temp.value = link;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      notify('Test link copied.');
    } catch {
      notify('Could not copy link. Link: ' + link);
    }
  };

  const exportTestQuestionsToCsv = async (test: MockTest) => {
    const ids = Array.from(new Set((test.sections || []).flatMap((section) => section.questionIds || [])));
    if (ids.length === 0) {
      notify('No questions found in this test.');
      return;
    }

    setLoading(true);
    try {
      const questionMap: Record<string, Question> = {};
      for (const chunk of chunkArray(ids, 10)) {
        const qSnap = await getDocs(query(collection(db, 'questions'), where(documentId(), 'in', chunk)));
        qSnap.docs.forEach((d) => {
          questionMap[d.id] = { ...d.data(), id: d.id } as Question;
        });
      }

      const rows = ids.map((id) => questionMap[id]).filter(Boolean);
      if (rows.length === 0) {
        notify('Could not load test questions for export.');
        return;
      }

      const safeName = (test.name || 'test').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'test';
      const datePart = new Date().toISOString().slice(0, 10);
      const csv = buildQuestionsCsv(rows);
      downloadCsv(`${safeName}-questions-${datePart}.csv`, csv);

      const missing = ids.length - rows.length;
      if (missing > 0) {
        notify(`Exported ${rows.length} question(s). ${missing} missing question(s) were skipped.`);
      } else {
        notify(`Exported ${rows.length} question(s) to CSV.`);
      }
    } catch (err: any) {
      notify('Failed to export CSV. ' + (err?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const handleImportCsvDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsImportCsvDragActive(false);
    const file = pickCsvFile(e.dataTransfer?.files || null);
    if (!file) return notify('Please drop a CSV file.');
    processCSV(file);
  };

  const handleDynamicCsvDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDynamicCsvDragActive(false);
    const file = pickCsvFile(e.dataTransfer?.files || null);
    if (!file) return notify('Please drop a CSV file.');
    processCsvForDynamicTest(file);
  };

  const saveGeneratedKeyDocs = async (codes: string[], durationDays: number, prepMode: PrepMode) => {
    const nowIso = new Date().toISOString();
    const batch = writeBatch(db);
    const normalizedDays = Math.max(1, Math.floor(durationDays || 365));
    codes.forEach((code) => {
      const ref = doc(db, 'licenseKeys', code);
      batch.set(ref, {
        code,
        status: 'new',
        isUsed: false,
        prepMode,
        durationDays: normalizedDays,
        createdBy: user.id,
        createdByName: user.name,
        createdAt: nowIso
      });
    });
    await batch.commit();
  };

  const handleGenerateSingleKey = async () => {
    if (!canManageKeys) return;
    setKeyToolLoading(true);
    try {
      const code = makeLicenseKey();
      await saveGeneratedKeyDocs([code], singleKeyDurationDays, licenseKeyPrepMode);
      setGeneratedKeys([code]);
      notify(`Single ${PREP_MODE_LABELS[licenseKeyPrepMode]} activation key generated.`);
    } catch (err: any) {
      notify('Failed to generate key. ' + (err?.message || ''));
    } finally {
      setKeyToolLoading(false);
    }
  };

  const handleGenerateBulkKeys = async () => {
    if (!canManageKeys) return;
    const count = Math.max(1, Math.min(500, Math.floor(bulkKeyCount || 1)));
    setKeyToolLoading(true);
    try {
      const codeSet = new Set<string>();
      while (codeSet.size < count) {
        codeSet.add(makeLicenseKey());
      }
      const codes = Array.from(codeSet);
      await saveGeneratedKeyDocs(codes, bulkKeyDurationDays, licenseKeyPrepMode);
      setGeneratedKeys(codes);
      notify(`Generated ${codes.length} ${PREP_MODE_LABELS[licenseKeyPrepMode]} activation keys.`);
    } catch (err: any) {
      notify('Bulk generation failed. ' + (err?.message || ''));
    } finally {
      setKeyToolLoading(false);
    }
  };

  const copyGeneratedKeys = async () => {
    if (generatedKeys.length === 0) return;
    const text = generatedKeys.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      notify('Generated keys copied.');
    } catch {
      notify('Could not copy keys. Please copy manually from the list.');
    }
  };

  const handleSaveDeadline = async () => {
    if (!canManageKeys) return;
    const iso = watInputToIso(deadlineInput);
    if (!iso) {
      notify('Invalid deadline value. Use a valid date and time.');
      return;
    }

    setDeadlineSaving(true);
    try {
      await setDoc(doc(db, 'licenseKeys', DEADLINE_CONFIG_DOC_ID), {
        status: 'config',
        freeAccessEndsAt: iso,
        updatedBy: user.id,
        updatedByName: user.name,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      notify('Deadline updated successfully.');
    } catch (err: any) {
      notify('Failed to update deadline. ' + (err?.message || ''));
    } finally {
      setDeadlineSaving(false);
    }
  };

  const handleAttendanceWindowChange = (id: string, field: 'openTime' | 'closeTime', value: string) => {
    setAttendanceWindows((prev) => prev.map((window) => window.id === id ? { ...window, [field]: value } : window));
  };

  const handleSaveAttendanceWindows = async () => {
    setAttendanceSaving(true);
    try {
      let previousCloseMinute = -1;
      const windows = attendanceWindows.map((window, index) => {
        let openMinute = timeInputValueToMinutes(window.openTime);
        let closeMinute = timeInputValueToMinutes(window.closeTime);
        if (openMinute === null || closeMinute === null) {
          throw new Error(`Invalid time range for ${window.label || `Window ${index + 1}`}.`);
        }
        while (openMinute <= previousCloseMinute) {
          openMinute += 1440;
        }
        while (closeMinute <= openMinute) {
          closeMinute += 1440;
        }
        if (openMinute === null || closeMinute === null || closeMinute <= openMinute) {
          throw new Error(`Invalid time range for ${window.label || `Window ${index + 1}`}.`);
        }
        previousCloseMinute = closeMinute;
        return {
          id: window.id,
          label: window.label || `Window ${index + 1}`,
          openMinute,
          closeMinute,
          opensAtLabel: minutesToLabel(openMinute),
          closesAtLabel: minutesToLabel(closeMinute)
        };
      });

      await setDoc(doc(db, 'brainstormConfig', 'global'), {
        windows,
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
        updatedByName: user.name
      }, { merge: true });
      notify('Attendance windows updated successfully.');
    } catch (err: any) {
      notify('Failed to update attendance windows. ' + (err?.message || ''));
    } finally {
      setAttendanceSaving(false);
    }
  };

  return (
    <div className="v2-page flex-1 w-full bg-slate-50 flex flex-col overflow-hidden min-h-0">
      <div className="v2-shell bg-white border-b border-slate-100 p-6 flex justify-between items-center shrink-0 safe-top shadow-sm z-10">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-10 h-10" alt="Scholar! logo" />
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">Admin Panel</h1>
            <div className="flex items-center gap-2 mt-1">
               <span className={`w-2 h-2 rounded-full ${dbError ? 'bg-red-500' : 'bg-emerald-500'} animate-pulse`}></span>
               <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{dbError || 'Connected'}</span>
            </div>
            <PartnershipLogos className="mt-2 items-start" size="compact" />
          </div>
        </div>
        <div className="flex gap-2">
          <select
            value={adminPrepModeFilter}
            onChange={(e) => setAdminPrepModeFilter(e.target.value as PrepMode | 'all')}
            className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl bg-white uppercase tracking-widest"
            aria-label="Filter admin content by prep mode"
          >
            <option value="all">All Prep</option>
            {PREP_MODES.map((mode) => (
              <option key={mode} value={mode}>{PREP_MODE_LABELS[mode]}</option>
            ))}
          </select>
          {onOpenCourses && (
            <button onClick={onOpenCourses} className="px-5 py-2 text-xs font-bold text-emerald-700 border border-emerald-100 rounded-xl hover:bg-emerald-50 uppercase tracking-widest">Courses</button>
          )}
          <button onClick={onSwitchToStudent} className="px-5 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 uppercase tracking-widest">Student View</button>
          <button onClick={onLogout} className="px-5 py-2 text-xs font-bold text-red-600 border border-red-50 rounded-xl hover:bg-red-50 uppercase tracking-widest">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 shrink-0 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveTab('analytics')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'analytics' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Analytics</button>
        <button onClick={() => setActiveTab('videos')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'videos' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Videos</button>
        <button onClick={() => setActiveTab('questions')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'questions' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Question Bank</button>
        <button onClick={() => setActiveTab('create-test')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'create-test' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Create Test</button>
        <button onClick={() => setActiveTab('tests')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'tests' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Tests</button>
        <button onClick={() => setActiveTab('import')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'import' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Import</button>
        <button onClick={() => setActiveTab('attendance')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'attendance' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Attendance</button>
        {canManageKeys && (
          <button onClick={() => setActiveTab('license-keys')} className={`px-8 py-4 text-xs font-bold uppercase tracking-widest transition-all ${activeTab === 'license-keys' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>License Keys</button>
        )}
      </nav>

      <div className="flex-1 v2-scroll p-6 md:p-10 safe-bottom">
        {dbError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 font-bold text-xs uppercase tracking-widest">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            {dbError}
          </div>
        )}

        {activeTab === 'analytics' && <AdminAnalytics prepModeFilter={adminPrepModeFilter} />}

        {activeTab === 'videos' && <AdminVideoManager user={user} />}

        {activeTab === 'questions' && (
          <div className="space-y-6">
            <div className="v2-panel bg-white rounded-[2rem] border border-amber-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-900">Tagged Insights</h3>
                <span className="text-xs font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
                  {tagInsightsLoading ? 'Loading...' : `${tagInsights.length} New`}
                </span>
              </div>
              {tagInsights.length === 0 && !tagInsightsLoading ? (
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">No pending tagged questions.</p>
              ) : (
                <div className="space-y-2 max-h-72 v2-scroll">
                  {tagInsights.map((tag) => (
                    <div key={tag.id} className="p-4 bg-amber-50/40 border border-amber-100 rounded-2xl">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-xs font-black uppercase tracking-widest text-amber-700">
                            {tag.testName || 'Unknown Test'} - {tag.userName || 'Unknown User'}
                          </p>
                          <p className="text-xs font-bold text-slate-500">
                            Question ID: {tag.questionId}
                          </p>
                          {tag.note ? (
                            <p className="text-xs text-slate-700">{tag.note}</p>
                          ) : (
                            <p className="text-xs italic text-slate-500">No note provided (tag only).</p>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => openTaggedQuestion(tag.questionId)}
                            className="px-3 py-2 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest"
                          >
                            Open Question
                          </button>
                          <button
                            onClick={() => markTagInsightReviewed(tag)}
                            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-widest"
                          >
                            Mark Reviewed
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <input
                type="text"
                placeholder="Search by subject, topic or question text..."
                className="flex-1 p-5 bg-white border border-slate-100 rounded-2xl text-xs font-bold outline-none shadow-sm"
                value={bankSearchQuery}
                onChange={e => setBankSearchQuery(e.target.value)}
              />
              <button
                onClick={() => runQuestionSearch(bankSearchQuery)}
                className="px-6 py-5 bg-slate-950 text-amber-500 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-slate-900 transition-all"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={openNewQuestionModal}
                className="px-6 py-5 bg-amber-500 text-slate-950 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-amber-600 transition-all"
              >
                Add Question
              </button>
              <button onClick={runBankCleanup} className="px-6 py-5 bg-white border border-red-100 text-red-500 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-red-50 transition-all flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                Clean Bank
              </button>
              <button
                onClick={recalculateAllScores}
                disabled={loading}
                className="px-6 py-5 bg-white border border-amber-200 text-amber-700 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-amber-50 transition-all disabled:opacity-50"
              >
                {loading ? 'Working...' : 'Recalculate Scores'}
              </button>
              <button
                onClick={rebuildLeaderboardPublic}
                disabled={loading}
                className="px-6 py-5 bg-white border border-sky-200 text-sky-700 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-sky-50 transition-all disabled:opacity-50"
              >
                {loading ? 'Working...' : 'Rebuild Ranks'}
              </button>
            </div>

            {!hasSearched && (
              <div className="bg-white p-16 rounded-[2rem] border border-dashed text-center text-slate-300 font-bold uppercase text-xs tracking-[0.2em]">
                Search to load questions
              </div>
            )}

            {hasSearched && questions.length === 0 && !isSearching && (
              <div className="bg-white p-16 rounded-[2rem] border border-dashed text-center text-slate-300 font-bold uppercase text-xs tracking-[0.2em]">
                No results found
              </div>
            )}

            <div className="space-y-4">
              {Object.entries(groupedQuestions).map(([subject, list]) => {
                const isCollapsed = collapsedSubjects[subject];
                return (
                  <div key={subject} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm">
                    <button onClick={() => toggleSubjectCollapse(subject)} className="w-full flex items-center justify-between p-6">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                        <span className="text-[11px] font-bold text-slate-900 uppercase tracking-widest">{subject}</span>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{list.length} item(s)</span>
                      </div>
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{isCollapsed ? 'Expand' : 'Collapse'}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="px-6 pb-6 space-y-3">
                        {list.map(q => (
                          <div key={q.id} className="bg-slate-50 p-5 rounded-2xl border border-slate-100 flex justify-between items-start gap-6">
                            <div className="flex-1">
                              <p className="text-xs font-bold text-amber-600 mb-2 uppercase tracking-widest">{q.topic || 'General'}</p>
                              <p className="text-sm font-bold text-slate-800"><ScientificText text={q.text} /></p>
                              {q.imageUrl && (
                                <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-sky-600">Image attached</p>
                              )}
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => openEditModal(q)} className="p-3 bg-white rounded-xl border border-slate-100 hover:bg-slate-100"><svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                              <button onClick={async () => { const ok = await confirmDialog({ title: 'Delete question?', message: 'Delete this question?', confirmText: 'Delete', variant: 'danger' }); if (ok) { await deleteDoc(doc(db, 'questions', q.id)); setQuestions(prev => prev.filter(item => item.id !== q.id)); } }} className="p-3 bg-red-50 rounded-xl hover:bg-red-100"><svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'create-test' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-1">
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-6">
                <h3 className="text-lg font-bold">Test Setup</h3>
                <input placeholder="Test name" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold" value={testName} onChange={e => setTestName(e.target.value)} />
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                  Prep Mode
                  <select
                    value={testPrepMode}
                    onChange={(e) => setTestPrepMode(e.target.value as PrepMode)}
                    className="mt-2 w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold text-slate-700 outline-none"
                  >
                    {PREP_MODES.map((mode) => (
                      <option key={mode} value={mode}>{PREP_MODE_LABELS[mode]}</option>
                    ))}
                  </select>
                </label>
                <textarea placeholder="Instructions shown to students" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20" value={testDesc} onChange={e => setTestDesc(e.target.value)} />
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                   <span className="text-xs font-bold uppercase text-slate-400">Time (mins)</span>
                   <input type="number" className="bg-transparent font-bold w-full text-center text-xl outline-none" value={testDuration} onChange={e => setTestDuration(parseInt(e.target.value) || 0)} />
                </div>
                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">Build Mode</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTestGenerationMode('fixed')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${testGenerationMode === 'fixed' ? 'bg-slate-950 text-amber-500' : 'bg-slate-200 text-slate-600'}`}
                    >
                      Fixed
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestGenerationMode('dynamic')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${testGenerationMode === 'dynamic' ? 'bg-slate-950 text-amber-500' : 'bg-slate-200 text-slate-600'}`}
                    >
                      Dynamic
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestGenerationMode('csv-dynamic')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${testGenerationMode === 'csv-dynamic' ? 'bg-slate-950 text-amber-500' : 'bg-slate-200 text-slate-600'}`}
                    >
                      CSV Dynamic
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">Allow Retake</span>
                  <button
                    type="button"
                    onClick={() => setAllowRetake(!allowRetake)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${allowRetake ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                  >
                    {allowRetake ? 'Yes' : 'No'}
                  </button>
                </div>

                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">Max Attempts</span>
                  <input
                    type="number"
                    min={1}
                    disabled={!allowRetake}
                    className="bg-transparent font-bold w-full text-center text-xl outline-none disabled:text-slate-300"
                    value={maxAttempts}
                    onChange={e => setMaxAttempts(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Unlimited"
                  />
                </div>

                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">Password Protect</span>
                  <button
                    type="button"
                    onClick={() => setTestPasswordEnabled(!testPasswordEnabled)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${testPasswordEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                  >
                    {testPasswordEnabled ? 'On' : 'Off'}
                  </button>
                </div>
                {testPasswordEnabled && (
                  <input
                    type="text"
                    value={testPassword}
                    onChange={(e) => setTestPassword(e.target.value)}
                    className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold"
                    placeholder="Enter test password"
                  />
                )}

                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">Archive Test</span>
                  <button
                    type="button"
                    onClick={() => setTestArchived(!testArchived)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${testArchived ? 'bg-amber-500 text-slate-950' : 'bg-slate-200 text-slate-600'}`}
                  >
                    {testArchived ? 'Archived' : 'Active'}
                  </button>
                </div>
                
                {testGenerationMode !== 'csv-dynamic' && (
                <div className="space-y-3">
                   <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sections</p>
                   {sections.map((s, idx) => (
                     <button key={s.id} onClick={() => setActiveBuilderSection(idx)} className={`w-full p-4 rounded-2xl border-2 text-left flex justify-between items-center transition-all ${activeBuilderSection === idx ? 'border-amber-500 bg-amber-50' : 'border-slate-50 bg-white'}`}>
                        <div>
                          <input 
                            className="text-xs font-bold text-slate-900 bg-transparent outline-none uppercase" 
                            value={s.name} 
                            onChange={(e) => {
                              const newSections = [...sections];
                              newSections[idx].name = e.target.value;
                              setSections(newSections);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <p className="text-xs text-slate-400 mt-1">
                            {testGenerationMode === 'fixed' ? `${s.questionIds.length} question(s)` : `${s.questionCount || 0} generated question(s)`}
                          </p>
                        </div>
                        {activeBuilderSection === idx && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>}
                     </button>
                   ))}
                   <button onClick={addSection} className="w-full p-3 border-2 border-dashed border-slate-100 rounded-2xl text-xs font-bold text-slate-400 uppercase tracking-widest hover:border-amber-200 transition-all">+ New Section</button>
                </div>
                )}

                {testGenerationMode === 'csv-dynamic' && (
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">CSV Pool</p>
                    <input
                      type="file"
                      ref={dynamicCsvInputRef}
                      accept=".csv,text/csv"
                      onChange={(e) => e.target.files?.[0] && processCsvForDynamicTest(e.target.files[0])}
                      className="w-full p-3 bg-slate-50 border rounded-2xl text-xs font-bold"
                    />
                    <label
                      onClick={() => dynamicCsvInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDynamicCsvDragActive(true); }}
                      onDragLeave={() => setIsDynamicCsvDragActive(false)}
                      onDrop={handleDynamicCsvDrop}
                      className={`w-full block p-5 border-2 border-dashed rounded-2xl text-center text-xs font-bold uppercase tracking-widest cursor-pointer transition-all ${isDynamicCsvDragActive ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-300'}`}
                    >
                      Drag and drop CSV here
                    </label>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                      {csvDynamicFileName ? `${csvDynamicFileName} loaded (${csvDynamicQuestions.length} questions)` : 'No CSV loaded yet'}
                    </p>
                    <label className="text-xs font-bold uppercase text-slate-400 block">
                      Questions Per User
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, csvDynamicQuestions.length)}
                        value={csvDynamicQuestionCount}
                        onChange={(e) => setCsvDynamicQuestionCount(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                      />
                    </label>
                    <label className="text-xs font-bold uppercase text-slate-400 block">
                      Marks Per Question
                      <input
                        type="number"
                        min={1}
                        value={csvDynamicMarksPerQuestion}
                        onChange={(e) => setCsvDynamicMarksPerQuestion(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                      />
                    </label>
                    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-xs font-bold uppercase text-slate-500">Enable Test Bundles</span>
                      <button
                        type="button"
                        onClick={() => setCsvBundleEnabled(!csvBundleEnabled)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest ${csvBundleEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                      >
                        {csvBundleEnabled ? 'On' : 'Off'}
                      </button>
                    </div>
                    {csvBundleEnabled && (
                      <>
                        <label className="text-xs font-bold uppercase text-slate-400 block">
                          Bundle By
                          <select
                            value={csvBundleCategoryField}
                            onChange={(e) => setCsvBundleCategoryField(e.target.value as CsvBundleCategoryField)}
                            className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                          >
                            {CSV_BUNDLE_CATEGORY_OPTIONS.map((field) => (
                              <option key={field} value={field}>{field}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-bold uppercase text-slate-400 block">
                          Bundle Size
                          <input
                            type="number"
                            min={1}
                            max={Math.max(1, csvDynamicQuestions.length)}
                            value={csvBundleSize}
                            onChange={(e) => setCsvBundleSize(Math.max(1, Number(e.target.value) || 1))}
                            className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}

                <button onClick={handleCreateTest} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-xl active:scale-95 transition-all">Publish Test</button>
              </div>
            </div>
            
            <div className="xl:col-span-2 space-y-6 flex flex-col h-[700px]">
               <div className="bg-slate-900 text-white p-6 rounded-[2rem] flex justify-between items-center shadow-lg">
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-widest text-amber-500">
                      {testGenerationMode === 'csv-dynamic' ? 'CSV Dynamic Pool' : `Selecting for: ${sections[activeBuilderSection].name}`}
                    </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    {testGenerationMode === 'fixed'
                      ? 'Tap a question to add/remove from this section'
                      : testGenerationMode === 'dynamic'
                        ? 'Define a sample space and count for this section'
                        : 'Each user gets a unique sampled set from this uploaded CSV pool.'}
                  </p>
                </div>
                  {testGenerationMode === 'fixed' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search question bank..."
                        className="bg-slate-800 border-none p-3 rounded-xl text-xs font-bold w-56 outline-none"
                        value={builderSearchQuery}
                        onChange={e => setBuilderSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            runQuestionSearch(builderSearchQuery);
                          }
                        }}
                      />
                      <button
                        onClick={() => runQuestionSearch(builderSearchQuery)}
                        className="px-4 py-3 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-amber-400 transition-all"
                      >
                        {isSearching ? 'Searching...' : 'Search'}
                      </button>
                    </div>
                  )}
               </div>

               {testGenerationMode === 'fixed' ? (
                 <div className="flex-1 v2-scroll pr-2 space-y-3 pb-10">
                    {questions.length === 0 && (
                      <div className="bg-white p-16 rounded-[2rem] border border-dashed text-center text-slate-300 font-bold uppercase text-xs tracking-[0.2em]">
                        Search the bank to load questions
                      </div>
                    )}
                    {builderQuestions.map(q => {
                      const isSelected = sections[activeBuilderSection].questionIds.includes(q.id);
                      return (
                        <div key={q.id} onClick={() => toggleQuestionInActiveSection(q.id)} className={`p-5 border-2 rounded-2xl cursor-pointer transition-all flex justify-between items-center gap-6 shadow-sm ${isSelected ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-500/10' : 'border-white bg-white hover:border-slate-200'}`}>
                           <div className="flex-1">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{q.subject}</p>
                              <p className="text-sm font-bold text-slate-800 leading-relaxed"><ScientificText text={q.text} /></p>
                           </div>
                           <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 ${isSelected ? 'bg-amber-500 border-amber-500 text-slate-950 shadow-sm' : 'border-slate-100 text-transparent'}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg></div>
                        </div>
                      );
                    })}
                 </div>
               ) : testGenerationMode === 'dynamic' ? (
                 <div className="flex-1 v2-scroll pr-2 pb-10">
                   <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <label className="text-xs font-bold uppercase text-slate-400">
                         Question Count
                         <input
                           type="number"
                           min={1}
                           value={sections[activeBuilderSection].questionCount || 20}
                           onChange={(e) => updateActiveSection(s => ({ ...s, questionCount: Math.max(1, Number(e.target.value) || 1) }))}
                           className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                         />
                       </label>
                       <label className="text-xs font-bold uppercase text-slate-400">
                         Marks Per Question
                         <input
                           type="number"
                           min={1}
                           value={sections[activeBuilderSection].marksPerQuestion || 1}
                           onChange={(e) => updateActiveSection(s => ({ ...s, marksPerQuestion: Math.max(1, Number(e.target.value) || 1) }))}
                           className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                         />
                       </label>
                     </div>
                     <label className="text-xs font-bold uppercase text-slate-400 block">
                       Subjects (comma-separated)
                       <input
                         value={(sections[activeBuilderSection].sampleFilters?.subjects || []).join(', ')}
                         onChange={(e) => updateActiveSection(s => ({ ...s, sampleFilters: { ...(s.sampleFilters || {}), subjects: parseList(e.target.value) } }))}
                         className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs"
                         placeholder="Anatomy, Physiology"
                       />
                     </label>
                     <label className="text-xs font-bold uppercase text-slate-400 block">
                       Topics (comma-separated)
                       <input
                         value={(sections[activeBuilderSection].sampleFilters?.topics || []).join(', ')}
                         onChange={(e) => updateActiveSection(s => ({ ...s, sampleFilters: { ...(s.sampleFilters || {}), topics: parseList(e.target.value) } }))}
                         className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs"
                         placeholder="Cell Biology, Cardiology"
                       />
                     </label>
                     <label className="text-xs font-bold uppercase text-slate-400 block">
                       Tags (comma-separated)
                       <input
                         value={(sections[activeBuilderSection].sampleFilters?.tags || []).join(', ')}
                         onChange={(e) => updateActiveSection(s => ({ ...s, sampleFilters: { ...(s.sampleFilters || {}), tags: parseList(e.target.value) } }))}
                         className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs"
                         placeholder="high-yield, clinical"
                       />
                     </label>
                     <div className="grid grid-cols-3 gap-3">
                       {(['easy', 'medium', 'hard'] as DifficultyLevel[]).map((d) => {
                         const checked = (sections[activeBuilderSection].sampleFilters?.difficulties || ['easy', 'medium', 'hard']).includes(d);
                         return (
                           <button
                             key={d}
                             type="button"
                             onClick={() => {
                               updateActiveSection((s) => {
                                 const curr = s.sampleFilters?.difficulties || ['easy', 'medium', 'hard'];
                                 const next = checked ? curr.filter(item => item !== d) : [...curr, d];
                                 return { ...s, sampleFilters: { ...(s.sampleFilters || {}), difficulties: next.length > 0 ? next : ['easy', 'medium', 'hard'] } };
                               });
                             }}
                             className={`p-3 rounded-xl border text-xs font-bold uppercase ${checked ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
                           >
                             {d}
                           </button>
                         );
                       })}
                     </div>
                     <div className="grid grid-cols-3 gap-3">
                       {(['easy', 'medium', 'hard'] as DifficultyLevel[]).map((d) => (
                         <label key={d} className="text-xs font-bold uppercase text-slate-400">
                           {d} %
                           <input
                             type="number"
                             min={0}
                             max={100}
                             value={(sections[activeBuilderSection].difficultyMix as any)?.[d] ?? (d === 'easy' ? 30 : d === 'medium' ? 50 : 20)}
                             onChange={(e) => updateActiveSection(s => ({ ...s, difficultyMix: { ...(s.difficultyMix || {}), [d]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } }))}
                             className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                           />
                         </label>
                       ))}
                     </div>
                   </div>
                 </div>
               ) : (
                 <div className="flex-1 v2-scroll pr-2 pb-10">
                   <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                     <p className="text-xs text-slate-600">
                       Upload your CSV in the setup panel. The full CSV becomes the private pool for this test,
                       and each attempt generates a unique subset per user based on "Questions Per User".
                     </p>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                       <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                         <p className="text-xs font-bold uppercase text-slate-400">CSV Questions</p>
                         <p className="text-lg font-black text-slate-900 mt-1">{csvDynamicQuestions.length}</p>
                       </div>
                       <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                         <p className="text-xs font-bold uppercase text-slate-400">Per User</p>
                         <p className="text-lg font-black text-slate-900 mt-1">{csvDynamicQuestionCount}</p>
                       </div>
                       <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                         <p className="text-xs font-bold uppercase text-slate-400">Sufficient Pool</p>
                         <p className={`text-lg font-black mt-1 ${csvDynamicQuestionCount <= csvDynamicQuestions.length ? 'text-emerald-600' : 'text-red-600'}`}>
                           {csvDynamicQuestionCount <= csvDynamicQuestions.length ? 'Yes' : 'No'}
                         </p>
                       </div>
                     </div>
                     {csvBundleEnabled && (
                      <div className="p-4 rounded-xl bg-sky-50 border border-sky-100">
                        <p className="text-xs font-bold uppercase tracking-widest text-sky-700">
                          Bundle Preview: {csvBundlePreview.length} bundle(s) by {csvBundleCategoryField}
                        </p>
                        <p className="text-xs text-sky-700 mt-1">
                          Size target: {Math.max(1, Number(csvBundleSize) || 1)} question(s) per bundle.
                        </p>
                      </div>
                     )}
                     {csvDynamicQuestions.length > 0 && (
                       <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                         {csvDynamicQuestions.slice(0, 20).map((q, idx) => (
                           <div key={`${idx}-${q.text.slice(0, 24)}`} className="p-3 rounded-xl border border-slate-100 bg-slate-50">
                             <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{q.subject} - {q.topic || 'General'}</p>
                             <p className="text-xs font-bold text-slate-800 leading-relaxed"><ScientificText text={q.text} /></p>
                           </div>
                         ))}
                         {csvDynamicQuestions.length > 20 && (
                           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                             Showing first 20 of {csvDynamicQuestions.length} CSV questions.
                           </p>
                         )}
                       </div>
                     )}
                   </div>
                 </div>
               )}
            </div>
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Manage Tests</h3>
              <button onClick={loadManagedTests} className="px-5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50">
                Refresh
              </button>
            </div>

            {managedTestsLoading && (
              <div className="bg-white p-12 rounded-[2rem] border border-slate-100 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
                Loading tests...
              </div>
            )}

            {!managedTestsLoading && visibleManagedTests.length === 0 && (
              <div className="bg-white p-12 rounded-[2rem] border border-dashed text-center text-slate-300 text-xs font-bold uppercase tracking-widest">
                No tests found
              </div>
            )}

            <div className="space-y-4">
              {visibleManagedTests.map(test => {
                const isPaused = Boolean((test as any).isPaused);
                const isEditing = editingTestId === test.id;
                return (
                  <div key={test.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                    {!isEditing ? (
                      <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div>
                            <h4 className="text-base font-bold text-slate-900 uppercase">{test.name}</h4>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                              {PREP_MODE_LABELS[(test.prepMode as PrepMode) || DEFAULT_PREP_MODE]} - {Math.round((test.totalDurationSeconds || 0) / 60)} mins - {test.sections?.length || 0} section(s) - {(test.generationMode || 'fixed')} mode
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest ${isPaused ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {isPaused ? 'Paused' : 'Live'}
                            </span>
                            {test.isArchived && (
                              <span className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest bg-slate-200 text-slate-700">
                                Archived
                              </span>
                            )}
                            {test.accessPassword && (
                              <span className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest bg-indigo-100 text-indigo-700">
                                Password
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-slate-500">{test.description || 'No instructions set.'}</p>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => copyTestLink(test)} className="px-5 py-2 bg-emerald-50 rounded-xl text-xs font-bold uppercase tracking-widest text-emerald-700 hover:bg-emerald-100">Copy Link</button>
                          <button onClick={() => exportTestQuestionsToCsv(test)} className="px-5 py-2 bg-indigo-50 rounded-xl text-xs font-bold uppercase tracking-widest text-indigo-700 hover:bg-indigo-100">Export CSV</button>
                          <button onClick={() => startEditTest(test)} className="px-5 py-2 bg-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-700 hover:bg-slate-200">Edit</button>
                          <button onClick={() => moveTestToTop(test)} className="px-5 py-2 bg-violet-50 rounded-xl text-xs font-bold uppercase tracking-widest text-violet-700 hover:bg-violet-100">Back To Top</button>
                          {(test.generationMode || 'fixed') === 'dynamic' && (
                            <button onClick={() => rebuildDynamicPools(test)} className="px-5 py-2 bg-sky-50 rounded-xl text-xs font-bold uppercase tracking-widest text-sky-700 hover:bg-sky-100">Rebuild Pools</button>
                          )}
                          <button onClick={() => toggleArchiveTest(test)} className="px-5 py-2 bg-slate-100 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-700 hover:bg-slate-200">
                            {test.isArchived ? 'Restore' : 'Archive'}
                          </button>
                          <button onClick={() => togglePauseTest(test)} className="px-5 py-2 bg-amber-100 rounded-xl text-xs font-bold uppercase tracking-widest text-amber-700 hover:bg-amber-200">{isPaused ? 'Resume' : 'Pause'}</button>
                          <button onClick={() => removeTest(test)} className="px-5 py-2 bg-red-50 rounded-xl text-xs font-bold uppercase tracking-widest text-red-600 hover:bg-red-100">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <input value={editTestName} onChange={(e) => setEditTestName(e.target.value)} className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold" placeholder="Test name" />
                        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                          Prep Mode
                          <select
                            value={editTestPrepMode}
                            onChange={(e) => setEditTestPrepMode(e.target.value as PrepMode)}
                            className="mt-2 w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold text-slate-700 outline-none"
                          >
                            {PREP_MODES.map((mode) => (
                              <option key={mode} value={mode}>{PREP_MODE_LABELS[mode]}</option>
                            ))}
                          </select>
                        </label>
                        <textarea value={editTestDesc} onChange={(e) => setEditTestDesc(e.target.value)} className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-24" placeholder="Instructions" />
                        <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                          <span className="text-xs font-bold uppercase text-slate-400">Time (mins)</span>
                          <input type="number" min={1} value={editTestDuration} onChange={(e) => setEditTestDuration(parseInt(e.target.value) || 1)} className="bg-transparent font-bold w-full text-center text-xl outline-none" />
                        </div>
                        <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                          <span className="text-xs font-bold uppercase text-slate-400">Password Protect</span>
                          <button
                            type="button"
                            onClick={() => setEditTestPasswordEnabled(!editTestPasswordEnabled)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${editTestPasswordEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                          >
                            {editTestPasswordEnabled ? 'On' : 'Off'}
                          </button>
                        </div>
                        {editTestPasswordEnabled && (
                          <input
                            type="text"
                            value={editTestPassword}
                            onChange={(e) => setEditTestPassword(e.target.value)}
                            className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold"
                            placeholder="Enter test password"
                          />
                        )}
                        <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                          <span className="text-xs font-bold uppercase text-slate-400">Archive Test</span>
                          <button
                            type="button"
                            onClick={() => setEditTestArchived(!editTestArchived)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${editTestArchived ? 'bg-amber-500 text-slate-950' : 'bg-slate-200 text-slate-600'}`}
                          >
                            {editTestArchived ? 'Archived' : 'Active'}
                          </button>
                        </div>
                        {(test.generationMode || 'fixed') !== 'csv-dynamic' && (
                          <div className="space-y-4 rounded-2xl border border-slate-100 p-4 bg-slate-50/50">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Question Images</p>
                                <p className="text-xs text-slate-400 mt-1">
                                  Add or change images for questions currently available in this test.
                                </p>
                              </div>
                              <span className="px-3 py-1.5 rounded-lg bg-white border border-slate-100 text-xs font-black uppercase text-slate-500">
                                {editingTestQuestions.length}
                              </span>
                            </div>
                            {editingTestQuestionsLoading ? (
                              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 py-3">Loading test questions...</div>
                            ) : editingTestQuestions.length === 0 ? (
                              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 py-3">No questions loaded for this test.</div>
                            ) : (
                              <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                                {editingTestQuestions.map((q, idx) => (
                                  <div key={q.id} className="rounded-xl border border-slate-100 bg-white p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Question {idx + 1}</p>
                                        <p className="text-xs font-bold text-slate-800 mt-1 line-clamp-2"><ScientificText text={q.text || 'Untitled question'} /></p>
                                      </div>
                                      {q.imageUrl && (
                                        <span className="shrink-0 px-2 py-1 rounded-lg bg-sky-50 border border-sky-100 text-[10px] font-black uppercase text-sky-700">
                                          Image
                                        </span>
                                      )}
                                    </div>
                                    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                                      <div className="flex flex-col md:flex-row gap-2">
                                        <input
                                          value={q.imageUrl || ''}
                                          onChange={(e) => setEditingTestQuestions(prev => prev.map((item, i) => i === idx ? { ...item, imageUrl: e.target.value } : item))}
                                          className="flex-1 p-3 bg-white border border-slate-100 rounded-xl text-xs font-bold"
                                          placeholder="Image URL (optional)"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => openMediaPicker({ kind: 'test-question', id: q.id })}
                                          className="px-4 py-3 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest"
                                        >
                                          Browse Media
                                        </button>
                                      </div>
                                      <div className="flex flex-col md:flex-row gap-2">
                                        <input
                                          value={q.imageAlt || ''}
                                          onChange={(e) => setEditingTestQuestions(prev => prev.map((item, i) => i === idx ? { ...item, imageAlt: e.target.value } : item))}
                                          className="flex-1 p-3 bg-white border border-slate-100 rounded-xl text-xs font-bold"
                                          placeholder="Image alt text (optional)"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setEditingTestQuestions(prev => prev.map((item, i) => i === idx ? { ...item, imageUrl: '', imageAlt: '' } : item))}
                                          className="px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-widest"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                      {sanitizeOptionalUrl(q.imageUrl || '') && (
                                        <img
                                          src={sanitizeOptionalUrl(q.imageUrl || '')}
                                          alt={q.imageAlt || 'Question diagram preview'}
                                          className="max-h-52 w-full object-contain rounded-xl bg-white border border-slate-100"
                                        />
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {(test.generationMode || 'fixed') === 'csv-dynamic' && (
                          <div className="space-y-4 rounded-2xl border border-slate-100 p-4 bg-slate-50/50">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <label className="p-3 bg-white rounded-xl border border-slate-100">
                                <span className="text-xs font-bold uppercase text-slate-400">CSV Questions</span>
                                <p className="text-lg font-black text-slate-900 mt-1">{editingCsvQuestions.length}</p>
                              </label>
                              <label className="p-3 bg-white rounded-xl border border-slate-100">
                                <span className="text-xs font-bold uppercase text-slate-400">Per User</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={Math.max(1, editingCsvQuestions.length || 1)}
                                  value={editingCsvQuestionCount}
                                  onChange={(e) => setEditingCsvQuestionCount(Math.max(1, Number(e.target.value) || 1))}
                                  className="w-full mt-2 p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                />
                              </label>
                              <label className="p-3 bg-white rounded-xl border border-slate-100">
                                <span className="text-xs font-bold uppercase text-slate-400">Marks / Question</span>
                                <input
                                  type="number"
                                  min={1}
                                  value={editingCsvMarksPerQuestion}
                                  onChange={(e) => setEditingCsvMarksPerQuestion(Math.max(1, Number(e.target.value) || 1))}
                                  className="w-full mt-2 p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                />
                              </label>
                            </div>

                            <div className="rounded-xl border border-slate-100 bg-white p-4 space-y-3">
                              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                                <input
                                  type="checkbox"
                                  checked={editingCsvBundleEnabled}
                                  onChange={(e) => setEditingCsvBundleEnabled(e.target.checked)}
                                  className="w-4 h-4 accent-amber-500"
                                />
                                Enable CSV Bundles
                              </label>
                              {editingCsvBundleEnabled && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <label className="text-xs font-bold uppercase text-slate-500">
                                    Bundle By
                                    <select
                                      value={editingCsvBundleCategoryField}
                                      onChange={(e) => setEditingCsvBundleCategoryField(e.target.value as CsvBundleCategoryField)}
                                      className="w-full mt-2 p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                    >
                                      {CSV_BUNDLE_CATEGORY_OPTIONS.map((opt) => (
                                        <option key={opt} value={opt}>{opt}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-xs font-bold uppercase text-slate-500">
                                    Bundle Size
                                    <input
                                      type="number"
                                      min={1}
                                      max={Math.max(1, editingCsvQuestions.length || 1)}
                                      value={editingCsvBundleSize}
                                      onChange={(e) => setEditingCsvBundleSize(Math.max(1, Number(e.target.value) || 1))}
                                      className="w-full mt-2 p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                    />
                                  </label>
                                  <p className="md:col-span-2 text-xs font-bold uppercase tracking-widest text-sky-700 bg-sky-50 border border-sky-100 rounded-xl p-3">
                                    Bundle Preview: {editingCsvBundlePreview.length} bundle(s)
                                  </p>
                                </div>
                              )}
                            </div>

                            {editingCsvLoading ? (
                              <div className="text-xs font-bold uppercase tracking-widest text-slate-400 py-3">Loading CSV pool...</div>
                            ) : (
                              <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                                {editingCsvQuestions.map((q, idx) => (
                                  <div key={q.id} className="rounded-xl border border-slate-100 bg-white p-4 space-y-3">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Question {idx + 1}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                      <input
                                        value={q.subject || ''}
                                        onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, subject: e.target.value } : item))}
                                        className="p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                        placeholder="Subject"
                                      />
                                      <input
                                        value={q.topic || ''}
                                        onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, topic: e.target.value } : item))}
                                        className="p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                        placeholder="Topic"
                                      />
                                      <select
                                        value={q.difficulty || DEFAULT_DIFFICULTY}
                                        onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, difficulty: normalizeDifficulty(e.target.value) } : item))}
                                        className="p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                      >
                                        <option value="easy">easy</option>
                                        <option value="medium">medium</option>
                                        <option value="hard">hard</option>
                                      </select>
                                    </div>
                                    <textarea
                                      value={q.text || ''}
                                      onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, text: e.target.value } : item))}
                                      className="w-full p-3 bg-slate-50 border rounded-xl text-xs h-24"
                                      placeholder="Question text"
                                    />
                                    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                                      <div className="flex flex-col md:flex-row gap-2">
                                        <input
                                          value={q.imageUrl || ''}
                                          onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, imageUrl: e.target.value } : item))}
                                          className="flex-1 p-3 bg-white border border-slate-100 rounded-xl text-xs font-bold"
                                          placeholder="Image URL (optional)"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => openMediaPicker({ kind: 'csv-test-question', id: q.id })}
                                          className="px-4 py-3 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest"
                                        >
                                          Browse Media
                                        </button>
                                      </div>
                                      <div className="flex flex-col md:flex-row gap-2">
                                        <input
                                          value={q.imageAlt || ''}
                                          onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, imageAlt: e.target.value } : item))}
                                          className="flex-1 p-3 bg-white border border-slate-100 rounded-xl text-xs font-bold"
                                          placeholder="Image alt text (optional)"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, imageUrl: '', imageAlt: '' } : item))}
                                          className="px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-widest"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                      {sanitizeOptionalUrl(q.imageUrl || '') && (
                                        <img
                                          src={sanitizeOptionalUrl(q.imageUrl || '')}
                                          alt={q.imageAlt || 'Question diagram preview'}
                                          className="max-h-52 w-full object-contain rounded-xl bg-white border border-slate-100"
                                        />
                                      )}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      {[0, 1, 2, 3].map((optIdx) => (
                                        <input
                                          key={optIdx}
                                          value={q.options?.[optIdx] || ''}
                                          onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => {
                                            if (i !== idx) return item;
                                            const nextOptions = [...(item.options || ['', '', '', ''])];
                                            nextOptions[optIdx] = e.target.value;
                                            return { ...item, options: nextOptions };
                                          }))}
                                          className="p-2 bg-slate-50 border rounded-xl text-xs"
                                          placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                                        />
                                      ))}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                      <select
                                        value={Number(q.correctAnswerIndex)}
                                        onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, correctAnswerIndex: Number(e.target.value) } : item))}
                                        className="p-2 bg-slate-50 border rounded-xl text-xs font-bold"
                                      >
                                        <option value={0}>Correct: A</option>
                                        <option value={1}>Correct: B</option>
                                        <option value={2}>Correct: C</option>
                                        <option value={3}>Correct: D</option>
                                      </select>
                                      <input
                                        value={(q.tags || []).join(', ')}
                                        onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, tags: parseList(e.target.value) } : item))}
                                        className="p-2 bg-slate-50 border rounded-xl text-xs"
                                        placeholder="Tags"
                                      />
                                      <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500 p-2 bg-slate-50 border rounded-xl">
                                        <input
                                          type="checkbox"
                                          checked={q.isActive !== false}
                                          onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, isActive: e.target.checked } : item))}
                                          className="w-4 h-4 accent-amber-500"
                                        />
                                        Active
                                      </label>
                                    </div>
                                    <textarea
                                      value={q.explanation || ''}
                                      onChange={(e) => setEditingCsvQuestions(prev => prev.map((item, i) => i === idx ? { ...item, explanation: e.target.value } : item))}
                                      className="w-full p-3 bg-slate-50 border rounded-xl text-xs h-20"
                                      placeholder="Explanation"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button disabled={loading || editingCsvLoading || editingTestQuestionsLoading} onClick={() => saveEditedTest(test.id)} className="px-6 py-3 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-40">Save</button>
                          <button disabled={loading} onClick={cancelEditTest} className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-40">Cancel</button>
                          {editAutosaveStatus && (
                            <span className="self-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                              {editAutosaveStatus}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'import' && (
           <div className="max-w-2xl mx-auto py-20 text-center">
              {importStatus === 'idle' ? (
                <div className="space-y-4">
                  <input type="file" id="pdf-input" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => e.target.files?.[0] && processPDF(e.target.files[0])} />
                  <input type="file" id="csv-input" ref={csvInputRef} className="hidden" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && processCSV(e.target.files[0])} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button onClick={() => fileInputRef.current?.click()} className="bg-white p-8 rounded-[2rem] border-2 border-dashed border-slate-100 hover:border-amber-400 transition-all shadow-sm group text-left">
                      <h3 className="text-sm font-bold mb-2 uppercase text-slate-900">Import From PDF</h3>
                      <p className="text-xs text-slate-400 font-medium">AI extract questions and review before publish.</p>
                    </button>
                    <button onClick={() => csvInputRef.current?.click()} className="bg-white p-8 rounded-[2rem] border-2 border-dashed border-slate-100 hover:border-emerald-400 transition-all shadow-sm group text-left">
                      <h3 className="text-sm font-bold mb-2 uppercase text-slate-900">Import From CSV</h3>
                      <p className="text-xs text-slate-400 font-medium">Fast bulk upload with row validation and dedupe.</p>
                    </button>
                    <button
                      onClick={() => csvInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsImportCsvDragActive(true); }}
                      onDragLeave={() => setIsImportCsvDragActive(false)}
                      onDrop={handleImportCsvDrop}
                      className={`bg-white p-8 rounded-[2rem] border-2 border-dashed transition-all shadow-sm group text-left ${isImportCsvDragActive ? 'border-emerald-400 bg-emerald-50' : 'border-slate-100 hover:border-emerald-400'}`}
                    >
                      <h3 className="text-sm font-bold mb-2 uppercase text-slate-900">Drop CSV Here</h3>
                      <p className="text-xs text-slate-400 font-medium">You can drag and drop a CSV file to import.</p>
                    </button>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-100 text-left">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">CSV Headers</p>
                    <code className="text-xs text-slate-700 break-words">
                      {CSV_IMPORT_HEADER_LINE}
                    </code>
                  </div>
                </div>
              ) : importStatus === 'parsing' ? (
                <div className="py-20 flex flex-col items-center">
                  <div className="w-72 h-2 bg-slate-100 rounded-full overflow-hidden mb-6">
                    <div className="h-full bg-amber-500 animate-pulse w-1/2"></div>
                  </div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Processing file...</p>
                </div>
              ) : (
                <div className="space-y-6 text-left animate-in slide-in-from-bottom-10">
                  <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between bg-slate-950 p-6 rounded-3xl text-white shadow-2xl">
                    <div>
                      <p className="text-sm font-bold uppercase text-amber-500">{stagedQuestions.filter(q => q.selected).length} Selected</p>
                      <p className="text-xs text-slate-400 uppercase font-bold mt-1">Review and edit before adding</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={commitImportedQuestions} className="px-6 py-3 bg-amber-500 text-slate-950 rounded-xl font-bold uppercase text-xs hover:bg-amber-600">Add to Bank</button>
                      <button onClick={() => setImportStatus('idle')} className="px-6 py-3 bg-slate-800 text-white rounded-xl font-bold uppercase text-xs">Cancel</button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {stagedQuestions.map((q, i) => (
                      <div key={i} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={!!q.selected}
                              onChange={(e) => {
                                const next = [...stagedQuestions];
                                next[i].selected = e.target.checked;
                                setStagedQuestions(next);
                              }}
                              className="w-4 h-4 accent-amber-500"
                            />
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Include</span>
                          </div>
                          <span className="text-xs font-bold text-amber-600 uppercase tracking-widest">{q.subject || 'General'}</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input
                            value={q.subject}
                            onChange={(e) => {
                              const next = [...stagedQuestions];
                              next[i].subject = e.target.value;
                              setStagedQuestions(next);
                            }}
                            className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                            placeholder="Subject"
                          />
                          <input
                            value={q.topic}
                            onChange={(e) => {
                              const next = [...stagedQuestions];
                              next[i].topic = e.target.value;
                              setStagedQuestions(next);
                            }}
                            className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                            placeholder="Topic"
                          />
                          <select
                            value={q.difficulty || DEFAULT_DIFFICULTY}
                            onChange={(e) => {
                              const next = [...stagedQuestions];
                              next[i].difficulty = normalizeDifficulty(e.target.value);
                              setStagedQuestions(next);
                            }}
                            className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                          >
                            <option value="easy">easy</option>
                            <option value="medium">medium</option>
                            <option value="hard">hard</option>
                          </select>
                          <input
                            value={(q.tags || []).join(', ')}
                            onChange={(e) => {
                              const next = [...stagedQuestions];
                              next[i].tags = parseList(e.target.value);
                              setStagedQuestions(next);
                            }}
                            className="w-full p-3 bg-slate-50 border rounded-xl text-xs"
                            placeholder="Tags (comma-separated)"
                          />
                        </div>

                        <textarea
                          value={q.text}
                          onChange={(e) => {
                            const next = [...stagedQuestions];
                            next[i].text = e.target.value;
                            setStagedQuestions(next);
                          }}
                          className="w-full p-4 bg-slate-50 border rounded-xl text-sm"
                          rows={4}
                          placeholder="Question text"
                        />

                        <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <input
                            value={q.imageUrl || ''}
                            onChange={(e) => {
                              const next = [...stagedQuestions];
                              next[i].imageUrl = e.target.value;
                              setStagedQuestions(next);
                            }}
                            className="w-full p-3 bg-white border border-slate-100 rounded-xl text-xs"
                            placeholder="Image URL (optional)"
                          />
                          <input
                            value={q.imageAlt || ''}
                            onChange={(e) => {
                              const next = [...stagedQuestions];
                              next[i].imageAlt = e.target.value;
                              setStagedQuestions(next);
                            }}
                            className="w-full p-3 bg-white border border-slate-100 rounded-xl text-xs"
                            placeholder="Image alt text (optional)"
                          />
                          {sanitizeOptionalUrl(q.imageUrl || '') && (
                            <img
                              src={sanitizeOptionalUrl(q.imageUrl || '')}
                              alt={q.imageAlt || 'Question diagram preview'}
                              className="max-h-52 w-full object-contain rounded-xl bg-white border border-slate-100"
                            />
                          )}
                        </div>

                        <div className="space-y-2">
                          {q.options.map((opt, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                              <input
                                type="radio"
                                checked={q.correctAnswerIndex === idx}
                                onChange={() => {
                                  const next = [...stagedQuestions];
                                  next[i].correctAnswerIndex = idx;
                                  setStagedQuestions(next);
                                }}
                                className="accent-amber-500 w-4"
                              />
                              <input
                                value={opt}
                                onChange={(e) => {
                                  const next = [...stagedQuestions];
                                  next[i].options[idx] = e.target.value;
                                  setStagedQuestions(next);
                                }}
                                className="w-full p-3 bg-slate-50 border rounded-xl text-xs"
                                placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                              />
                            </div>
                          ))}
                        </div>

                        <textarea
                          value={q.explanation || ''}
                          onChange={(e) => {
                            const next = [...stagedQuestions];
                            next[i].explanation = e.target.value;
                            setStagedQuestions(next);
                          }}
                          className="w-full p-4 bg-slate-50 border rounded-xl text-xs"
                          rows={3}
                          placeholder="Explanation (optional)"
                        />
                        <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">
                          <input
                            type="checkbox"
                            checked={q.isActive !== false}
                            onChange={(e) => {
                              const next = [...stagedQuestions];
                              next[i].isActive = e.target.checked;
                              setStagedQuestions(next);
                            }}
                            className="accent-amber-500"
                          />
                          Active
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
           </div>
        )}

        {activeTab === 'attendance' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Attendance Windows</h3>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                These Lagos-time windows control the centralized attendance portal and strike checks.
              </p>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm space-y-5">
              {attendanceWindows.map((window, index) => (
                <div key={window.id} className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-5">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                    <div>
                      <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">{window.label}</h4>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Window {index + 1}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Open Time
                      <input
                        type="time"
                        value={window.openTime}
                        onChange={(e) => handleAttendanceWindowChange(window.id, 'openTime', e.target.value)}
                        className="mt-2 w-full p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none"
                      />
                    </label>
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Close Time
                      <input
                        type="time"
                        value={window.closeTime}
                        onChange={(e) => handleAttendanceWindowChange(window.id, 'closeTime', e.target.value)}
                        className="mt-2 w-full p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none"
                      />
                    </label>
                  </div>
                </div>
              ))}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveAttendanceWindows}
                  disabled={attendanceSaving}
                  className="px-6 py-4 bg-slate-950 text-amber-500 rounded-2xl text-xs font-bold uppercase tracking-widest disabled:opacity-40"
                >
                  {attendanceSaving ? 'Saving...' : 'Save Attendance Windows'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'license-keys' && canManageKeys && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Activation Key Generator</h3>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Root admin only. Generated keys are stored in <code>licenseKeys</code>.
              </p>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Free Access Deadline (WAT)</h4>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                This controls when paywall lock starts for unpaid users.
              </p>
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  type="datetime-local"
                  value={deadlineInput}
                  onChange={(e) => setDeadlineInput(e.target.value)}
                  className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none"
                />
                <button
                  onClick={handleSaveDeadline}
                  disabled={deadlineSaving}
                  className="px-6 py-4 bg-slate-950 text-amber-500 rounded-2xl text-xs font-bold uppercase tracking-widest disabled:opacity-40"
                >
                  {deadlineSaving ? 'Saving...' : 'Save Deadline'}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Default reference: April 2, 2026 at 00:00 WAT.
              </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Single Key</h4>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                  Prep Mode
                  <select
                    value={licenseKeyPrepMode}
                    onChange={(e) => setLicenseKeyPrepMode(e.target.value as PrepMode)}
                    className="mt-2 w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none"
                  >
                    {PREP_MODES.map((mode) => (
                      <option key={mode} value={mode}>{PREP_MODE_LABELS[mode]}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">Duration (days)</span>
                  <input
                    type="number"
                    min={1}
                    value={singleKeyDurationDays}
                    onChange={(e) => setSingleKeyDurationDays(Math.max(1, Number(e.target.value) || 365))}
                    className="bg-transparent font-bold w-full text-center text-xl outline-none"
                  />
                </div>
                <button
                  onClick={handleGenerateSingleKey}
                  disabled={keyToolLoading}
                  className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-xs tracking-widest disabled:opacity-40"
                >
                  {keyToolLoading ? 'Working...' : 'Generate One Key'}
                </button>
              </div>

              <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Bulk Keys</h4>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                  Prep Mode
                  <select
                    value={licenseKeyPrepMode}
                    onChange={(e) => setLicenseKeyPrepMode(e.target.value as PrepMode)}
                    className="mt-2 w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none"
                  >
                    {PREP_MODES.map((mode) => (
                      <option key={mode} value={mode}>{PREP_MODE_LABELS[mode]}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">How Many</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={bulkKeyCount}
                    onChange={(e) => setBulkKeyCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                    className="bg-transparent font-bold w-full text-center text-xl outline-none"
                  />
                </div>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <span className="text-xs font-bold uppercase text-slate-400">Duration (days)</span>
                  <input
                    type="number"
                    min={1}
                    value={bulkKeyDurationDays}
                    onChange={(e) => setBulkKeyDurationDays(Math.max(1, Number(e.target.value) || 365))}
                    className="bg-transparent font-bold w-full text-center text-xl outline-none"
                  />
                </div>
                <button
                  onClick={handleGenerateBulkKeys}
                  disabled={keyToolLoading}
                  className="w-full py-4 bg-amber-500 text-slate-950 rounded-2xl font-bold uppercase text-xs tracking-widest disabled:opacity-40"
                >
                  {keyToolLoading ? 'Working...' : 'Generate Bulk Keys'}
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm">
              <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between mb-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Latest Generated Keys</h4>
                <button
                  onClick={copyGeneratedKeys}
                  disabled={generatedKeys.length === 0}
                  className="px-5 py-2 bg-slate-950 text-amber-500 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-30"
                >
                  Copy All
                </button>
              </div>
              {generatedKeys.length === 0 ? (
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">No new keys generated this session.</p>
              ) : (
                <div className="max-h-72 v2-scroll space-y-2">
                  {generatedKeys.map((key) => (
                    <div key={key} className="px-4 py-3 rounded-xl border border-slate-100 bg-slate-50 font-mono text-sm font-bold tracking-wide text-slate-900">
                      {key}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-start md:items-center justify-center p-3 md:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto safe-top safe-bottom">
          <div className="w-full max-w-xl md:max-w-2xl max-h-[90dvh] bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100 v2-panel">
            <div className="v2-shell bg-slate-950 px-6 py-5 text-white flex justify-between items-center shrink-0">
              <h3 className="text-sm font-bold uppercase tracking-widest">{editingId ? 'Edit Question' : 'Add Question'}</h3>
              <button onClick={() => { setIsQuestionModalOpen(false); resetForm(); }} className="text-slate-300 hover:text-white">Close</button>
            </div>
            <form onSubmit={handleSaveQuestion} className="v2-scroll p-5 md:p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input placeholder="Subject" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold outline-none" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                <input placeholder="Topic" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold outline-none" value={qTopic} onChange={e => setQTopic(e.target.value)} />
              </div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">
                Prep Mode
                <select
                  value={qPrepMode}
                  onChange={(e) => setQPrepMode(e.target.value as PrepMode)}
                  className="mt-2 w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold text-slate-700 outline-none"
                >
                  {PREP_MODES.map((mode) => (
                    <option key={mode} value={mode}>{PREP_MODE_LABELS[mode]}</option>
                  ))}
                </select>
              </label>
              <textarea placeholder="Question text" className="w-full p-5 bg-slate-50 border rounded-2xl text-sm h-32 outline-none" value={qText} onChange={e => setQText(e.target.value)} required />
              <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    placeholder="Image URL (optional)"
                    className="flex-1 p-4 bg-white border border-slate-100 rounded-2xl text-xs font-bold outline-none"
                    value={qImageUrl}
                    onChange={e => setQImageUrl(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => openMediaPicker()}
                    className="px-5 py-4 bg-slate-950 text-amber-500 rounded-2xl text-xs font-bold uppercase tracking-widest"
                  >
                    Browse Media
                  </button>
                </div>
                <input
                  placeholder="Image alt text (optional)"
                  className="w-full p-4 bg-white border border-slate-100 rounded-2xl text-xs font-bold outline-none"
                  value={qImageAlt}
                  onChange={e => setQImageAlt(e.target.value)}
                />
                {sanitizeOptionalUrl(qImageUrl) && (
                  <div className="rounded-2xl bg-white border border-slate-100 p-3">
                    <img src={sanitizeOptionalUrl(qImageUrl)} alt={qImageAlt || 'Question diagram preview'} className="max-h-64 w-full object-contain rounded-xl" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select value={qDifficulty} onChange={e => setQDifficulty(normalizeDifficulty(e.target.value))} className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold outline-none">
                  <option value="easy">easy</option>
                  <option value="medium">medium</option>
                  <option value="hard">hard</option>
                </select>
                <input placeholder="Tags (comma-separated)" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold outline-none" value={qTags} onChange={e => setQTags(e.target.value)} />
              </div>
              {qOptions.map((o, i) => (
                <div key={i} className="flex gap-2">
                   <input type="radio" checked={qCorrect === i} onChange={() => setQCorrect(i)} className="accent-amber-500 w-4" name="correct" />
                   <input className="w-full p-3 bg-slate-50 border rounded-xl text-xs" value={o} placeholder={`Option ${String.fromCharCode(65+i)}`} onChange={e => { const n = [...qOptions]; n[i] = e.target.value; setQOptions(n); }} required />
                </div>
              ))}
              <textarea placeholder="Explanation (optional)" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20 outline-none" value={qExplanation} onChange={e => setQExplanation(e.target.value)} />
              <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">
                <input type="checkbox" checked={qIsActive} onChange={(e) => setQIsActive(e.target.checked)} className="accent-amber-500" />
                Active
              </label>
              <button disabled={loading} className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-xs tracking-widest shadow-xl active:scale-95 transition-all">{editingId ? 'Save Changes' : 'Add Question'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;




import React, { useState, useRef, useMemo, useEffect } from 'react';
import { User, Question, TestSection, MockTest, ExamResult, DifficultyLevel, TestGenerationMode } from '../types';
import { db } from '../firebase';
import { collection, addDoc, getDocs, getDoc, deleteDoc, doc, query, updateDoc, setDoc, writeBatch, limit, where, documentId } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { GoogleGenAI } from '@google/genai';
import ScientificText from './ScientificText';
import AdminAnalytics from './AdminAnalytics';
import logo from '../assets/logo.png';

interface AdminDashboardProps {
  user: User;
  initialTab?: AdminTab;
  onLogout: () => void;
  onSwitchToStudent: () => void;
}

type AdminTab = 'questions' | 'create-test' | 'tests' | 'import' | 'analytics' | 'license-keys';
type StagedQuestion = Omit<Question, 'id' | 'createdAt' | 'createdBy'> & { selected?: boolean };

const normalizeText = (text: string) => text.toLowerCase().trim().replace(/\s+/g, ' ');
const normalizeOptions = (options: string[]) => options.map(opt => opt.trim());
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

const parseList = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
const normalizeDifficulty = (value: string): DifficultyLevel => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'easy' || normalized === 'hard') return normalized;
  return 'medium';
};
const toBoolean = (value: string, fallback = true) => {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;
  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
  return fallback;
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

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, initialTab = 'questions', onLogout, onSwitchToStudent }) => {
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
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [managedTests, setManagedTests] = useState<MockTest[]>([]);
  const [managedTestsLoading, setManagedTestsLoading] = useState(false);
  const [editingTestId, setEditingTestId] = useState<string | null>(null);
  const [editTestName, setEditTestName] = useState('');
  const [editTestDesc, setEditTestDesc] = useState('');
  const [editTestDuration, setEditTestDuration] = useState(60);
  
  // Test Builder State
  const [testName, setTestName] = useState('');
  const [testDesc, setTestDesc] = useState('');
  const [testDuration, setTestDuration] = useState(60);
  const [testGenerationMode, setTestGenerationMode] = useState<TestGenerationMode>('fixed');
  const [allowRetake, setAllowRetake] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState<number | ''>('');
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
  const [qDifficulty, setQDifficulty] = useState<DifficultyLevel>(DEFAULT_DIFFICULTY);
  const [qTags, setQTags] = useState('');
  const [qIsActive, setQIsActive] = useState(true);

  // AI Import State
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'review'>('idle');
  const [stagedQuestions, setStagedQuestions] = useState<StagedQuestion[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [singleKeyDurationDays, setSingleKeyDurationDays] = useState(365);
  const [bulkKeyCount, setBulkKeyCount] = useState(10);
  const [bulkKeyDurationDays, setBulkKeyDurationDays] = useState(365);
  const [generatedKeys, setGeneratedKeys] = useState<string[]>([]);
  const [keyToolLoading, setKeyToolLoading] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState(toWatInputValue(DEFAULT_FREE_ACCESS_ENDS_AT_ISO));
  const [deadlineSaving, setDeadlineSaving] = useState(false);

  const groupedQuestions = useMemo(() => {
    const groups: Record<string, Question[]> = {};
    questions.forEach(q => {
      const subject = q.subject?.trim() || 'General';
      if (!groups[subject]) groups[subject] = [];
      groups[subject].push(q);
    });
    return groups;
  }, [questions]);

  const builderQuestions = useMemo(() => {
    const q = builderSearchQuery.toLowerCase().trim();
    if (!q) return questions;
    return questions.filter(item =>
      item.text.toLowerCase().includes(q) ||
      item.subject.toLowerCase().includes(q) ||
      (item.topic || '').toLowerCase().includes(q)
    );
  }, [questions, builderSearchQuery]);

  useEffect(() => {
    if (activeTab === 'tests') {
      loadManagedTests();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!canManageKeys && activeTab === 'license-keys') {
      setActiveTab('questions');
    }
  }, [activeTab, canManageKeys]);

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
    if (!window.confirm('Recalculate all stored results using current question answers? This may take some time.')) return;
    setLoading(true);
    try {
      const testsSnap = await getDocs(collection(db, 'tests'));
      const tests = testsSnap.docs.map(d => ({ ...d.data(), id: d.id } as MockTest));
      const changedResults = await recalculateResultsForTests(tests);
      alert(`Recalculation complete. Updated ${changedResults} result(s).`);
    } catch (err: any) {
      alert('Score recalculation failed. ' + (err?.message || ''));
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
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      setManagedTests(data);
    } catch (err: any) {
      alert('Unable to load tests. ' + (err?.message || ''));
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
    if (!window.confirm("Find and remove identical questions? This cannot be undone.")) return;
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
        alert(`Cleanup successful. Removed ${duplicatesToDelete.length} duplicates.`);
      } else {
        alert("No duplicate questions found.");
      }
    } catch (err: any) {
      console.error("Cleanup Error:", err);
      if (err.code === 'unavailable' || !navigator.onLine) {
        alert("Operation failed: You are currently offline or the database is unreachable.");
      } else {
        alert("Cleanup failed: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const processPDF = async (file: File) => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!apiKey) {
      alert('Missing Gemini API key. Add VITE_GEMINI_API_KEY to .env.local.');
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
          alert(`AI extraction failed, but fallback parser found ${fallbackQuestions.length} question(s). Please review carefully.`);
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
              alert(`AI PDF parser failed, but OCR/vision fallback found ${imageQuestions.length} question(s). Please review carefully.`);
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
      alert(err?.message || "AI reading failed. Check your API key and file.");
      setImportStatus('idle');
    }
  };

  const processCSV = async (file: File) => {
    setImportStatus('parsing');
    try {
      const text = await file.text();
      const rows = parseCsvRows(text);
      if (rows.length === 0) throw new Error('CSV has no valid data rows.');

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
          status: (row.status || 'approved').trim().toLowerCase() === 'draft' ? 'draft' : 'approved',
          isActive: toBoolean(row.isactive || 'true', true),
          selected: true
        });
      });

      if (mapped.length === 0) {
        throw new Error(errors[0] || 'No valid rows were found in CSV.');
      }
      if (errors.length > 0) {
        alert(`Imported with ${errors.length} skipped row(s). First issue: ${errors[0]}`);
      }

      setStagedQuestions(mapped);
      setImportStatus('review');
    } catch (err: any) {
      alert(err?.message || 'CSV import failed.');
      setImportStatus('idle');
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const data = {
      subject: qSubject || 'General',
      topic: qTopic || 'General',
      text: qText.trim(),
      options: normalizeOptions(qOptions),
      correctAnswerIndex: qCorrect,
      explanation: qExplanation.trim(),
      difficulty: qDifficulty,
      tags: parseList(qTags),
      status: 'approved' as const,
      isActive: qIsActive,
      normalizedText: normalizeText(qText)
    };
    try {
      const duplicateId = await findDuplicateQuestion(data.text, editingId || undefined);
      if (duplicateId) {
        alert('This question already exists.');
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
            alert(`Question updated. ${updatedCount} result(s) were recalculated.`);
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
      alert("Could not save to database. " + (e?.message || ""));
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
    setQDifficulty(DEFAULT_DIFFICULTY);
    setQTags('');
    setQIsActive(true);
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testName) return alert("Test name is required.");
    if (testGenerationMode === 'fixed' && sections.some(s => s.questionIds.length === 0)) {
      return alert("One or more sections are empty.");
    }
    if (testGenerationMode === 'dynamic' && sections.some(s => Number(s.questionCount || 0) <= 0)) {
      return alert("Each dynamic section must have a question count greater than zero.");
    }
    if (!allowRetake && maxAttempts !== '' && Number(maxAttempts) > 1) {
      return alert("Retake is off, so max attempts must be 1.");
    }
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'tests'), {
        name: testName,
        description: testDesc,
        totalDurationSeconds: testDuration * 60,
        sections,
        generationMode: testGenerationMode,
        allowRetake,
        maxAttempts: allowRetake ? (maxAttempts === '' ? null : Number(maxAttempts)) : 1,
        createdBy: user.id,
        creatorName: user.name,
        isApproved: true,
        createdAt: new Date().toISOString()
      });
      alert("Test published.");
      setActiveTab('tests');
    } catch (e: any) { alert("Error creating test. " + (e?.message || "")); }
    finally { setLoading(false); }
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
    setQDifficulty((q.difficulty as DifficultyLevel) || DEFAULT_DIFFICULTY);
    setQTags((q.tags || []).join(', '));
    setQIsActive(q.isActive !== false);
    setIsQuestionModalOpen(true);
  };

  const toggleSubjectCollapse = (subject: string) => {
    setCollapsedSubjects(prev => ({ ...prev, [subject]: !prev[subject] }));
  };

  const commitImportedQuestions = async () => {
    setLoading(true);
    try {
      const selected = stagedQuestions.filter(q => q.selected);
      if (selected.length === 0) {
        alert('Select at least one question to import.');
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
        alert('All selected questions are already in the bank.');
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
          status: persistable.status || 'approved',
          isActive: persistable.isActive !== false,
          normalizedText: normalizeText(persistable.text),
          createdBy: user.id,
          createdAt: new Date().toISOString()
        });
      });
      await batch.commit();

      const skipped = uniqueSelected.length - finalList.length;
      if (skipped > 0) {
        alert(`Bank updated. Skipped ${skipped} duplicate(s).`);
      } else {
        alert('Bank updated successfully.');
      }

      setImportStatus('idle');
      setStagedQuestions([]);
    } catch (e: any) {
      alert('Import failed. ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const startEditTest = (test: MockTest) => {
    setEditingTestId(test.id);
    setEditTestName(test.name || '');
    setEditTestDesc(test.description || '');
    setEditTestDuration(Math.max(1, Math.floor((test.totalDurationSeconds || 3600) / 60)));
  };

  const cancelEditTest = () => {
    setEditingTestId(null);
    setEditTestName('');
    setEditTestDesc('');
    setEditTestDuration(60);
  };

  const saveEditedTest = async (testId: string) => {
    try {
      await updateDoc(doc(db, 'tests', testId), {
        name: editTestName.trim(),
        description: editTestDesc.trim(),
        totalDurationSeconds: Math.max(1, editTestDuration) * 60,
        updatedAt: new Date().toISOString()
      });
      await loadManagedTests();
      cancelEditTest();
    } catch (err: any) {
      alert('Failed to update test. ' + (err?.message || ''));
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
      alert('Failed to update test status. ' + (err?.message || ''));
    }
  };

  const removeTest = async (test: MockTest) => {
    if (!window.confirm(`Delete test "${test.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'tests', test.id));
      setManagedTests(prev => prev.filter(item => item.id !== test.id));
    } catch (err: any) {
      alert('Failed to delete test. ' + (err?.message || ''));
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
      alert('Test link copied.');
    } catch {
      alert('Could not copy link. Link: ' + link);
    }
  };

  const saveGeneratedKeyDocs = async (codes: string[], durationDays: number) => {
    const nowIso = new Date().toISOString();
    const batch = writeBatch(db);
    const normalizedDays = Math.max(1, Math.floor(durationDays || 365));
    codes.forEach((code) => {
      const ref = doc(db, 'licenseKeys', code);
      batch.set(ref, {
        code,
        status: 'new',
        isUsed: false,
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
      await saveGeneratedKeyDocs([code], singleKeyDurationDays);
      setGeneratedKeys([code]);
      alert('Single activation key generated.');
    } catch (err: any) {
      alert('Failed to generate key. ' + (err?.message || ''));
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
      await saveGeneratedKeyDocs(codes, bulkKeyDurationDays);
      setGeneratedKeys(codes);
      alert(`Generated ${codes.length} activation keys.`);
    } catch (err: any) {
      alert('Bulk generation failed. ' + (err?.message || ''));
    } finally {
      setKeyToolLoading(false);
    }
  };

  const copyGeneratedKeys = async () => {
    if (generatedKeys.length === 0) return;
    const text = generatedKeys.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert('Generated keys copied.');
    } catch {
      alert('Could not copy keys. Please copy manually from the list.');
    }
  };

  const handleSaveDeadline = async () => {
    if (!canManageKeys) return;
    const iso = watInputToIso(deadlineInput);
    if (!iso) {
      alert('Invalid deadline value. Use a valid date and time.');
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
      alert('Deadline updated successfully.');
    } catch (err: any) {
      alert('Failed to update deadline. ' + (err?.message || ''));
    } finally {
      setDeadlineSaving(false);
    }
  };

  return (
    <div className="flex-1 w-full bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 p-6 flex justify-between items-center shrink-0 safe-top shadow-sm z-10">
        <div className="flex items-center gap-4">
          <img src={logo} className="w-10 h-10" alt="Logo" />
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">Admin Panel</h1>
            <div className="flex items-center gap-2 mt-1">
               <span className={`w-2 h-2 rounded-full ${dbError ? 'bg-red-500' : 'bg-emerald-500'} animate-pulse`}></span>
               <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{dbError || 'Connected'}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onSwitchToStudent} className="px-5 py-2 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 uppercase tracking-widest">Student View</button>
          <button onClick={onLogout} className="px-5 py-2 text-[10px] font-bold text-red-600 border border-red-50 rounded-xl hover:bg-red-50 uppercase tracking-widest">Logout</button>
        </div>
      </div>

      <nav className="flex bg-white px-6 border-b border-slate-100 shrink-0">
        <button onClick={() => setActiveTab('analytics')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'analytics' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Analytics</button>
        <button onClick={() => setActiveTab('questions')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'questions' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Question Bank</button>
        <button onClick={() => setActiveTab('create-test')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'create-test' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Create Test</button>
        <button onClick={() => setActiveTab('tests')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'tests' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Tests</button>
        <button onClick={() => setActiveTab('import')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'import' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>Import</button>
        {canManageKeys && (
          <button onClick={() => setActiveTab('license-keys')} className={`px-8 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'license-keys' ? 'border-b-4 border-amber-500 text-slate-950 bg-slate-50' : 'text-slate-400'}`}>License Keys</button>
        )}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar safe-bottom">
        {dbError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 font-bold text-[10px] uppercase tracking-widest">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            {dbError}
          </div>
        )}

        {activeTab === 'analytics' && <AdminAnalytics />}

        {activeTab === 'questions' && (
          <div className="space-y-6">
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
                className="px-6 py-5 bg-slate-950 text-amber-500 rounded-2xl text-[9px] font-bold uppercase tracking-widest hover:bg-slate-900 transition-all"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={openNewQuestionModal}
                className="px-6 py-5 bg-amber-500 text-slate-950 rounded-2xl text-[9px] font-bold uppercase tracking-widest hover:bg-amber-600 transition-all"
              >
                Add Question
              </button>
              <button onClick={runBankCleanup} className="px-6 py-5 bg-white border border-red-100 text-red-500 rounded-2xl text-[9px] font-bold uppercase tracking-widest hover:bg-red-50 transition-all flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                Clean Bank
              </button>
              <button
                onClick={recalculateAllScores}
                disabled={loading}
                className="px-6 py-5 bg-white border border-amber-200 text-amber-700 rounded-2xl text-[9px] font-bold uppercase tracking-widest hover:bg-amber-50 transition-all disabled:opacity-50"
              >
                {loading ? 'Working...' : 'Recalculate Scores'}
              </button>
            </div>

            {!hasSearched && (
              <div className="bg-white p-16 rounded-[2rem] border border-dashed text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.2em]">
                Search to load questions
              </div>
            )}

            {hasSearched && questions.length === 0 && !isSearching && (
              <div className="bg-white p-16 rounded-[2rem] border border-dashed text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.2em]">
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
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{list.length} item(s)</span>
                      </div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{isCollapsed ? 'Expand' : 'Collapse'}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="px-6 pb-6 space-y-3">
                        {list.map(q => (
                          <div key={q.id} className="bg-slate-50 p-5 rounded-2xl border border-slate-100 flex justify-between items-start gap-6">
                            <div className="flex-1">
                              <p className="text-[9px] font-bold text-amber-600 mb-2 uppercase tracking-widest">{q.topic || 'General'}</p>
                              <p className="text-sm font-bold text-slate-800"><ScientificText text={q.text} /></p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => openEditModal(q)} className="p-3 bg-white rounded-xl border border-slate-100 hover:bg-slate-100"><svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>
                              <button onClick={async () => { if(window.confirm('Delete this question?')) { await deleteDoc(doc(db, 'questions', q.id)); setQuestions(prev => prev.filter(item => item.id !== q.id)); } }} className="p-3 bg-red-50 rounded-xl hover:bg-red-100"><svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
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
                <textarea placeholder="Instructions shown to students" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-20" value={testDesc} onChange={e => setTestDesc(e.target.value)} />
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                   <span className="text-[10px] font-bold uppercase text-slate-400">Time (mins)</span>
                   <input type="number" className="bg-transparent font-bold w-full text-center text-xl outline-none" value={testDuration} onChange={e => setTestDuration(parseInt(e.target.value) || 0)} />
                </div>
                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Build Mode</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTestGenerationMode('fixed')}
                      className={`px-4 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest ${testGenerationMode === 'fixed' ? 'bg-slate-950 text-amber-500' : 'bg-slate-200 text-slate-600'}`}
                    >
                      Fixed
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestGenerationMode('dynamic')}
                      className={`px-4 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest ${testGenerationMode === 'dynamic' ? 'bg-slate-950 text-amber-500' : 'bg-slate-200 text-slate-600'}`}
                    >
                      Dynamic
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Allow Retake</span>
                  <button
                    type="button"
                    onClick={() => setAllowRetake(!allowRetake)}
                    className={`px-4 py-2 rounded-xl text-[9px] font-bold uppercase tracking-widest ${allowRetake ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}
                  >
                    {allowRetake ? 'Yes' : 'No'}
                  </button>
                </div>

                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Max Attempts</span>
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
                
                <div className="space-y-3">
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sections</p>
                   {sections.map((s, idx) => (
                     <button key={s.id} onClick={() => setActiveBuilderSection(idx)} className={`w-full p-4 rounded-2xl border-2 text-left flex justify-between items-center transition-all ${activeBuilderSection === idx ? 'border-amber-500 bg-amber-50' : 'border-slate-50 bg-white'}`}>
                        <div>
                          <input 
                            className="text-[10px] font-bold text-slate-900 bg-transparent outline-none uppercase" 
                            value={s.name} 
                            onChange={(e) => {
                              const newSections = [...sections];
                              newSections[idx].name = e.target.value;
                              setSections(newSections);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <p className="text-[9px] text-slate-400 mt-1">
                            {testGenerationMode === 'fixed' ? `${s.questionIds.length} question(s)` : `${s.questionCount || 0} generated question(s)`}
                          </p>
                        </div>
                        {activeBuilderSection === idx && <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>}
                     </button>
                   ))}
                   <button onClick={addSection} className="w-full p-3 border-2 border-dashed border-slate-100 rounded-2xl text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:border-amber-200 transition-all">+ New Section</button>
                </div>

                <button onClick={handleCreateTest} className="w-full py-5 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">Publish Test</button>
              </div>
            </div>
            
            <div className="xl:col-span-2 space-y-6 flex flex-col h-[700px]">
               <div className="bg-slate-900 text-white p-6 rounded-[2rem] flex justify-between items-center shadow-lg">
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-widest text-amber-500">Selecting for: {sections[activeBuilderSection].name}</h4>
                  <p className="text-[9px] text-slate-400 mt-1">
                    {testGenerationMode === 'fixed' ? 'Tap a question to add/remove from this section' : 'Define a sample space and count for this section'}
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
                        className="px-4 py-3 bg-amber-500 text-slate-950 rounded-xl text-[9px] font-bold uppercase tracking-widest hover:bg-amber-400 transition-all"
                      >
                        {isSearching ? 'Searching...' : 'Search'}
                      </button>
                    </div>
                  )}
               </div>

               {testGenerationMode === 'fixed' ? (
                 <div className="flex-1 overflow-y-auto pr-2 space-y-3 no-scrollbar pb-10">
                    {questions.length === 0 && (
                      <div className="bg-white p-16 rounded-[2rem] border border-dashed text-center text-slate-300 font-bold uppercase text-[10px] tracking-[0.2em]">
                        Search the bank to load questions
                      </div>
                    )}
                    {builderQuestions.map(q => {
                      const isSelected = sections[activeBuilderSection].questionIds.includes(q.id);
                      return (
                        <div key={q.id} onClick={() => toggleQuestionInActiveSection(q.id)} className={`p-5 border-2 rounded-2xl cursor-pointer transition-all flex justify-between items-center gap-6 shadow-sm ${isSelected ? 'border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-500/10' : 'border-white bg-white hover:border-slate-200'}`}>
                           <div className="flex-1">
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">{q.subject}</p>
                              <p className="text-sm font-bold text-slate-800 leading-relaxed"><ScientificText text={q.text} /></p>
                           </div>
                           <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 shrink-0 ${isSelected ? 'bg-amber-500 border-amber-500 text-slate-950 shadow-sm' : 'border-slate-100 text-transparent'}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg></div>
                        </div>
                      );
                    })}
                 </div>
               ) : (
                 <div className="flex-1 overflow-y-auto pr-2 no-scrollbar pb-10">
                   <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <label className="text-[10px] font-bold uppercase text-slate-400">
                         Question Count
                         <input
                           type="number"
                           min={1}
                           value={sections[activeBuilderSection].questionCount || 20}
                           onChange={(e) => updateActiveSection(s => ({ ...s, questionCount: Math.max(1, Number(e.target.value) || 1) }))}
                           className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs font-bold"
                         />
                       </label>
                       <label className="text-[10px] font-bold uppercase text-slate-400">
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
                     <label className="text-[10px] font-bold uppercase text-slate-400 block">
                       Subjects (comma-separated)
                       <input
                         value={(sections[activeBuilderSection].sampleFilters?.subjects || []).join(', ')}
                         onChange={(e) => updateActiveSection(s => ({ ...s, sampleFilters: { ...(s.sampleFilters || {}), subjects: parseList(e.target.value) } }))}
                         className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs"
                         placeholder="Anatomy, Physiology"
                       />
                     </label>
                     <label className="text-[10px] font-bold uppercase text-slate-400 block">
                       Topics (comma-separated)
                       <input
                         value={(sections[activeBuilderSection].sampleFilters?.topics || []).join(', ')}
                         onChange={(e) => updateActiveSection(s => ({ ...s, sampleFilters: { ...(s.sampleFilters || {}), topics: parseList(e.target.value) } }))}
                         className="w-full mt-2 p-3 bg-slate-50 border rounded-xl text-xs"
                         placeholder="Cell Biology, Cardiology"
                       />
                     </label>
                     <label className="text-[10px] font-bold uppercase text-slate-400 block">
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
                             className={`p-3 rounded-xl border text-[10px] font-bold uppercase ${checked ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
                           >
                             {d}
                           </button>
                         );
                       })}
                     </div>
                     <div className="grid grid-cols-3 gap-3">
                       {(['easy', 'medium', 'hard'] as DifficultyLevel[]).map((d) => (
                         <label key={d} className="text-[10px] font-bold uppercase text-slate-400">
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
               )}
            </div>
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Manage Tests</h3>
              <button onClick={loadManagedTests} className="px-5 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50">
                Refresh
              </button>
            </div>

            {managedTestsLoading && (
              <div className="bg-white p-12 rounded-[2rem] border border-slate-100 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                Loading tests...
              </div>
            )}

            {!managedTestsLoading && managedTests.length === 0 && (
              <div className="bg-white p-12 rounded-[2rem] border border-dashed text-center text-slate-300 text-[10px] font-bold uppercase tracking-widest">
                No tests found
              </div>
            )}

            <div className="space-y-4">
              {managedTests.map(test => {
                const isPaused = Boolean((test as any).isPaused);
                const isEditing = editingTestId === test.id;
                return (
                  <div key={test.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                    {!isEditing ? (
                      <div className="space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div>
                            <h4 className="text-base font-bold text-slate-900 uppercase">{test.name}</h4>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                              {Math.round((test.totalDurationSeconds || 0) / 60)} mins - {test.sections?.length || 0} section(s)
                            </p>
                          </div>
                          <span className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest ${isPaused ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {isPaused ? 'Paused' : 'Live'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">{test.description || 'No instructions set.'}</p>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => copyTestLink(test)} className="px-5 py-2 bg-emerald-50 rounded-xl text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:bg-emerald-100">Copy Link</button>
                          <button onClick={() => startEditTest(test)} className="px-5 py-2 bg-slate-100 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-700 hover:bg-slate-200">Edit</button>
                          <button onClick={() => togglePauseTest(test)} className="px-5 py-2 bg-amber-100 rounded-xl text-[10px] font-bold uppercase tracking-widest text-amber-700 hover:bg-amber-200">{isPaused ? 'Resume' : 'Pause'}</button>
                          <button onClick={() => removeTest(test)} className="px-5 py-2 bg-red-50 rounded-xl text-[10px] font-bold uppercase tracking-widest text-red-600 hover:bg-red-100">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <input value={editTestName} onChange={(e) => setEditTestName(e.target.value)} className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold" placeholder="Test name" />
                        <textarea value={editTestDesc} onChange={(e) => setEditTestDesc(e.target.value)} className="w-full p-4 bg-slate-50 border rounded-2xl text-xs h-24" placeholder="Instructions" />
                        <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                          <span className="text-[10px] font-bold uppercase text-slate-400">Time (mins)</span>
                          <input type="number" min={1} value={editTestDuration} onChange={(e) => setEditTestDuration(parseInt(e.target.value) || 1)} className="bg-transparent font-bold w-full text-center text-xl outline-none" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => saveEditedTest(test.id)} className="px-6 py-3 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-bold uppercase tracking-widest">Save</button>
                          <button onClick={cancelEditTest} className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl text-[10px] font-bold uppercase tracking-widest">Cancel</button>
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
                      <p className="text-[10px] text-slate-400 font-medium">AI extract questions and review before publish.</p>
                    </button>
                    <button onClick={() => csvInputRef.current?.click()} className="bg-white p-8 rounded-[2rem] border-2 border-dashed border-slate-100 hover:border-emerald-400 transition-all shadow-sm group text-left">
                      <h3 className="text-sm font-bold mb-2 uppercase text-slate-900">Import From CSV</h3>
                      <p className="text-[10px] text-slate-400 font-medium">Fast bulk upload with row validation and dedupe.</p>
                    </button>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-100 text-left">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">CSV Headers</p>
                    <code className="text-[10px] text-slate-700 break-words">
                      subject,topic,text,optionA,optionB,optionC,optionD,correctAnswer,explanation,difficulty,tags,source,year,examType,status,isActive
                    </code>
                  </div>
                </div>
              ) : importStatus === 'parsing' ? (
                <div className="py-20 flex flex-col items-center">
                  <div className="w-72 h-2 bg-slate-100 rounded-full overflow-hidden mb-6">
                    <div className="h-full bg-amber-500 animate-pulse w-1/2"></div>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">Processing file...</p>
                </div>
              ) : (
                <div className="space-y-6 text-left animate-in slide-in-from-bottom-10">
                  <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between bg-slate-950 p-6 rounded-3xl text-white shadow-2xl">
                    <div>
                      <p className="text-sm font-bold uppercase text-amber-500">{stagedQuestions.filter(q => q.selected).length} Selected</p>
                      <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">Review and edit before adding</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={commitImportedQuestions} className="px-6 py-3 bg-amber-500 text-slate-950 rounded-xl font-bold uppercase text-[10px] hover:bg-amber-600">Add to Bank</button>
                      <button onClick={() => setImportStatus('idle')} className="px-6 py-3 bg-slate-800 text-white rounded-xl font-bold uppercase text-[10px]">Cancel</button>
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
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Include</span>
                          </div>
                          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-widest">{q.subject || 'General'}</span>
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
                        <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-slate-500">
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

        {activeTab === 'license-keys' && canManageKeys && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Activation Key Generator</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Root admin only. Generated keys are stored in <code>licenseKeys</code>.
              </p>
            </div>

            <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Free Access Deadline (WAT)</h4>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
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
                  className="px-6 py-4 bg-slate-950 text-amber-500 rounded-2xl text-[10px] font-bold uppercase tracking-widest disabled:opacity-40"
                >
                  {deadlineSaving ? 'Saving...' : 'Save Deadline'}
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                Default reference: April 2, 2026 at 00:00 WAT.
              </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Single Key</h4>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Duration (days)</span>
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
                  className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest disabled:opacity-40"
                >
                  {keyToolLoading ? 'Working...' : 'Generate One Key'}
                </button>
              </div>

              <div className="bg-white border border-slate-100 rounded-[2rem] p-8 shadow-sm space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Bulk Keys</h4>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold uppercase text-slate-400">How Many</span>
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
                  <span className="text-[10px] font-bold uppercase text-slate-400">Duration (days)</span>
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
                  className="w-full py-4 bg-amber-500 text-slate-950 rounded-2xl font-bold uppercase text-[10px] tracking-widest disabled:opacity-40"
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
                  className="px-5 py-2 bg-slate-950 text-amber-500 rounded-xl text-[10px] font-bold uppercase tracking-widest disabled:opacity-30"
                >
                  Copy All
                </button>
              </div>
              {generatedKeys.length === 0 ? (
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">No new keys generated this session.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto no-scrollbar space-y-2">
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
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm safe-top safe-bottom">
          <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100">
            <div className="bg-slate-950 px-6 py-5 text-white flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest">{editingId ? 'Edit Question' : 'Add Question'}</h3>
              <button onClick={() => { setIsQuestionModalOpen(false); resetForm(); }} className="text-slate-300 hover:text-white">Close</button>
            </div>
            <form onSubmit={handleSaveQuestion} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input placeholder="Subject" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold outline-none" value={qSubject} onChange={e => setQSubject(e.target.value)} required />
                <input placeholder="Topic" className="w-full p-4 bg-slate-50 border rounded-2xl text-xs font-bold outline-none" value={qTopic} onChange={e => setQTopic(e.target.value)} />
              </div>
              <textarea placeholder="Question text" className="w-full p-5 bg-slate-50 border rounded-2xl text-sm h-32 outline-none" value={qText} onChange={e => setQText(e.target.value)} required />
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
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-slate-500">
                <input type="checkbox" checked={qIsActive} onChange={(e) => setQIsActive(e.target.checked)} className="accent-amber-500" />
                Active
              </label>
              <button disabled={loading} className="w-full py-4 bg-slate-950 text-amber-500 rounded-2xl font-bold uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all">{editingId ? 'Save Changes' : 'Add Question'}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;

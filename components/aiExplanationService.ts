import { GoogleGenAI } from '@google/genai';
import { Question } from '../types';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const COLLECTION_NAME = 'aiQuestionExplanations';
const MODEL_NAME = 'gemini-2.0-flash';

const memoryCache: Record<string, string> = {};

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const getQuestionSignature = (question: Question) => {
  const optionsSig = (question.options || []).map(opt => normalize(opt)).join('|');
  return `${normalize(question.text || '')}::${optionsSig}::${Number(question.correctAnswerIndex ?? -1)}`;
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
};

const getCacheKey = (question: Question, signature: string) => {
  return `${question.id}__${hashString(signature)}`;
};

const buildPrompt = (question: Question) => {
  const options = (question.options || []).map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join('\n');
  const correctLetter = String.fromCharCode(65 + Number(question.correctAnswerIndex || 0));
  return `
You are explaining a CBT multiple-choice question.
Give a concise, student-friendly explanation.

Question:
${question.text}

Options:
${options}

Correct answer: ${correctLetter}

Existing explanation (if any):
${question.explanation || 'None'}

Requirements:
- Explain why the correct option is correct.
- Briefly explain why each incorrect option is wrong.
- Keep it clear and practical for revision.
- Do not include markdown headings.
`.trim();
};

const getApiKey = () => {
  return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() || '';
};

export const getOrCreateAiExplanation = async (question: Question): Promise<string> => {
  if (!question?.id) {
    throw new Error('Question id is required for AI explanation.');
  }

  const signature = getQuestionSignature(question);
  const cacheKey = getCacheKey(question, signature);
  const inMemory = memoryCache[cacheKey];
  if (inMemory) return inMemory;

  const ref = doc(db, COLLECTION_NAME, cacheKey);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      const cachedText = String(data?.explanation || '').trim();
      const cachedSignature = String(data?.questionSignature || '').trim();
      if (cachedText && cachedSignature === signature) {
        memoryCache[cacheKey] = cachedText;
        return cachedText;
      }
    }
  } catch {
    // Continue with generation path even if read is blocked.
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Missing Gemini API key. Add VITE_GEMINI_API_KEY to .env.local.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: buildPrompt(question)
  });
  const generated = String(response.text || '').trim();
  if (!generated) {
    throw new Error('Gemini did not return an explanation.');
  }

  memoryCache[cacheKey] = generated;

  try {
    await setDoc(ref, {
      cacheKey,
      questionId: question.id,
      questionSignature: signature,
      explanation: generated,
      model: MODEL_NAME,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch {
    // If write is blocked, still return generated content for this user.
  }

  return generated;
};

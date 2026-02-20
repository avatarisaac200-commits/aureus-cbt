
export type UserRole = 'student' | 'admin' | 'root-admin';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'draft' | 'approved';
export type TestGenerationMode = 'fixed' | 'dynamic';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  title?: string;
  emailVerified?: boolean;
  subscriptionStatus?: 'inactive' | 'active' | 'expired' | 'pending';
  subscriptionEndsAt?: string;
}

export interface Question {
  id: string;
  subject: string;
  topic: string;
  text: string;
  options: string[];
  correctAnswerIndex: number;
  explanation?: string;
  normalizedText?: string;
  difficulty?: DifficultyLevel;
  tags?: string[];
  source?: string;
  year?: number | null;
  examType?: string;
  status?: QuestionStatus;
  isActive?: boolean;
  createdBy: string;
  createdAt: string;
}

export interface SectionSampleFilters {
  subjects?: string[];
  topics?: string[];
  difficulties?: DifficultyLevel[];
  tags?: string[];
}

export interface SectionDifficultyMix {
  easy?: number;
  medium?: number;
  hard?: number;
}

export interface TestSection {
  id: string;
  name: string;
  questionIds: string[];
  marksPerQuestion: number;
  questionCount?: number;
  sampleFilters?: SectionSampleFilters;
  difficultyMix?: SectionDifficultyMix;
}

export interface MockTest {
  id: string;
  name: string;
  description: string;
  sections: TestSection[];
  generationMode?: TestGenerationMode;
  totalDurationSeconds: number;
  allowRetake: boolean;
  maxAttempts?: number | null;
  createdBy: string;
  creatorName: string;
  isApproved: boolean;
  createdAt: string;
}

export interface ExamResult {
  id: string;
  userId: string;
  userName: string;
  testId: string;
  testName: string;
  score: number;
  maxScore: number;
  completedAt: string;
  status: 'completed' | 'abandoned' | 'auto-submitted';
  userAnswers: Record<string, number>;
  resolvedSections?: TestSection[];
  attemptId?: string;
  sectionBreakdown: {
    sectionName: string;
    score: number;
    total: number;
  }[];
}

export interface TestAttempt {
  id: string;
  testId: string;
  userId: string;
  userName: string;
  createdAt: string;
  seed: number;
  sections: TestSection[];
  questionIds: string[];
}

export type ViewState = 'auth' | 'verify-email' | 'dashboard' | 'exam' | 'admin' | 'root-admin' | 'results' | 'review';

export type UserRole = 'student' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
}

export interface Question {
  id: string;
  subject: string;
  topic: string;
  text: string;
  options: string[];
  correctAnswerIndex: number;
  explanation?: string;
  createdBy: string;
  createdAt: string;
}

export interface TestSection {
  id: string;
  name: string;
  questionIds: string[];
  marksPerQuestion: number;
}

export interface MockTest {
  id: string;
  name: string;
  description: string;
  sections: TestSection[];
  totalDurationSeconds: number;
  allowRetake: boolean;
  createdBy: string;
  creatorName: string;
  isApproved: boolean;
  createdAt: string;
}

export interface ExamResult {
  id: string;
  userId: string;
  testId: string;
  testName: string;
  score: number;
  maxScore: number;
  completedAt: string;
  status: 'completed' | 'abandoned' | 'auto-submitted';
  userAnswers: Record<string, number>;
  sectionBreakdown: {
    sectionName: string;
    score: number;
    total: number;
  }[];
}

export type ViewState = 'auth' | 'dashboard' | 'exam' | 'admin' | 'results' | 'review';
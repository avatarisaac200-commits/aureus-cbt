
export type UserRole = 'student' | 'admin' | 'root-admin';
export type PrepMode = 'utme' | 'oau' | 'putme';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'draft' | 'approved';
export type TestGenerationMode = 'fixed' | 'dynamic' | 'csv-dynamic';
export type CsvBundleCategoryField = 'subject' | 'topic' | 'difficulty' | 'examType';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  title?: string;
  avatarUrl?: string;
  bio?: string;
  institution?: string;
  yearOfStudy?: string;
  studyInterests?: string[];
  socialOnboardingCompletedAt?: string;
  emailVerified?: boolean;
  lastPrepMode?: PrepMode;
  licenses?: Partial<Record<PrepMode, {
    status: 'inactive' | 'active' | 'expired' | 'pending';
    activatedAt?: string;
    endsAt?: string;
    key?: string;
  }>>;
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
  prepMode?: PrepMode;
  imageUrl?: string;
  imageKey?: string;
  imageAlt?: string;
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

export interface CsvQuestionBundle {
  id: string;
  name: string;
  category: string;
  categoryField: CsvBundleCategoryField;
  questionIds: string[];
  questionCount: number;
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
  accessPassword?: string;
  prepMode?: PrepMode;
  isArchived?: boolean;
  createdBy: string;
  creatorName: string;
  isApproved: boolean;
  createdAt: string;
  csvBundlesEnabled?: boolean;
  csvBundleSize?: number;
  csvBundleCategoryField?: CsvBundleCategoryField;
  csvBundles?: CsvQuestionBundle[];
}

export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  correctAnswerIndex: number;
  explanation?: string;
}

export interface SharedQuiz {
  id: string;
  name: string;
  description?: string;
  totalDurationSeconds: number;
  allowRetake: boolean;
  maxAttempts?: number | null;
  isActive: boolean;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  questions: QuizQuestion[];
}

export interface ExamResult {
  id: string;
  userId: string;
  userName: string;
  testId: string;
  testName: string;
  prepMode?: PrepMode;
  score: number;
  maxScore: number;
  correctAnsweredCount?: number;
  answeredQuestionCount?: number;
  totalQuestionCount?: number;
  completedAt: string;
  status: 'completed' | 'abandoned' | 'auto-submitted';
  userAnswers: Record<string, number>;
  resolvedSections?: TestSection[];
  attemptSections?: TestSection[];
  attemptQuestionIds?: string[];
  questionSnapshot?: Record<string, Question>;
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

export interface QuestionTagInsight {
  id: string;
  questionId: string;
  testId: string;
  testName: string;
  resultId: string;
  userId: string;
  userName: string;
  note?: string;
  createdAt: string;
  status: 'new' | 'reviewed';
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface BroadcastNotification {
  id: string;
  type: 'new-test';
  title: string;
  message: string;
  testId: string;
  testName: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export type NotificationType =
  | 'announcement_posted'
  | 'session_reminder'
  | 'schedule_updated'
  | 'grade_released'
  | 'deadline_approaching'
  | 'new_message';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  notificationType: NotificationType;
  inApp: boolean;
  push: boolean;
  email: boolean;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export type AnnouncementAudience = 'all' | 'group' | 'individual';

export interface Announcement {
  id: string;
  classId: string;
  classTitle: string;
  authorId: string;
  authorName: string;
  title: string;
  body: string;
  bodyPreview?: string;
  targetAudience: AnnouncementAudience;
  targetIds?: string[];
  isPinned: boolean;
  attachments?: string[];
  scheduledAt?: string;
  published: boolean;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
}

export interface AnnouncementRead {
  id: string;
  announcementId: string;
  userId: string;
  readAt: string;
}

export type SessionRecurrence = 'none' | 'weekly' | 'custom';

export interface ClassSession {
  id: string;
  classId: string;
  classTitle: string;
  teacherId: string;
  teacherName: string;
  title: string;
  description?: string;
  location?: string;
  lessonPlan?: string;
  startTime: string;
  endTime: string;
  recurrence: SessionRecurrence;
  recurrenceDays?: number[];
  recurrenceEndDate?: string;
  color?: string;
  isCancelled?: boolean;
  cancelledOccurrences?: string[];
  reminderSentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ForumChannel = 'general' | 'questions' | 'resources' | 'wins';

export interface ForumThread {
  id: string;
  channel: ForumChannel;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  authorTitle?: string;
  authorAvatarUrl?: string;
  createdAt: string;
  latestActivityAt: string;
  replyCount: number;
  lastReplyByName?: string;
  lastReplyPreview?: string;
}

export interface ForumReply {
  id: string;
  threadId: string;
  body: string;
  authorId: string;
  authorName: string;
  authorTitle?: string;
  authorAvatarUrl?: string;
  createdAt: string;
}

export interface DirectConversation {
  id: string;
  participantIds: string[];
  participantNames: string[];
  participantTitles?: string[];
  participantAvatarUrls?: string[];
  participantProfileIds?: string[];
  friendshipId?: string;
  createdAt: string;
  updatedAt: string;
  lastMessageText?: string;
  lastMessageAt?: string;
  lastMessageSenderId?: string;
  lastReadAtBy?: Record<string, string>;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface CommunityProfile {
  id: string;
  userId: string;
  displayName: string;
  title?: string;
  avatarUrl?: string;
  bio?: string;
  institution?: string;
  yearOfStudy?: string;
  studyInterests?: string[];
  discoverable: boolean;
  onboardingCompletedAt?: string;
  lookingForFriends?: boolean;
  lastActiveAt?: string;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface FriendRequest {
  id: string;
  senderId: string;
  senderName: string;
  senderTitle?: string;
  senderAvatarUrl?: string;
  senderProfileId?: string;
  recipientId: string;
  recipientName: string;
  recipientTitle?: string;
  recipientAvatarUrl?: string;
  recipientProfileId?: string;
  note?: string;
  status: FriendRequestStatus;
  createdAt: string;
  updatedAt: string;
  respondedAt?: string;
}

export interface Friendship {
  id: string;
  memberIds: string[];
  memberNames: string[];
  memberTitles?: string[];
  memberAvatarUrls?: string[];
  memberProfileIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export type CourseFileVersion = 'html-v1' | 'cbtcourse-v1';

export interface Course {
  id: string;
  title: string;
  description?: string;
  version: CourseFileVersion;
  fileName: string;
  fileExtension: string;
  contentHtml: string;
  tags?: string[];
  estimatedDurationMinutes: number;
  isPublished: boolean;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  enrollmentCount?: number;
  sessionCount?: number;
  completionRate?: number;
  averageProgressPercent?: number;
  averageElapsedSeconds?: number;
  analyticsUpdatedAt?: string;
}

export interface CourseSession {
  id: string;
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  elapsedSeconds: number;
  completedSections: number;
  totalSections: number;
  progressPercent: number;
  status: 'completed' | 'timed-out' | 'abandoned';
}

export type VideoLessonVisibility = 'draft' | 'published';

export interface VideoLesson {
  id: string;
  title: string;
  description: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  course: string;
  category: string;
  thumbnail: string;
  duration: number;
  order: number;
  tags: string[];
  visibility: VideoLessonVisibility;
  isPublished: boolean;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  viewCount?: number;
  completedCount?: number;
  totalWatchSeconds?: number;
}

export interface VideoProgress {
  id: string;
  userId: string;
  userName: string;
  lessonId: string;
  course: string;
  lastPositionSeconds: number;
  durationSeconds: number;
  progressPercent: number;
  completed: boolean;
  bookmarked: boolean;
  firstWatchedAt: string;
  lastWatchedAt: string;
}

export interface CustomThemeConfig {
  bgStart: string;
  bgEnd: string;
  shellStart: string;
  shellMid: string;
  shellEnd: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  card: string;
  border: string;
}

export type ViewState = 'auth' | 'verify-email' | 'prep-selector' | 'dashboard' | 'courses' | 'videos' | 'attendance' | 'blacklist' | 'exam' | 'admin' | 'root-admin' | 'results' | 'review' | 'update-manual';

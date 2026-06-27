import { PrepMode, User } from '../types';

export const PREP_MODES: PrepMode[] = ['utme', 'oau', 'putme'];

export const DEFAULT_PREP_MODE: PrepMode = 'oau';

export const PREP_MODE_LABELS: Record<PrepMode, string> = {
  utme: 'UTME Prep',
  oau: 'OAU Prep',
  putme: 'OAU P-UTME Prep'
};

export const PREP_MODE_DESCRIPTIONS: Record<PrepMode, string> = {
  utme: 'Practice for JAMB UTME with focused subject tests and exam-style drills.',
  oau: 'Use the original OAU past-question and CBT practice experience.',
  putme: 'Prepare for OAU post-UTME with tailored practice and review.'
};

export const PREP_MODE_FEATURES: Record<PrepMode, {
  courses: boolean;
  videos: boolean;
  community: boolean;
  attendance: boolean;
}> = {
  utme: {
    courses: false,
    videos: false,
    community: false,
    attendance: false
  },
  oau: {
    courses: true,
    videos: true,
    community: true,
    attendance: true
  },
  putme: {
    courses: false,
    videos: false,
    community: false,
    attendance: false
  }
};

export const isPrepFeatureEnabled = (prepMode: PrepMode, feature: keyof typeof PREP_MODE_FEATURES[PrepMode]) => {
  return PREP_MODE_FEATURES[prepMode]?.[feature] === true;
};

export const normalizePrepMode = (value: unknown): PrepMode => {
  return PREP_MODES.includes(value as PrepMode) ? value as PrepMode : DEFAULT_PREP_MODE;
};

export const getTestPrepMode = (value: { prepMode?: PrepMode | string | null }): PrepMode => {
  return normalizePrepMode(value?.prepMode || DEFAULT_PREP_MODE);
};

export const getLicenseForPrepMode = (user: User | null, prepMode: PrepMode) => {
  return user?.licenses?.[prepMode] || null;
};

export const hasActivePrepLicense = (user: User | null, prepMode: PrepMode) => {
  const license = getLicenseForPrepMode(user, prepMode);
  if (license?.status === 'active') {
    if (!license.endsAt) return true;
    const endsAt = Date.parse(license.endsAt);
    return Number.isFinite(endsAt) && endsAt > Date.now();
  }

  if (prepMode === DEFAULT_PREP_MODE && user?.subscriptionStatus === 'active') {
    if (!user.subscriptionEndsAt) return true;
    const endsAt = Date.parse(user.subscriptionEndsAt);
    return Number.isFinite(endsAt) && endsAt > Date.now();
  }

  return false;
};

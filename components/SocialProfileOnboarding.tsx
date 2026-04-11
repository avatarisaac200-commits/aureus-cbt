import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { db } from '../firebase';
import { CommunityProfile, User } from '../types';
import { toast } from './ui/Toast';

interface SocialProfileOnboardingProps {
  user: User;
  initialProfile?: CommunityProfile | null;
  canClose?: boolean;
  onClose?: () => void;
  onComplete: (payload: { userPatch: Partial<User>; profile: CommunityProfile }) => void;
}

const INTEREST_OPTIONS = [
  'Anatomy',
  'Physiology',
  'Biochemistry',
  'Pathology',
  'Pharmacology',
  'Surgery',
  'Internal Medicine',
  'Paediatrics',
  'Obstetrics',
  'Exam Prep',
  'Study Accountability',
  'Career Networking'
];

const STEPS = ['Identity', 'About You', 'Discovery'];

const SocialProfileOnboarding: React.FC<SocialProfileOnboardingProps> = ({
  user,
  initialProfile = null,
  canClose = false,
  onClose,
  onComplete
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [displayName, setDisplayName] = useState(initialProfile?.displayName || user.name || '');
  const [title, setTitle] = useState(initialProfile?.title || user.title || '');
  const [avatarUrl, setAvatarUrl] = useState(initialProfile?.avatarUrl || user.avatarUrl || '');
  const [bio, setBio] = useState(initialProfile?.bio || user.bio || '');
  const [institution, setInstitution] = useState(initialProfile?.institution || user.institution || '');
  const [yearOfStudy, setYearOfStudy] = useState(initialProfile?.yearOfStudy || user.yearOfStudy || '');
  const [studyInterests, setStudyInterests] = useState<string[]>(initialProfile?.studyInterests || user.studyInterests || []);
  const [lookingForFriends, setLookingForFriends] = useState(initialProfile?.lookingForFriends ?? true);
  const [discoverable, setDiscoverable] = useState(initialProfile?.discoverable ?? true);

  useEffect(() => {
    if (!initialProfile) return;
    setDisplayName(initialProfile.displayName || user.name || '');
    setTitle(initialProfile.title || user.title || '');
    setAvatarUrl(initialProfile.avatarUrl || user.avatarUrl || '');
    setBio(initialProfile.bio || user.bio || '');
    setInstitution(initialProfile.institution || user.institution || '');
    setYearOfStudy(initialProfile.yearOfStudy || user.yearOfStudy || '');
    setStudyInterests(initialProfile.studyInterests || user.studyInterests || []);
    setLookingForFriends(initialProfile.lookingForFriends ?? true);
    setDiscoverable(initialProfile.discoverable ?? true);
  }, [initialProfile, user]);

  const completionLabel = useMemo(() => `${stepIndex + 1} / ${STEPS.length}`, [stepIndex]);

  const toggleInterest = (value: string) => {
    setStudyInterests((prev) => prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value].slice(0, 6));
  };

  const handleAvatarFileUpload = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('Invalid file', 'Please upload an image file.');
      return;
    }
    if (file.size > 1024 * 1024) {
      toast.warning('Image too large', 'Please use an image smaller than 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const next = String(reader.result || '');
      if (!next) return;
      setAvatarUrl(next);
    };
    reader.readAsDataURL(file);
  };

  const validateStep = () => {
    if (stepIndex === 0 && !displayName.trim()) {
      toast.warning('Missing name', 'Add the name people will see in chat.');
      return false;
    }
    if (stepIndex === 1) {
      if (!bio.trim()) {
        toast.warning('Add a bio', 'Write a short introduction so people know who they are meeting.');
        return false;
      }
      if (bio.trim().length < 24) {
        toast.warning('Bio too short', 'Use at least a short sentence for your introduction.');
        return false;
      }
    }
    if (stepIndex === 2 && studyInterests.length === 0) {
      toast.warning('Pick interests', 'Choose at least one study interest for discovery.');
      return false;
    }
    return true;
  };

  const saveProfile = async () => {
    if (!validateStep()) return;
    const now = new Date().toISOString();
    const userPatch: Partial<User> = {
      name: displayName.trim(),
      title: title.trim(),
      avatarUrl: avatarUrl.trim(),
      bio: bio.trim(),
      institution: institution.trim(),
      yearOfStudy: yearOfStudy.trim(),
      studyInterests,
      socialOnboardingCompletedAt: now
    };
    const profile: CommunityProfile = {
      id: user.id,
      userId: user.id,
      displayName: displayName.trim(),
      title: title.trim(),
      avatarUrl: avatarUrl.trim(),
      bio: bio.trim(),
      institution: institution.trim(),
      yearOfStudy: yearOfStudy.trim(),
      studyInterests,
      discoverable,
      onboardingCompletedAt: now,
      lookingForFriends,
      lastActiveAt: now
    };

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'users', user.id), { id: user.id, ...userPatch }, { merge: true });
      await setDoc(doc(db, 'communityProfiles', user.id), profile, { merge: true });
      onComplete({ userPatch, profile });
      toast.success('Profile ready', 'Your social profile is now live.');
    } catch (err: any) {
      toast.error('Save failed', err?.message || 'Could not save your profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (stepIndex < STEPS.length - 1) {
      if (!validateStep()) return;
      setStepIndex((prev) => prev + 1);
      return;
    }
    await saveProfile();
  };

  return (
    <div className="fixed inset-0 z-[220] bg-slate-950/80 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-4 overflow-y-auto safe-top safe-bottom">
      <div className="w-full max-w-3xl min-h-full sm:min-h-0 sm:max-h-[92dvh] rounded-none sm:rounded-[2rem] overflow-hidden border-0 sm:border border-slate-200 bg-white shadow-none sm:shadow-2xl flex flex-col">
        <div className="bg-slate-950 px-4 py-5 sm:px-6 sm:py-6 border-b-4 border-amber-500 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between shrink-0">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-500">Community Setup</p>
            <h2 className="mt-2 text-xl sm:text-2xl font-black uppercase text-white leading-tight">Build Your Chat Profile</h2>
            <p className="mt-2 text-sm text-slate-300">This runs once on first login so people can actually meet and identify each other.</p>
          </div>
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-white">{completionLabel}</span>
            {canClose && onClose ? (
              <button onClick={onClose} className="rounded-xl border border-white/20 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-200">
                Close
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] min-h-0 flex-1 overflow-hidden">
          <aside className="border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50 p-3 sm:p-5 shrink-0">
            <div className="flex gap-3 overflow-x-auto pb-1 lg:block lg:space-y-3 lg:overflow-visible">
              {STEPS.map((label, index) => (
                <div key={label} className={`rounded-2xl px-4 py-3 border min-w-[132px] lg:min-w-0 ${index === stepIndex ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Step {index + 1}</p>
                  <p className="mt-1 text-sm font-black uppercase text-slate-900">{label}</p>
                </div>
              ))}
            </div>
          </aside>

          <div className="p-4 sm:p-8 space-y-6 overflow-y-auto min-h-0">
            {stepIndex === 0 && (
              <section className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Display Name</span>
                    <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How people see you" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Headline</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Example: 300L Medicine" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Avatar URL</span>
                  <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="Paste an image link if you want a profile photo" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none" />
                </label>
                <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Upload From Device</p>
                      <p className="mt-1 text-xs text-slate-600">Choose a photo from your phone or computer. Max size: 1MB.</p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-widest text-amber-500">
                      Choose Photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleAvatarFileUpload(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4 sm:p-5 flex items-center gap-4">
                  <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center text-lg font-black text-slate-500 shrink-0">
                    {avatarUrl.trim() ? <img src={avatarUrl.trim()} alt="Avatar preview" className="h-full w-full object-cover" /> : String(displayName || user.name || 'U').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black uppercase text-slate-900 break-words">{displayName.trim() || user.name}</p>
                    <p className="text-[11px] font-bold uppercase text-slate-500 break-words">{title.trim() || 'Student'}</p>
                  </div>
                </div>
              </section>
            )}

            {stepIndex === 1 && (
              <section className="space-y-4">
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Short Bio</span>
                  <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={5} placeholder="What are you studying, what kind of people do you want to meet, and how do you like to learn?" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm resize-none outline-none" />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Institution</span>
                    <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="School or faculty" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Year / Level</span>
                    <input value={yearOfStudy} onChange={(e) => setYearOfStudy(e.target.value)} placeholder="Example: 400L" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none" />
                  </label>
                </div>
              </section>
            )}

            {stepIndex === 2 && (
              <section className="space-y-5">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Study Interests</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {INTEREST_OPTIONS.map((interest) => (
                      <button
                        key={interest}
                        type="button"
                        onClick={() => toggleInterest(interest)}
                        className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wide ${studyInterests.includes(interest) ? 'bg-slate-950 text-amber-500' : 'bg-slate-100 text-slate-600'}`}
                      >
                        {interest}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 flex gap-3 items-start">
                    <input type="checkbox" checked={lookingForFriends} onChange={(e) => setLookingForFriends(e.target.checked)} className="mt-1" />
                    <span className="min-w-0">
                      <span className="block text-sm font-black uppercase text-slate-900">Open to new friends</span>
                      <span className="block mt-1 text-xs text-slate-600">Show that you want new chat requests and study connections.</span>
                    </span>
                  </label>
                  <label className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 flex gap-3 items-start">
                    <input type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} className="mt-1" />
                    <span className="min-w-0">
                      <span className="block text-sm font-black uppercase text-slate-900">Visible in discovery</span>
                      <span className="block mt-1 text-xs text-slate-600">Let other signed-in users find you in the people directory.</span>
                    </span>
                  </label>
                </div>
              </section>
            )}

            <div className="sticky bottom-0 -mx-4 sm:-mx-8 mt-2 border-t border-slate-100 bg-white px-4 py-4 sm:px-8 sm:pt-5 sm:pb-5 safe-bottom flex flex-col-reverse gap-3 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                disabled={stepIndex === 0 || isSaving}
                className="rounded-2xl border border-slate-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-600 disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handlePrimaryAction()}
                disabled={isSaving}
                className="rounded-2xl bg-slate-950 px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-amber-500 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : stepIndex === STEPS.length - 1 ? 'Finish Setup' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SocialProfileOnboarding;

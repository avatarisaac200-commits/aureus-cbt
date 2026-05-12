import React from 'react';
import type { NotificationPreference, NotificationType, User } from '../../types';
import { NOTIFICATION_TYPE_LABELS, NOTIFICATION_TYPES } from '../../lib/classboard';

interface NotificationPreferencesProps {
  user: User;
  preferences: NotificationPreference[];
  onToggle: (type: NotificationType, key: 'inApp' | 'push' | 'email') => void;
}

const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({ user, preferences, onToggle }) => {
  const getPreference = (type: NotificationType) => {
    return preferences.find((item) => item.notificationType === type);
  };

  return (
    <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-950 uppercase">Notifications</h2>
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Per-alert preferences for {user.name}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="grid grid-cols-[1.5fr_repeat(3,minmax(90px,1fr))] gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
            <p>Type</p>
            <p>In-app</p>
            <p>Push</p>
            <p>Email</p>
          </div>
          <div className="space-y-2">
            {NOTIFICATION_TYPES.map((type) => {
              const pref = getPreference(type);
              return (
                <div key={type} className="grid grid-cols-[1.5fr_repeat(3,minmax(90px,1fr))] gap-2 items-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-xs font-black uppercase tracking-widest text-slate-800">{NOTIFICATION_TYPE_LABELS[type]}</p>
                  {(['inApp', 'push', 'email'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onToggle(type, key)}
                      className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest ${pref?.[key] ? 'bg-emerald-500 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
                    >
                      {pref?.[key] ? 'On' : 'Off'}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default NotificationPreferences;

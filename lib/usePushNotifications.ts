import { useEffect } from 'react';
import { addDoc, collection, getDocs, query, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { db } from '../firebase';
import type { User } from '../types';
import { buildPushSubscriptionId, isTeacherRole } from './classboard';

const PUBLIC_VAPID_KEY = (import.meta as any)?.env?.VITE_WEB_PUSH_PUBLIC_KEY || '';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const usePushNotifications = (user: User | null, enabled = true) => {
  useEffect(() => {
    if (!user || !enabled || typeof window === 'undefined') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!user.socialOnboardingCompletedAt && !isTeacherRole(user)) return;

    let cancelled = false;
    const setup = async () => {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission().catch(() => 'default' as NotificationPermission)
        : Notification.permission;
      if (permission !== 'granted' || cancelled) return;

      const registration = await navigator.serviceWorker.register('/sw.js').catch(() => null);
      if (!registration || cancelled) return;
      if (!PUBLIC_VAPID_KEY) return;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
      }).catch(async () => registration.pushManager.getSubscription());

      if (!subscription || cancelled) return;
      const json = subscription.toJSON();
      const endpoint = String(json.endpoint || '');
      if (!endpoint) return;

      const existingSnap: any = await getDocs(query(
        collection(db, 'pushSubscriptions'),
        where('userId', '==', user.id),
        where('endpoint', '==', endpoint)
      ));

      if (existingSnap.empty) {
        await addDoc(collection(db, 'pushSubscriptions'), {
          id: buildPushSubscriptionId(user.id, endpoint),
          userId: user.id,
          endpoint,
          keys: json.keys || {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }).catch(() => undefined);
        return;
      }

      await Promise.all(existingSnap.docs.map((docSnap: any) => updateDoc(docSnap.ref, {
        keys: json.keys || {},
        updatedAt: new Date().toISOString()
      }))).catch(() => undefined);
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [enabled, user]);
};

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCw9TAxS-fsJSpyXUI7z3GiuU_EGP24cus',
  authDomain: 'aureus-medicos-cbt.firebaseapp.com',
  projectId: 'aureus-medicos-cbt',
  storageBucket: 'aureus-medicos-cbt.firebasestorage.app',
  messagingSenderId: '367913973401',
  appId: '1:367913973401:web:acafe5afd89216710b6a08'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'Aureus Medicos CBT';
  const body = payload?.notification?.body || 'You have a new notification.';
  self.registration.showNotification(title, {
    body,
    icon: '/assets/logo.png',
    badge: '/assets/logo.png',
    data: payload?.data || {}
  });
});

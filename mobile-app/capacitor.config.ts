import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aureusmedicos.cbt',
  appName: 'Aureus Medicos CBT',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  }
};

export default config;

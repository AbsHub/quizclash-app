import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";

// These come from your Firebase project settings, injected at build time
// via Vite env vars (see .env.example). Never commit your actual .env file.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// Some office/guest/venue WiFi (firewalls, proxies) blocks the persistent
// streaming connection Firestore normally uses for real-time updates.
// This auto-detects that case and falls back to long-polling, which is far
// more firewall-friendly — critical for events on unpredictable WiFi.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

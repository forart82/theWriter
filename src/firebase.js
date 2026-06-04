import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Firebase configuration provided by user
const firebaseConfig = {
  apiKey: "AIzaSyAkBeOzu9TUPvtz2Qc9WTSaAY0l65Z6uWE",
  authDomain: "writer-forart.firebaseapp.com",
  projectId: "writer-forart",
  storageBucket: "writer-forart.firebasestorage.app",
  messagingSenderId: "110397104950",
  appId: "1:110397104950:web:e9735a5d1f676efce14997",
  measurementId: "G-4PXD8CPBY3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Analytics (optional, handles environment checks)
let analytics = null;
if (typeof window !== "undefined") {
  try {
    analytics = getAnalytics(app);
  } catch (err) {
    console.warn("Firebase Analytics failed to initialize:", err);
  }
}
export { analytics };

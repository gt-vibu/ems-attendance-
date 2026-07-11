import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBZTSI_8Nplr1qqnbDUpvRZkfsmS7utd7A",
  authDomain: "circular-trees-k6tp2.firebaseapp.com",
  projectId: "circular-trees-k6tp2",
  storageBucket: "circular-trees-k6tp2.firebasestorage.app",
  messagingSenderId: "1033223578591",
  appId: "1:1033223578591:web:1f3041e0de9ebb95231a6a"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

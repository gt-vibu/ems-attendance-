import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBZTSI_8Nplr1qqnbDUpvRZkfsmS7utd7A",
  authDomain: "circular-trees-k6tp2.firebaseapp.com",
  projectId: "circular-trees-k6tp2",
  storageBucket: "circular-trees-k6tp2.firebasestorage.app",
  messagingSenderId: "1033223578591",
  appId: "1:1033223578591:web:1f3041e0de9ebb95231a6a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

async function seed() {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, "admin@company.com", "password123");
    console.log("Successfully created user:", userCredential.user.uid);
  } catch (error: any) {
    if (error.code === 'auth/email-already-in-use') {
        console.log("Admin user already exists");
    } else {
        console.error("Error:", error.message);
    }
  }
}

seed();

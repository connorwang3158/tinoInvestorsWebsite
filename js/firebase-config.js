// Officer editing settings. Setup steps are in EDITING.md.
//
// Until firebaseConfig is filled in, the Officers, Competitions and Resources pages just show
// what's written in their HTML files (and slides.txt), and there's no Officer Login link.
//
// These values are safe to publish. They only identify the Firebase project; the Firestore
// rules decide who can save changes.
// From Firebase: Project settings → General → Your apps → website.
// To turn editing off again, set this back to null.
export const firebaseConfig = {
  apiKey: "AIzaSyC-TqUH3ZOIEUcjsmr5nJCwWvKwegjZ1JU",
  authDomain: "tino-investors-website.firebaseapp.com",
  databaseURL: "https://tino-investors-website-default-rtdb.firebaseio.com",
  projectId: "tino-investors-website",
  storageBucket: "tino-investors-website.firebasestorage.app",
  messagingSenderId: "590841705053",
  appId: "1:590841705053:web:d821af501435dc2f3b93b4",
  measurementId: "G-SB0NGZ1Q54",
};

// The only Google account that can edit. The same address is in the Firestore rules (EDITING.md).
export const EDITOR_EMAIL = "tinoinvestors@gmail.com";

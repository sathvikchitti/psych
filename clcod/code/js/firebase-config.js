import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCupH4cnOPGkX55xLn2M0wOFvBouMD1CfM",
  authDomain: "depression-detection-51816.firebaseapp.com",
  projectId: "depression-detection-51816",
  storageBucket: "depression-detection-51816.firebasestorage.app",
  messagingSenderId: "889249470832",
  appId: "1:889249470832:web:660d2fb7f03291144017b5",
  measurementId: "G-99B4K2WXF8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.addScope('profile');
provider.addScope('email');

// ── Firestore helpers ──────────────────────────────────────────

// Save or update the user profile document
window.saveUserProfile = async function (profileData) {
  if (!window.currentUser) return;
  try {
    await setDoc(doc(db, 'users', window.currentUser.uid), profileData, { merge: true });
  } catch (e) { console.error('saveUserProfile:', e); }
};

// Load user profile
window.loadUserProfile = async function () {
  if (!window.currentUser) return null;
  try {
    const snap = await getDoc(doc(db, 'users', window.currentUser.uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) { console.error('loadUserProfile:', e); return null; }
};

// Save a new assessment report
window.saveReport = async function (reportData) {
  if (!window.currentUser) return;
  try {
    await addDoc(collection(db, 'users', window.currentUser.uid, 'reports'), {
      ...reportData,
      createdAt: new Date().toISOString()
    });
  } catch (e) { console.error('saveReport:', e); }
};

// Load all reports for current user, newest first
window.loadReports = async function () {
  if (!window.currentUser) return [];
  try {
    const q = query(collection(db, 'users', window.currentUser.uid, 'reports'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error('loadReports:', e); return []; }
};

// ── Auth ───────────────────────────────────────────────────────

window.firebaseSignIn = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    window.currentUser = { uid: user.uid, name: user.displayName || user.email, email: user.email, photo: user.photoURL, gender: '' };

    // Pull any saved profile data from Firestore
    const saved = await window.loadUserProfile();
    if (saved) {
      window.currentUser.gender = saved.gender || '';
      window.currentUser.age = saved.age || '';
    }

    updateUserBadge(window.currentUser);
    hideLoginBtn();
    if (window.closeAuthModal) window.closeAuthModal();
    // Redirect to analysis — login.html's onAuthStateChanged handles this automatically
    window.location.href = 'analysis.html';
  } catch (err) {
    console.error('Sign-in error:', err);
    if (err.code === 'auth/popup-blocked') alert('Please allow popups for this site to sign in with Google.');
  }
};

window.firebaseSignOut = async () => {
  await signOut(auth);
  window.currentUser = null;
  updateUserBadge(null);
  showLoginBtn();
};

// Promise that resolves once Firebase auth state is known (user or null).
// app.js uses this to wait before acting on a pending profile transition.
window._authReady = new Promise(resolve => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      window.currentUser = { uid: user.uid, name: user.displayName || user.email, email: user.email, photo: user.photoURL, gender: '' };

      const saved = await window.loadUserProfile();
      if (saved) {
        window.currentUser.gender = saved.gender || '';
        window.currentUser.age = saved.age || '';
      }

      updateUserBadge(window.currentUser);
      hideLoginBtn();

      // Re-prefill the user-info form if it's currently active
      // (handles page reload where DOMContentLoaded fires before onAuthStateChanged)
      if (typeof window.prefillUserInfo === 'function') {
        window.prefillUserInfo();
      }

      // If the profile page is currently active (arrived via pendingPageTransition),
      // render it now that we know the user — fixes the redirect-to-landing race condition.
      const profilePage = document.getElementById('page-profile');
      if (profilePage && profilePage.classList.contains('active')) {
        if (typeof window.renderProfilePage === 'function') {
          window.renderProfilePage();
        }
      }
    } else {
      window.currentUser = null;
      showLoginBtn();
    }
    resolve(user);
  });
});

// ── UI helpers ─────────────────────────────────────────────────

function hideLoginBtn() {
  const btn = document.getElementById('login-signup-btn');
  if (btn) btn.style.display = 'none';
}

function showLoginBtn() {
  const btn = document.getElementById('login-signup-btn');
  if (btn) btn.style.display = 'flex';
}

function updateUserBadge(user) {
  const container = document.getElementById('user-badge-container');
  if (!container) return;
  if (!user) { container.innerHTML = ''; return; }
  const displayName = user.name || user.email || 'User';
  const avatarSeed = displayName.includes('@') ? displayName.split('@')[0] : displayName;
  const avatarUrl = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarSeed)}&background=06b6d4&color=fff&size=128`;
  container.innerHTML = `<div class="user-badge" onclick="window.goTo('profile')" style="cursor:pointer;" title="View Profile">
    <img src="${avatarUrl}" alt="${displayName}" referrerpolicy="no-referrer" />
    <div style="display:flex;flex-direction:column;">
      <span style="font-size:11px;font-weight:700;line-height:1;">${displayName}</span>
      <span style="font-size:9px;color:#06b6d4;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;">View Profile</span>
    </div>
  </div>`;
}

export { auth, db, provider };
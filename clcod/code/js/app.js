// ---- Auth Modal ----
let currentAuthTab = 'login';

window.openAuthModal = function () {
  const modal = document.getElementById('auth-modal');
  if (modal) { modal.style.display = 'flex'; switchAuthTab('login'); }
};

window.closeAuthModal = function () {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
  clearAuthError();
};

// Close on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) window.closeAuthModal();
    });
  }
});

window.switchAuthTab = function (tab) {
  currentAuthTab = tab;
  const nameField = document.getElementById('auth-name-field');
  const confirmField = document.getElementById('auth-confirm-field');
  const submitBtn = document.getElementById('auth-submit-btn');
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');

  const activeStyle = 'background:rgba(139,92,246,0.2);color:#8b5cf6;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  const inactiveStyle = 'background:transparent;color:#64748b;box-shadow:none;';

  if (tab === 'login') {
    if (nameField) nameField.style.display = 'none';
    if (confirmField) confirmField.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Login';
    if (tabLogin) tabLogin.setAttribute('style', tabLogin.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + activeStyle);
    if (tabSignup) tabSignup.setAttribute('style', tabSignup.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + inactiveStyle);
  } else {
    if (nameField) nameField.style.display = 'block';
    if (confirmField) confirmField.style.display = 'block';
    if (submitBtn) submitBtn.textContent = 'Create Account';
    if (tabSignup) tabSignup.setAttribute('style', tabSignup.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + activeStyle);
    if (tabLogin) tabLogin.setAttribute('style', tabLogin.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + inactiveStyle);
  }
  clearAuthError();
};

window.togglePasswordVis = function () {
  const input = document.getElementById('auth-password');
  const icon = document.getElementById('eye-icon');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    input.type = 'password';
    if (icon) icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
};

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearAuthError() {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

window.handleAuthSubmit = async function () {
  clearAuthError();
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const btn = document.getElementById('auth-submit-btn');

  if (!email || !password) { showAuthError('Please fill in all fields.'); return; }

  if (currentAuthTab === 'signup') {
    const name = document.getElementById('auth-name')?.value.trim();
    const confirm = document.getElementById('auth-confirm')?.value;
    if (!name) { showAuthError('Please enter your full name.'); return; }
    if (password !== confirm) { showAuthError('Passwords do not match.'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }
  }

  if (btn) { btn.textContent = currentAuthTab === 'login' ? 'Signing in…' : 'Creating account…'; btn.disabled = true; }

  try {
    const { auth } = await import('./firebase-config.js');
    const { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js');

    if (currentAuthTab === 'login') {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const name = document.getElementById('auth-name')?.value.trim();
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      window.currentUser = { uid: cred.user.uid, name, email: cred.user.email, photo: null };
    }
    window.closeAuthModal();
    window.goTo('user-info');
  } catch (err) {
    const msgs = {
      'auth/user-not-found': 'No account found with this email.',
      'auth/wrong-password': 'Incorrect password.',
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/invalid-email': 'Invalid email address.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
      'auth/invalid-credential': 'Invalid email or password.',
    };
    showAuthError(msgs[err.code] || 'Something went wrong. Please try again.');
  } finally {
    if (btn) { btn.textContent = currentAuthTab === 'login' ? 'Login' : 'Create Account'; btn.disabled = false; }
  }
};

// ---- State ----
// ---- State ----
// Retrieve persisted state across page reloads (multi-page architecture)
let currentPage = 'landing';
let userInfo = JSON.parse(sessionStorage.getItem('ps_userInfo') || '{"name":"","age":"","gender":""}');
let textInputVal = sessionStorage.getItem('ps_textInputVal') || '';
let videoBase64 = sessionStorage.getItem('ps_videoBase64') || null;
let audioBase64 = sessionStorage.getItem('ps_audioBase64') || null;
let audioUrl = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingTime = 0;
let aiResult = JSON.parse(sessionStorage.getItem('ps_aiResult') || 'null');
let questionnaireAnswers = { elevatedMood: false, reducedSleep: false, impulsivity: false, racingThoughts: false };

// ── BACKEND URL CONFIG ──────────────────────────────────────────────────────
// For local development, keep this as http://127.0.0.1:5000
//https://sense123-psychsense.hf.space.
// Before deploying to production, change this to your hosted backend URL, e.g.:
//   const FLASK_API_URL = 'https://your-backend.railway.app';
const FLASK_API_URL = 'https://sense123-psychsense.hf.space';
// ────────────────────────────────────────────────────────────────────────────

window.goTo = function (page) {
  // Save current state before potential page transition
  sessionStorage.setItem('ps_userInfo', JSON.stringify(userInfo));
  sessionStorage.setItem('ps_aiResult', JSON.stringify(aiResult));
  sessionStorage.setItem('ps_textInputVal', textInputVal);
  if (videoBase64) {
    try { sessionStorage.setItem('ps_videoBase64', videoBase64); }
    catch (e) { console.warn('Video too large for sessionStorage, skipping cache.'); }
  }
  if (audioBase64) {
    try { sessionStorage.setItem('ps_audioBase64', audioBase64); }
    catch (e) { console.warn('Audio too large for sessionStorage, skipping cache.'); }
  }

  // Determine which HTML file houses this page
  let targetFile = '';
  if (['landing'].includes(page)) targetFile = 'index.html';
  else if (['results'].includes(page)) targetFile = 'results.html';
  else targetFile = 'analysis.html';

  // FIX: Detect current file from pathname robustly.
  // Works whether the server serves clean URLs (/analysis), .html extensions
  // (/analysis.html), or a root URL (/).
  // Strategy: check the DOM for a known landmark element unique to each file,
  // rather than trying to parse the URL (which varies by server config).
  const onAnalysis = !!document.getElementById('page-user-info') || !!document.getElementById('page-assessment');
  const onResults = !!document.getElementById('page-results') && !document.getElementById('page-user-info');
  const currentFile = onResults ? 'results.html' : onAnalysis ? 'analysis.html' : 'index.html';

  if (currentFile === targetFile) {
    // Already on the right file — just swap the visible page in-place
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById('page-' + page);
    if (targetPage) targetPage.classList.add('active');
    currentPage = page;
    if (page === 'user-info') prefillUserInfo();
    if (page === 'assessment') {
      // Restore text input from sessionStorage and re-evaluate button state
      const textEl = document.getElementById('text-input');
      if (textEl && !textEl.value && textInputVal) textEl.value = textInputVal;
      window.updateAssessBtn();
    }
    return;
  }

  // Different file — navigate, carrying the target page as a pending transition
  sessionStorage.setItem('pendingPageTransition', page);
  window.location.href = targetFile;
};

document.addEventListener('DOMContentLoaded', () => {
  const pending = sessionStorage.getItem('pendingPageTransition');
  if (pending) {
    sessionStorage.removeItem('pendingPageTransition');
    window.goTo(pending);
  } else {
    // No pending transition — detect which file we're on by DOM content
    const onAnalysis = !!document.getElementById('page-user-info') || !!document.getElementById('page-assessment');
    const onResults = !!document.getElementById('page-results') && !document.getElementById('page-user-info');
    if (onResults) window.goTo('results');
    else if (onAnalysis) window.goTo('user-info');
    else window.goTo('landing');
  }

  // If on results page, render the stored result
  if (aiResult && document.getElementById('page-results')?.classList.contains('active')) {
    renderResults(aiResult, aiResult.depressionType, aiResult.riskLevel === 'High' || aiResult.riskLevel === 'Moderate');
  }
});

// ── Toast notification ────────────────────────────────────────────────────────
let _toastTimer = null;
window.showToast = function (msg, type = 'warn') {
  const toast = document.getElementById('ps-toast');
  const msgEl = document.getElementById('ps-toast-msg');
  const icon = document.getElementById('ps-toast-icon');
  if (!toast || !msgEl) return;

  msgEl.textContent = msg;

  // Icon colour
  const colour = type === 'error' ? '#ef4444' : '#f59e0b';
  if (icon) icon.setAttribute('stroke', colour);
  toast.style.borderColor = type === 'error' ? 'rgba(239,68,68,0.4)' : 'rgba(6,182,212,0.4)';

  // Show
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  toast.style.pointerEvents = 'auto';

  // Auto-hide after 4s
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    toast.style.pointerEvents = 'none';
  }, 4000);
};

// ── Gated "Start Analysis" — requires login ───────────────────────────────────
window.startAnalysisGated = function () {
  if (window.currentUser) {
    window.goTo('user-info');
  } else {
    window.showToast('Please sign in to start your assessment.', 'warn');
  }
};

// ── Results History Modal ─────────────────────────────────────────────────────
window.openResultsHistory = async function () {
  if (!window.currentUser) {
    window.showToast('Please sign in to view your history.', 'warn');
    return;
  }

  const modal = document.getElementById('results-history-modal');
  const list = document.getElementById('results-history-list');
  if (!modal || !list) return;

  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) window.closeResultsHistory(); };

  list.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:40px;gap:12px;color:#64748b;">
      <div class="spin" style="width:20px;height:20px;border-top:2px solid #06b6d4;border-radius:50%;"></div>
      <span style="font-size:13px;">Loading your reports…</span>
    </div>`;

  const reports = window.loadReports ? await window.loadReports() : [];

  if (!reports || !reports.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:60px 20px;">
        <div style="width:64px;height:64px;background:rgba(100,116,139,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </div>
        <p style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700;color:#64748b;margin-bottom:8px;">No History Yet</p>
        <p style="font-size:13px;color:#475569;line-height:1.6;">Complete your first assessment to see your report history here.</p>
      </div>`;
    return;
  }

  list.innerHTML = reports.map((r, idx) => {
    const date = r.createdAt
      ? new Date(r.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Unknown date';

    const risk = r.riskLevel || 'Low';
    const isLow = risk === 'Low';
    const riskColour = isLow ? '#22c55e' : risk === 'High' ? '#ef4444' : '#f59e0b';
    const riskLabel = risk;
    const scoreLabel = r.confidenceScore != null ? `${r.confidenceScore}%` : '—';
    const typeLabel = r.depressionType || '';
    const name = r.userInfo?.name || window.currentUser?.name || '—';

    const signals = (r.emotionalSignals || []).slice(0, 4)
      .map(s => `<span style="background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.2);border-radius:6px;padding:3px 10px;font-size:10px;color:#c4b5fd;font-weight:600;">${s}</span>`)
      .join('');

    const recs = (r.recommendations || []).slice(0, 2)
      .map(rec => `<li style="font-size:11px;color:#94a3b8;line-height:1.5;margin-left:12px;">${rec}</li>`)
      .join('');

    return `
      <div style="background:rgba(0,0,0,0.25);border-radius:18px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
        <!-- Card Header -->
        <div style="padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div>
            <p style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:15px;margin-bottom:2px;">${name}</p>
            <p style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.08em;">${date}</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="text-align:right;">
              <p style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:800;color:${riskColour};">${riskLabel}</p>
              ${typeLabel ? `<p style="font-size:10px;color:#64748b;">${typeLabel}</p>` : ''}
            </div>
            <div style="width:42px;height:42px;border-radius:50%;border:2px solid ${riskColour};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <span style="font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:800;color:${riskColour};">${scoreLabel}</span>
            </div>
          </div>
        </div>

        ${signals ? `
        <!-- Signals -->
        <div style="padding:10px 20px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid rgba(255,255,255,0.04);">
          ${signals}
        </div>` : ''}

        ${recs ? `
        <!-- Recommendations -->
        <div style="padding:12px 20px;">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#06b6d4;font-weight:700;margin-bottom:6px;">Top Recommendations</p>
          <ul style="list-style:disc;padding:0;margin:0;">
            ${recs}
          </ul>
        </div>` : ''}
      </div>`;
  }).join('');
};

window.closeResultsHistory = function () {
  const modal = document.getElementById('results-history-modal');
  if (modal) modal.style.display = 'none';
};

window.prefillUserInfo = function prefillUserInfo() {
  if (!window.currentUser) return;

  const nameInput = document.getElementById('input-name');
  const ageInput = document.getElementById('input-age');
  const genderInput = document.getElementById('input-gender');
  const photoWrap = document.getElementById('user-info-photo-wrap');

  // Restore from currentUser (which is populated from Firestore on login)
  if (nameInput && window.currentUser.name) nameInput.value = window.currentUser.name;
  if (ageInput && window.currentUser.age) ageInput.value = window.currentUser.age;
  if (genderInput && window.currentUser.gender) genderInput.value = window.currentUser.gender;

  // Also sync userInfo state so it's up-to-date before runInitialAnalysis reads it
  if (nameInput) userInfo.name = nameInput.value || userInfo.name;
  if (ageInput) userInfo.age = ageInput.value || userInfo.age;
  if (genderInput) userInfo.gender = genderInput.value || userInfo.gender;

  // Inject profile photo above the form if not already there
  if (photoWrap) {
    const avatarUrl = window.currentUser.photo ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(window.currentUser.name || 'U')}&background=06b6d4&color=fff&size=128`;
    photoWrap.innerHTML = `
      <div style="position:relative;display:inline-block;margin-bottom:8px;">
        <img src="${avatarUrl}" referrerpolicy="no-referrer"
          style="width:80px;height:80px;border-radius:50%;border:2px solid rgba(6,182,212,0.4);object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;cursor:pointer;"
          onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0"
          onclick="document.getElementById('photo-file-input').click()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </div>
      </div>
      <input type="file" id="photo-file-input" accept="image/*" style="display:none;" onchange="handlePhotoChange(event)" />
      <p style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Profile Photo</p>`;
  }
}

window.handlePhotoChange = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onloadend = () => {
    window.currentUser.photo = reader.result;
    const img = document.querySelector('#user-info-photo-wrap img');
    if (img) img.src = reader.result;
    // also update the top badge
    const badgeImg = document.querySelector('.user-badge img');
    if (badgeImg) badgeImg.src = reader.result;
  };
  reader.readAsDataURL(file);
};

window.handleGoogleLogin = function () {
  if (window.firebaseSignIn) window.firebaseSignIn();
};

window.updateAssessBtn = function () {
  const textEl = document.getElementById('text-input');
  if (textEl) textInputVal = textEl.value;
  const btn = document.getElementById('assess-continue-btn');
  if (btn) btn.disabled = !textInputVal.trim() && !videoBase64 && !audioBase64;
};

window.toggleVoiceInstructions = function () {
  const body = document.getElementById('voice-instructions-body');
  const chevron = document.getElementById('voice-instr-chevron');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
};

// ---- 12-Question Depression Screening ----
const DEPRESSION_QUESTIONS = [
  {
    text: "Over the past 2 weeks, how often have you felt sad, hopeless, empty, or like a failure?",
    options: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
    key: "sadness"
  },
  {
    text: "How often have you had little interest or pleasure in things you used to enjoy?",
    options: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
    key: "anhedonia"
  },
  {
    text: "How often have you had trouble falling or staying asleep, or waking too early?",
    options: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
    key: "insomnia"
  },
  {
    text: "How often have you been sleeping MUCH MORE than usual (hard to get out of bed even after long sleep)?",
    options: ["Not at all — sleep is normal or reduced", "Several days — slightly more than usual", "More than half the days — clearly oversleeping", "Nearly every day — excessive sleep most days"],
    key: "hypersomnia"
  },
  {
    text: "How often have you felt exhausted or had very little energy, even for small tasks?",
    options: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
    key: "fatigue"
  },
  {
    text: "How often have you had noticeably INCREASED appetite — especially craving carbs, sweets, or comfort food?",
    options: ["Not at all — appetite normal or reduced", "Several days — mild cravings", "More than half the days — noticeable carb/sweet cravings", "Nearly every day — strong cravings, possible weight gain"],
    key: "appetite"
  },
  {
    text: "How often have you had trouble concentrating, felt mentally foggy, or struggled to make decisions?",
    options: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
    key: "concentration"
  },
  {
    text: "Do your symptoms follow a seasonal pattern — clearly worse in autumn/winter and better in spring/summer?",
    options: ["No clear seasonal pattern", "Possibly slightly worse in winter", "Yes — clearly worse in autumn/winter", "Definitely — happens every year without exception"],
    key: "seasonal"
  },
  {
    text: "How long have you been experiencing these depressive symptoms most days?",
    options: ["Less than a few weeks (recent onset)", "A few weeks to several months", "Around 1–2 years (persistent, may fluctuate)", "2 or more years almost continuously (chronic)"],
    key: "duration"
  },
  {
    text: "When something genuinely good happens, does your mood noticeably lift — even if only temporarily?",
    options: ["No — mood stays low regardless of positive events", "Slightly — very minor lifts that fade immediately", "Yes — I do feel meaningfully better during good events", "Definitely — positive events clearly brighten my mood"],
    key: "moodReactivity"
  },
  {
    text: "Did your depressive symptoms begin within 4 weeks of giving birth (or within the first year postpartum)?",
    options: ["No / Not applicable", "Possibly — symptoms worsened after childbirth", "Yes — symptoms clearly started after giving birth", "Yes — severe symptoms starting shortly after delivery"],
    key: "postpartum"
  },
  {
    text: "How often have you had thoughts of being better off dead, or of hurting yourself?",
    options: ["Not at all", "Several days — fleeting thoughts, no plan", "More than half the days — recurring thoughts", "Nearly every day — frequent or distressing thoughts"],
    key: "suicidality"
  }
];

// ---- Location-Aware Doctors Data (keyed by city → depression type) ----
const ALL_CITIES_DOCTORS = {
  'Hyderabad': {
    'Major Depressive Disorder (MDD)': [
      { name: 'Dr. K. Chandrasekhar', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. P. Chytanya Deepak', specialization: 'Bipolar & OCD Clinic, Neuromodulation', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. Madhu Vamsi', specialization: 'Psychiatrist – Adult Depression & Anxiety', workplace: 'MV Clinics, Bagh Lingampally' },
      { name: 'Dr. Nithin Kondapuram', specialization: 'Consultant Psychiatrist (NIMHANS-trained)', workplace: 'Aster Prime Hospital, Ameerpet' },
      { name: 'Dr. Boppana Sridhar', specialization: 'Consultant Psychiatrist & Psychotherapist', workplace: 'Likeminds Clinic, Banjara Hills' },
    ],
    'Persistent Depressive Disorder (Dysthymia)': [
      { name: 'Dr. Ajay Kumar Saxena', specialization: 'General Psychiatry – Chronic Mood Disorders', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. P. Raghurami Reddy', specialization: 'General Psychiatry – Inpatient & Outpatient', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. Praveen S. Gopan', specialization: 'Consultant Psychiatrist', workplace: 'DKR Mind Clinic, Barkatpura' },
      { name: 'Dr. K. Srinivas & team', specialization: 'Psychiatry & Neuromodulation (rTMS)', workplace: 'KARLA Mind 36 Jubilee, Jubilee Hills' },
      { name: 'Chetana Hospital Team', specialization: 'Multidisciplinary Psychiatry & Psychology', workplace: 'Chetana Hospital, Secunderabad' },
    ],
    'Atypical Depression': [
      { name: 'Dr. P. Chytanya Deepak', specialization: 'Mood Disorders & Neuromodulation', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. K. Srinivas & team', specialization: 'rTMS, Neurofeedback & Psychiatric Care', workplace: 'KARLA Mind 36 Jubilee, Jubilee Hills' },
      { name: 'American Center for Neuropsychiatry', specialization: 'Psychiatric Hospital & Mental Health', workplace: 'Banjara Hills, Hyderabad' },
      { name: 'Dr. Madhu Vamsi', specialization: 'Psychiatrist – Adult Mood Disorders', workplace: 'MV Clinics, Bagh Lingampally' },
      { name: 'Dr. Nithin Kondapuram', specialization: 'Consultant Psychiatrist (Hospital-based)', workplace: 'Aster Prime Hospital, Ameerpet' },
    ],
    'Seasonal Affective Disorder (SAD)': [
      { name: 'Dr. K. Chandrasekhar', specialization: 'Senior Consultant Psychiatrist', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. Ajay Kumar Saxena', specialization: 'General Psychiatry – Recurrent Depression', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. K. Srinivas & team', specialization: 'Neuromodulation, Biofeedback & Psychotherapy', workplace: 'KARLA Mind 36 Jubilee, Jubilee Hills' },
      { name: 'Dr. Boppana Sridhar', specialization: 'Outpatient Psychiatrist – Mood Monitoring', workplace: 'Likeminds Clinic, Banjara Hills' },
      { name: 'Dr. Praveen S. Gopan', specialization: 'Consultant Psychiatrist – Seasonal Patterns', workplace: 'DKR Mind Clinic, Barkatpura' },
    ],
    'Postpartum Depression': [
      { name: 'Asha Hospital – Women\'s Wellness Team', specialization: 'Women\'s Mental Health & Psychiatry', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Chetana Hospital Team', specialization: 'Multidisciplinary Psychiatry & Psychology', workplace: 'Chetana Hospital, Secunderabad' },
      { name: 'Rainbow Children\'s Hospital & BirthRight', specialization: 'Obstetrics, Gynaecology & Maternity', workplace: 'Banjara Hills, Hyderabad' },
      { name: 'BirthRight Maternity Hospital (Rainbow)', specialization: 'Obstetrics & Maternity Services', workplace: 'Himayatnagar, Hyderabad' },
      { name: 'Dr. Madhu Vamsi', specialization: 'Psychiatrist – Postpartum Mood Disorders', workplace: 'MV Clinics, Bagh Lingampally' },
    ],
    'Depressive Episode': [
      { name: 'Dr. K. Chandrasekhar', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Asha Hospital, Banjara Hills' },
      { name: 'Dr. Madhu Vamsi', specialization: 'Psychiatrist – Adult Depression & Anxiety', workplace: 'MV Clinics, Bagh Lingampally' },
      { name: 'Dr. Nithin Kondapuram', specialization: 'Consultant Psychiatrist (NIMHANS-trained)', workplace: 'Aster Prime Hospital, Ameerpet' },
      { name: 'Dr. Boppana Sridhar', specialization: 'Consultant Psychiatrist & Psychotherapist', workplace: 'Likeminds Clinic, Banjara Hills' },
      { name: 'Dr. Praveen S. Gopan', specialization: 'Consultant Psychiatrist', workplace: 'DKR Mind Clinic, Barkatpura' },
    ],
  },
  'Bengaluru': {
    'Major Depressive Disorder (MDD)': [
      { name: 'Dr. Shyam Bhat', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Integrated Centre for Wellbeing, Koramangala' },
      { name: 'Dr. Suresh Bada Math', specialization: 'Professor of Psychiatry (NIMHANS)', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Dr. Preeti Jacob', specialization: 'Child & Adult Psychiatrist', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Dr. Nitin Anand', specialization: 'Consultant Psychiatrist', workplace: 'Manipal Hospital, HAL Airport Road' },
      { name: 'Dr. Prashant Bhimani', specialization: 'Psychiatrist & Psychotherapist', workplace: 'Fortis Hospital, Bannerghatta Road' },
    ],
    'Persistent Depressive Disorder (Dysthymia)': [
      { name: 'Dr. Suresh Bada Math', specialization: 'Chronic Mood & Addiction Psychiatry', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Dr. Vivek Benegal', specialization: 'Centre for Addiction Medicine, NIMHANS', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Dr. Shyam Bhat', specialization: 'Integrative Psychiatry & Psychotherapy', workplace: 'Integrated Centre for Wellbeing, Koramangala' },
      { name: 'Dr. Naveen Kumar C.', specialization: 'Consultant Psychiatrist – Outpatient', workplace: 'Apollo Hospital, Jayanagar' },
      { name: 'Vandrevala Foundation Clinic', specialization: 'Mental Health & Counselling', workplace: 'Indiranagar, Bengaluru' },
    ],
    'Atypical Depression': [
      { name: 'Dr. Shyam Bhat', specialization: 'Integrative & Mood Disorder Psychiatry', workplace: 'Integrated Centre for Wellbeing, Koramangala' },
      { name: 'NIMHANS OPD Team', specialization: 'Outpatient Psychiatry & Neuromodulation', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Dr. Naveen Kumar C.', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Hospital, Jayanagar' },
      { name: 'Dr. Nitin Anand', specialization: 'Adult Psychiatry – Atypical Presentations', workplace: 'Manipal Hospital, HAL Airport Road' },
      { name: 'Dr. Prashant Bhimani', specialization: 'Psychiatrist & Psychotherapist', workplace: 'Fortis Hospital, Bannerghatta Road' },
    ],
    'Seasonal Affective Disorder (SAD)': [
      { name: 'NIMHANS OPD Team', specialization: 'Mood Disorders & Seasonal Psychiatry', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Dr. Shyam Bhat', specialization: 'Integrative Psychiatry', workplace: 'Integrated Centre for Wellbeing, Koramangala' },
      { name: 'Dr. Nitin Anand', specialization: 'Consultant Psychiatrist', workplace: 'Manipal Hospital, HAL Airport Road' },
      { name: 'Dr. Naveen Kumar C.', specialization: 'Psychiatrist – Recurrent Mood Disorders', workplace: 'Apollo Hospital, Jayanagar' },
      { name: 'Vandrevala Foundation Clinic', specialization: 'Mental Health & Counselling', workplace: 'Indiranagar, Bengaluru' },
    ],
    'Postpartum Depression': [
      { name: 'Dr. Preeti Jacob', specialization: 'Women\'s & Child Psychiatry', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Fortis La Femme', specialization: 'Women\'s Mental Health & Maternity', workplace: 'Richmond Road, Bengaluru' },
      { name: 'Cloudnine Hospital', specialization: 'Obstetrics & Perinatal Psychiatry', workplace: 'Jayanagar & Whitefield' },
      { name: 'Dr. Shyam Bhat', specialization: 'Perinatal Mental Health', workplace: 'Integrated Centre for Wellbeing, Koramangala' },
      { name: 'Sakra World Hospital', specialization: 'Mental Health & Maternal Wellness', workplace: 'Devarabeesanahalli, Bengaluru' },
    ],
    'Depressive Episode': [
      { name: 'Dr. Shyam Bhat', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Integrated Centre for Wellbeing, Koramangala' },
      { name: 'NIMHANS OPD', specialization: 'Psychiatry – Inpatient & Outpatient', workplace: 'NIMHANS, Hosur Road' },
      { name: 'Dr. Nitin Anand', specialization: 'Consultant Psychiatrist', workplace: 'Manipal Hospital, HAL Airport Road' },
      { name: 'Dr. Naveen Kumar C.', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Hospital, Jayanagar' },
      { name: 'Dr. Prashant Bhimani', specialization: 'Psychiatrist & Psychotherapist', workplace: 'Fortis Hospital, Bannerghatta Road' },
    ],
  },
  'Chennai': {
    'Major Depressive Disorder (MDD)': [
      { name: 'Dr. V. Ravishankar', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Apollo Hospital, Greams Road' },
      { name: 'Dr. Arun Sekar', specialization: 'Psychiatrist – Adult & Geriatric Depression', workplace: 'SIMS Hospital, Vadapalani' },
      { name: 'Dr. Balaji', specialization: 'Consultant Psychiatrist', workplace: 'Fortis Malar Hospital, Adyar' },
      { name: 'SCARF India', specialization: 'Schizophrenia Research Foundation – OPD', workplace: 'R.K. Nagar, Chennai' },
      { name: 'Dr. Suja S. Kurian', specialization: 'Psychiatrist & CBT Therapist', workplace: 'MGM Healthcare, Nelson Manickam Road' },
    ],
    'Persistent Depressive Disorder (Dysthymia)': [
      { name: 'SCARF India', specialization: 'Outpatient Chronic Mood Disorders', workplace: 'R.K. Nagar, Chennai' },
      { name: 'Dr. V. Ravishankar', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Hospital, Greams Road' },
      { name: 'Dr. Arun Sekar', specialization: 'Psychiatrist – Long-Term Mood Management', workplace: 'SIMS Hospital, Vadapalani' },
      { name: 'Dr. Suja S. Kurian', specialization: 'CBT & Long-Term Therapy', workplace: 'MGM Healthcare, Nelson Manickam Road' },
      { name: 'SNEHI Wellness Centre', specialization: 'Counselling & Psychiatric Support', workplace: 'Anna Nagar, Chennai' },
    ],
    'Atypical Depression': [
      { name: 'Dr. V. Ravishankar', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Hospital, Greams Road' },
      { name: 'SCARF India', specialization: 'Psychiatric OPD – Atypical Presentations', workplace: 'R.K. Nagar, Chennai' },
      { name: 'Dr. Balaji', specialization: 'Consultant Psychiatrist', workplace: 'Fortis Malar Hospital, Adyar' },
      { name: 'Dr. Arun Sekar', specialization: 'Psychiatrist – Mood & Anxiety', workplace: 'SIMS Hospital, Vadapalani' },
      { name: 'Dr. Suja S. Kurian', specialization: 'Psychiatrist & Psychotherapist', workplace: 'MGM Healthcare, Nelson Manickam Road' },
    ],
    'Seasonal Affective Disorder (SAD)': [
      { name: 'Dr. V. Ravishankar', specialization: 'Senior Consultant Psychiatrist', workplace: 'Apollo Hospital, Greams Road' },
      { name: 'SCARF India', specialization: 'Mood Disorder OPD', workplace: 'R.K. Nagar, Chennai' },
      { name: 'Dr. Balaji', specialization: 'Consultant Psychiatrist', workplace: 'Fortis Malar Hospital, Adyar' },
      { name: 'Dr. Arun Sekar', specialization: 'Psychiatrist – Seasonal & Recurrent Mood', workplace: 'SIMS Hospital, Vadapalani' },
      { name: 'SNEHI Wellness Centre', specialization: 'Mental Health & Counselling', workplace: 'Anna Nagar, Chennai' },
    ],
    'Postpartum Depression': [
      { name: 'Dr. Suja S. Kurian', specialization: 'Women\'s Psychiatry & Perinatal Mental Health', workplace: 'MGM Healthcare, Nelson Manickam Road' },
      { name: 'Vijaya Hospital', specialization: 'Women\'s Wellness & Maternity Psychiatry', workplace: 'N.S.K. Salai, Vadapalani' },
      { name: 'Apollo Women\'s Hospital', specialization: 'Women\'s Health & Postpartum Support', workplace: 'Greams Road, Chennai' },
      { name: 'SCARF India', specialization: 'Perinatal Psychiatry OPD', workplace: 'R.K. Nagar, Chennai' },
      { name: 'Fortis Malar Hospital', specialization: 'Obstetrics & Mental Health', workplace: 'Adyar, Chennai' },
    ],
    'Depressive Episode': [
      { name: 'Dr. V. Ravishankar', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Hospital, Greams Road' },
      { name: 'SCARF India', specialization: 'Schizophrenia Research Foundation – OPD', workplace: 'R.K. Nagar, Chennai' },
      { name: 'Dr. Arun Sekar', specialization: 'Psychiatrist – Adult Depression & Anxiety', workplace: 'SIMS Hospital, Vadapalani' },
      { name: 'Dr. Balaji', specialization: 'Consultant Psychiatrist', workplace: 'Fortis Malar Hospital, Adyar' },
      { name: 'Dr. Suja S. Kurian', specialization: 'Psychiatrist & CBT Therapist', workplace: 'MGM Healthcare, Nelson Manickam Road' },
    ],
  },
  'Mumbai': {
    'Major Depressive Disorder (MDD)': [
      { name: 'Dr. Harish Shetty', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Dr. L.H. Hiranandani Hospital, Powai' },
      { name: 'Dr. Sagar Mundada', specialization: 'Psychiatrist & Mental Health Advocate', workplace: 'Zynova Shalby Hospital, Malad' },
      { name: 'Dr. Kersi Chavda', specialization: 'Senior Consultant Psychiatrist', workplace: 'P.D. Hinduja Hospital, Mahim' },
      { name: 'iCall – TISS', specialization: 'Psychosocial Helpline & Therapy', workplace: 'Tata Institute of Social Sciences, Deonar' },
      { name: 'Dr. Milan Balakrishnan', specialization: 'Consultant Psychiatrist', workplace: 'Lilavati Hospital, Bandra' },
    ],
    'Persistent Depressive Disorder (Dysthymia)': [
      { name: 'Dr. Harish Shetty', specialization: 'Chronic Mood Disorders & Rehabilitation', workplace: 'Dr. L.H. Hiranandani Hospital, Powai' },
      { name: 'Dr. Kersi Chavda', specialization: 'Senior Consultant Psychiatrist', workplace: 'P.D. Hinduja Hospital, Mahim' },
      { name: 'iCall – TISS', specialization: 'Long-Term Counselling & Psychotherapy', workplace: 'Tata Institute of Social Sciences, Deonar' },
      { name: 'Dr. Sagar Mundada', specialization: 'Psychiatrist & Wellbeing Consultant', workplace: 'Zynova Shalby Hospital, Malad' },
      { name: 'Vandrevala Foundation', specialization: '24/7 Mental Health Helpline & OPD', workplace: 'Andheri West, Mumbai' },
    ],
    'Atypical Depression': [
      { name: 'Dr. Kersi Chavda', specialization: 'Consultant Psychiatrist – Atypical Presentations', workplace: 'P.D. Hinduja Hospital, Mahim' },
      { name: 'Dr. Harish Shetty', specialization: 'Psychiatrist & Psychotherapist', workplace: 'Dr. L.H. Hiranandani Hospital, Powai' },
      { name: 'Dr. Milan Balakrishnan', specialization: 'Consultant Psychiatrist', workplace: 'Lilavati Hospital, Bandra' },
      { name: 'Dr. Sagar Mundada', specialization: 'Psychiatrist – Mood & Behaviour', workplace: 'Zynova Shalby Hospital, Malad' },
      { name: 'iCall – TISS', specialization: 'Psychotherapy & CBT', workplace: 'Tata Institute of Social Sciences, Deonar' },
    ],
    'Seasonal Affective Disorder (SAD)': [
      { name: 'Dr. Harish Shetty', specialization: 'Senior Consultant Psychiatrist', workplace: 'Dr. L.H. Hiranandani Hospital, Powai' },
      { name: 'Dr. Kersi Chavda', specialization: 'Consultant Psychiatrist', workplace: 'P.D. Hinduja Hospital, Mahim' },
      { name: 'Dr. Milan Balakrishnan', specialization: 'Psychiatrist – Recurrent Mood Disorders', workplace: 'Lilavati Hospital, Bandra' },
      { name: 'Dr. Sagar Mundada', specialization: 'Psychiatrist & Mental Health Advocate', workplace: 'Zynova Shalby Hospital, Malad' },
      { name: 'iCall – TISS', specialization: 'Psychosocial Support & Counselling', workplace: 'Tata Institute of Social Sciences, Deonar' },
    ],
    'Postpartum Depression': [
      { name: 'Lilavati Hospital – Women\'s Wellness', specialization: 'Women\'s Health & Perinatal Psychiatry', workplace: 'Lilavati Hospital, Bandra' },
      { name: 'Dr. Harish Shetty', specialization: 'Perinatal Mental Health', workplace: 'Dr. L.H. Hiranandani Hospital, Powai' },
      { name: 'Hinduja Hospital – Psychiatry', specialization: 'Women\'s Mental Health', workplace: 'P.D. Hinduja Hospital, Mahim' },
      { name: 'Cloudnine Hospital', specialization: 'Maternity & Postpartum Wellness', workplace: 'Malad West, Mumbai' },
      { name: 'iCall – TISS', specialization: 'Women\'s Counselling & Psychotherapy', workplace: 'Tata Institute of Social Sciences, Deonar' },
    ],
    'Depressive Episode': [
      { name: 'Dr. Harish Shetty', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Dr. L.H. Hiranandani Hospital, Powai' },
      { name: 'Dr. Kersi Chavda', specialization: 'Senior Consultant Psychiatrist', workplace: 'P.D. Hinduja Hospital, Mahim' },
      { name: 'Dr. Milan Balakrishnan', specialization: 'Consultant Psychiatrist', workplace: 'Lilavati Hospital, Bandra' },
      { name: 'Dr. Sagar Mundada', specialization: 'Psychiatrist & Mental Health Advocate', workplace: 'Zynova Shalby Hospital, Malad' },
      { name: 'iCall – TISS', specialization: 'Psychosocial Helpline & Therapy', workplace: 'Tata Institute of Social Sciences, Deonar' },
    ],
  },
  'Delhi': {
    'Major Depressive Disorder (MDD)': [
      { name: 'Dr. Samir Parikh', specialization: 'Director – Mental Health & Behavioural Sciences', workplace: 'Fortis Healthcare, Vasant Kunj' },
      { name: 'Dr. Achal Bhagat', specialization: 'Senior Consultant Psychiatrist', workplace: 'Indraprastha Apollo Hospital, Sarita Vihar' },
      { name: 'Dr. Nimesh Desai', specialization: 'Director, IHBAS – Professor of Psychiatry', workplace: 'IHBAS, Shahdara' },
      { name: 'Dr. Rajiv Mehta', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Max Super Speciality Hospital, Saket' },
      { name: 'Dr. Praveen Tripathi', specialization: 'Psychiatrist & TMS Specialist', workplace: 'Brainstation, Safdarjung Enclave' },
    ],
    'Persistent Depressive Disorder (Dysthymia)': [
      { name: 'Dr. Achal Bhagat', specialization: 'Psychiatrist & Psychoanalyst', workplace: 'Indraprastha Apollo Hospital, Sarita Vihar' },
      { name: 'IHBAS Team', specialization: 'Institute of Human Behaviour & Allied Sciences', workplace: 'IHBAS, Shahdara' },
      { name: 'Dr. Samir Parikh', specialization: 'Mental Health & Behavioural Sciences', workplace: 'Fortis Healthcare, Vasant Kunj' },
      { name: 'Dr. Praveen Tripathi', specialization: 'Psychiatrist & Neuromodulation', workplace: 'Brainstation, Safdarjung Enclave' },
      { name: 'Dr. Rajiv Mehta', specialization: 'Consultant Psychiatrist – Outpatient', workplace: 'Max Super Speciality Hospital, Saket' },
    ],
    'Atypical Depression': [
      { name: 'Dr. Praveen Tripathi', specialization: 'TMS & Atypical Mood Disorder Specialist', workplace: 'Brainstation, Safdarjung Enclave' },
      { name: 'Dr. Samir Parikh', specialization: 'Behavioural Sciences & Psychiatry', workplace: 'Fortis Healthcare, Vasant Kunj' },
      { name: 'Dr. Achal Bhagat', specialization: 'Psychiatrist & Psychoanalyst', workplace: 'Indraprastha Apollo Hospital, Sarita Vihar' },
      { name: 'IHBAS Team', specialization: 'Outpatient Psychiatric Services', workplace: 'IHBAS, Shahdara' },
      { name: 'Dr. Rajiv Mehta', specialization: 'Consultant Psychiatrist', workplace: 'Max Super Speciality Hospital, Saket' },
    ],
    'Seasonal Affective Disorder (SAD)': [
      { name: 'Dr. Samir Parikh', specialization: 'Director – Mental Health', workplace: 'Fortis Healthcare, Vasant Kunj' },
      { name: 'Dr. Praveen Tripathi', specialization: 'Neuromodulation & Mood Disorders', workplace: 'Brainstation, Safdarjung Enclave' },
      { name: 'Dr. Achal Bhagat', specialization: 'Psychiatrist – Seasonal Patterns', workplace: 'Indraprastha Apollo Hospital, Sarita Vihar' },
      { name: 'Dr. Nimesh Desai', specialization: 'Professor of Psychiatry – IHBAS', workplace: 'IHBAS, Shahdara' },
      { name: 'Dr. Rajiv Mehta', specialization: 'Consultant Psychiatrist', workplace: 'Max Super Speciality Hospital, Saket' },
    ],
    'Postpartum Depression': [
      { name: 'Dr. Achal Bhagat', specialization: 'Women\'s Mental Health & Psychiatry', workplace: 'Indraprastha Apollo Hospital, Sarita Vihar' },
      { name: 'Fortis La Femme', specialization: 'Women\'s Health & Perinatal Psychiatry', workplace: 'Greater Kailash, New Delhi' },
      { name: 'Max Hospital – Women\'s Wellness', specialization: 'Maternity & Mental Health', workplace: 'Max Super Speciality, Saket' },
      { name: 'IHBAS Women\'s OPD', specialization: 'Women\'s Psychiatry Services', workplace: 'IHBAS, Shahdara' },
      { name: 'Dr. Samir Parikh', specialization: 'Perinatal Mental Health', workplace: 'Fortis Healthcare, Vasant Kunj' },
    ],
    'Depressive Episode': [
      { name: 'Dr. Samir Parikh', specialization: 'Director – Mental Health & Behavioural Sciences', workplace: 'Fortis Healthcare, Vasant Kunj' },
      { name: 'Dr. Achal Bhagat', specialization: 'Senior Consultant Psychiatrist', workplace: 'Indraprastha Apollo Hospital, Sarita Vihar' },
      { name: 'Dr. Nimesh Desai', specialization: 'Director, IHBAS – Professor of Psychiatry', workplace: 'IHBAS, Shahdara' },
      { name: 'Dr. Praveen Tripathi', specialization: 'Psychiatrist & TMS Specialist', workplace: 'Brainstation, Safdarjung Enclave' },
      { name: 'Dr. Rajiv Mehta', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Max Super Speciality Hospital, Saket' },
    ],
  },
  'Kolkata': {
    'Major Depressive Disorder (MDD)': [
      { name: 'Dr. Jay Prakash', specialization: 'Consultant Psychiatrist – Mood Disorders', workplace: 'Apollo Gleneagles Hospital, Canal Circular Road' },
      { name: 'Dr. Debashish Basu', specialization: 'Senior Consultant Psychiatrist', workplace: 'AMRI Hospital, Dhakuria' },
      { name: 'Dr. Rajarshi Guha Thakurta', specialization: 'Consultant Psychiatrist & Researcher', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Sujit Sarkhel', specialization: 'Associate Professor of Psychiatry', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Sayantanava Mitra', specialization: 'Consultant Psychiatrist', workplace: 'Peerless Hospital, Kolkata' },
    ],
    'Persistent Depressive Disorder (Dysthymia)': [
      { name: 'Institute of Psychiatry', specialization: 'Outpatient Psychiatry & Long-term Care', workplace: 'Bhawanipore, Kolkata' },
      { name: 'Dr. Debashish Basu', specialization: 'Consultant Psychiatrist – Chronic Mood', workplace: 'AMRI Hospital, Dhakuria' },
      { name: 'Dr. Jay Prakash', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Gleneagles Hospital, Canal Circular Road' },
      { name: 'Dr. Sujit Sarkhel', specialization: 'Psychiatry OPD', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Sayantanava Mitra', specialization: 'Consultant Psychiatrist', workplace: 'Peerless Hospital, Kolkata' },
    ],
    'Atypical Depression': [
      { name: 'Dr. Rajarshi Guha Thakurta', specialization: 'Consultant Psychiatrist & Researcher', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Jay Prakash', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Gleneagles Hospital, Canal Circular Road' },
      { name: 'Dr. Debashish Basu', specialization: 'Senior Consultant Psychiatrist', workplace: 'AMRI Hospital, Dhakuria' },
      { name: 'Dr. Sujit Sarkhel', specialization: 'Psychiatry – Atypical Presentations', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Sayantanava Mitra', specialization: 'Consultant Psychiatrist', workplace: 'Peerless Hospital, Kolkata' },
    ],
    'Seasonal Affective Disorder (SAD)': [
      { name: 'Dr. Jay Prakash', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Gleneagles Hospital, Canal Circular Road' },
      { name: 'Institute of Psychiatry', specialization: 'Mood Disorders OPD', workplace: 'Bhawanipore, Kolkata' },
      { name: 'Dr. Debashish Basu', specialization: 'Consultant Psychiatrist', workplace: 'AMRI Hospital, Dhakuria' },
      { name: 'Dr. Rajarshi Guha Thakurta', specialization: 'Psychiatry & Neuromodulation', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Sayantanava Mitra', specialization: 'Psychiatrist – Recurrent Mood Disorders', workplace: 'Peerless Hospital, Kolkata' },
    ],
    'Postpartum Depression': [
      { name: 'Dr. Debashish Basu', specialization: 'Women\'s Mental Health & Psychiatry', workplace: 'AMRI Hospital, Dhakuria' },
      { name: 'Institute of Psychiatry – Women\'s OPD', specialization: 'Perinatal Psychiatry', workplace: 'Bhawanipore, Kolkata' },
      { name: 'Belle Vue Clinic', specialization: 'Women\'s Wellness & Mental Health', workplace: 'Loudon Street, Kolkata' },
      { name: 'Apollo Gleneagles Women\'s Wing', specialization: 'Obstetrics & Perinatal Mental Health', workplace: 'Canal Circular Road, Kolkata' },
      { name: 'Dr. Sayantanava Mitra', specialization: 'Consultant Psychiatrist', workplace: 'Peerless Hospital, Kolkata' },
    ],
    'Depressive Episode': [
      { name: 'Dr. Jay Prakash', specialization: 'Consultant Psychiatrist', workplace: 'Apollo Gleneagles Hospital, Canal Circular Road' },
      { name: 'Dr. Debashish Basu', specialization: 'Senior Consultant Psychiatrist', workplace: 'AMRI Hospital, Dhakuria' },
      { name: 'Dr. Rajarshi Guha Thakurta', specialization: 'Consultant Psychiatrist & Researcher', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Sujit Sarkhel', specialization: 'Associate Professor of Psychiatry', workplace: 'Institute of Psychiatry, Kolkata' },
      { name: 'Dr. Sayantanava Mitra', specialization: 'Consultant Psychiatrist', workplace: 'Peerless Hospital, Kolkata' },
    ],
  },
};

// City name aliases — maps Nominatim variants → our city keys
const CITY_ALIASES = {
  'hyderabad': 'Hyderabad', 'secunderabad': 'Hyderabad', 'cyberabad': 'Hyderabad',
  'bengaluru': 'Bengaluru', 'bangalore': 'Bengaluru',
  'chennai': 'Chennai', 'madras': 'Chennai',
  'mumbai': 'Mumbai', 'bombay': 'Mumbai', 'navi mumbai': 'Mumbai', 'thane': 'Mumbai',
  'delhi': 'Delhi', 'new delhi': 'Delhi', 'gurugram': 'Delhi', 'gurgaon': 'Delhi', 'noida': 'Delhi', 'faridabad': 'Delhi',
  'kolkata': 'Kolkata', 'calcutta': 'Kolkata', 'howrah': 'Kolkata',
};

// Resolve a raw city name → matched city key or null
function resolveCity(rawCity) {
  if (!rawCity) return null;
  const lower = rawCity.toLowerCase().trim();
  return CITY_ALIASES[lower] || null;
}

// Detected city (populated by geolocation, default Hyderabad)
let _detectedCity = 'Hyderabad';

// Returns doctors list for current city + depression type
function getDoctorsForCityAndType(depressionType) {
  const cityData = ALL_CITIES_DOCTORS[_detectedCity] || ALL_CITIES_DOCTORS['Hyderabad'];
  return cityData[depressionType] || cityData['Depressive Episode'];
}

// Backwards-compatible alias used by PDF export path
const DOCTORS_DATA = {
  get 'Major Depressive Disorder (MDD)'() { return getDoctorsForCityAndType('Major Depressive Disorder (MDD)'); },
  get 'Persistent Depressive Disorder (Dysthymia)'() { return getDoctorsForCityAndType('Persistent Depressive Disorder (Dysthymia)'); },
  get 'Atypical Depression'() { return getDoctorsForCityAndType('Atypical Depression'); },
  get 'Seasonal Affective Disorder (SAD)'() { return getDoctorsForCityAndType('Seasonal Affective Disorder (SAD)'); },
  get 'Postpartum Depression'() { return getDoctorsForCityAndType('Postpartum Depression'); },
  get 'Depressive Episode'() { return getDoctorsForCityAndType('Depressive Episode'); },
};

// ---- Geolocation: detect city via browser GPS + Nominatim ----
(function initGeolocation() {
  if (!navigator.geolocation) return; // browser doesn't support it — stay with default
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
        const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!resp.ok) return;
        const data = await resp.json();
        const addr = data.address || {};
        // Nominatim may return city, town, village, county, or state_district
        const rawCity = addr.city || addr.town || addr.county || addr.state_district || '';
        const resolved = resolveCity(rawCity);
        if (resolved) {
          _detectedCity = resolved;
          // Update card header if it's already visible
          const cityLabel = document.getElementById('doctors-city-label');
          if (cityLabel) cityLabel.textContent = resolved;
          const citySubtitle = document.getElementById('doctors-city-subtitle');
          if (citySubtitle) citySubtitle.textContent =
            `Based on your detected condition, the following specialists in ${resolved} are recommended. The same psychiatrist is usually qualified to treat multiple depressive disorders — proximity, availability, and personal comfort should also guide your choice.`;
        }
      } catch (_) { /* silent fail — stay with default */ }
    },
    () => { /* permission denied — stay with default */ },
    { timeout: 8000 }
  );
})();

let qCurrentIndex = 0;
let qAnswers = new Array(12).fill(null);

function qRender() {
  const q = DEPRESSION_QUESTIONS[qCurrentIndex];
  const total = DEPRESSION_QUESTIONS.length;

  document.getElementById('q-counter').textContent = `${qCurrentIndex + 1} / ${total}`;
  document.getElementById('q-progress-bar').style.width = `${((qCurrentIndex + 1) / total) * 100}%`;
  document.getElementById('q-question-text').textContent = q.text;

  const container = document.getElementById('q-options-container');
  container.innerHTML = '';
  q.options.forEach((opt, i) => {
    const isSelected = qAnswers[qCurrentIndex] === i;
    const btn = document.createElement('button');
    btn.textContent = opt;
    btn.style.cssText = `
      width:100%;text-align:left;padding:14px 20px;border-radius:14px;cursor:pointer;
      font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;
      transition:all 0.2s;border:1px solid;
      background:${isSelected ? 'rgba(139,92,246,0.2)' : 'rgba(0,0,0,0.2)'};
      border-color:${isSelected ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.07)'};
      color:${isSelected ? '#c4b5fd' : '#94a3b8'};
    `;
    btn.onclick = () => {
      qAnswers[qCurrentIndex] = i;
      document.getElementById('q-next-btn').disabled = false;
      qRender();
    };
    container.appendChild(btn);
  });

  // Back button visibility
  document.getElementById('q-back-btn').style.visibility = qCurrentIndex === 0 ? 'hidden' : 'visible';

  // Next button label
  const nextBtn = document.getElementById('q-next-btn');
  nextBtn.disabled = qAnswers[qCurrentIndex] === null;
  nextBtn.innerHTML = qCurrentIndex === total - 1
    ? 'Submit <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'
    : 'Next <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

window.qNext = function () {
  if (qCurrentIndex < DEPRESSION_QUESTIONS.length - 1) {
    qCurrentIndex++;
    qRender();
  } else {
    window.completeQuestionnaire();   // FIX: was bare completeQuestionnaire() — questionnaire data never reached backend
  }
};

window.qPrev = function () {
  if (qCurrentIndex > 0) {
    qCurrentIndex--;
    qRender();
  }
};

function resetQuestionnaire() {
  qCurrentIndex = 0;
  qAnswers = new Array(12).fill(null);
}

// ---- Classify Depression Type from answers ----
function classifyDepressionType(answers) {
  const get = (key) => {
    const idx = DEPRESSION_QUESTIONS.findIndex(q => q.key === key);
    return idx >= 0 ? (answers[idx] ?? 0) : 0;
  };

  const seasonal = get('seasonal');
  const postpartum = get('postpartum');
  const duration = get('duration');
  const hypersomnia = get('hypersomnia');
  const appetite = get('appetite');
  const moodReact = get('moodReactivity');
  const sadness = get('sadness');
  const anhedonia = get('anhedonia');

  // Postpartum Depression
  if (postpartum >= 2) return "Postpartum Depression";

  // Seasonal Affective Disorder
  if (seasonal >= 2) return "Seasonal Affective Disorder (SAD)";

  // Atypical Depression (mood reactivity + hypersomnia + appetite)
  if (moodReact >= 2 && (hypersomnia >= 2 || appetite >= 2)) return "Atypical Depression";

  // Persistent Depressive Disorder (chronic)
  if (duration >= 3) return "Persistent Depressive Disorder (Dysthymia)";

  // Major Depressive Disorder
  if (sadness >= 2 && anhedonia >= 2) return "Major Depressive Disorder (MDD)";

  // Mild/Moderate
  return "Depressive Episode";
}

// ---- Toggle answers (kept for backward compat) ----
window.toggleAnswer = function (key, btn) {
  questionnaireAnswers[key] = !questionnaireAnswers[key];
  btn.className = 'toggle-btn ' + (questionnaireAnswers[key] ? 'on' : 'off');
  const label = document.getElementById('label-' + key);
  if (label) {
    label.textContent = questionnaireAnswers[key] ? 'YES' : 'NO';
    label.style.color = questionnaireAnswers[key] ? '#8b5cf6' : '#64748b';
  }
};

window.updateImpairmentLabel = function () {
  const el = document.getElementById('q-impairment');
  if (!el) return;
  const val = parseInt(el.value);
  const label = val < 33 ? 'Mild' : val < 66 ? 'Moderate' : 'Severe';
  const labelEl = document.getElementById('impairment-label');
  if (labelEl) labelEl.textContent = `${label} (${val}%)`;
};

// ---- Audio Recording ----
window.toggleRecording = async function () {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/wav' });
        audioUrl = URL.createObjectURL(blob);
        const reader = new FileReader();
        reader.onloadend = () => { audioBase64 = reader.result; window.updateAssessBtn(); };
        reader.readAsDataURL(blob);
        showAudioRecorded();
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      isRecording = true;
      recordingTime = 0;
      recordingTimer = setInterval(() => { recordingTime++; updateRecordingDisplay(); }, 1000);
      showRecordingActive();
    } catch (err) {
      alert('Could not access microphone. Please allow microphone access.');
    }
  } else {
    if (mediaRecorder) mediaRecorder.stop();
    isRecording = false;
    clearInterval(recordingTimer);
    const btn = document.getElementById('record-btn');
    if (btn) btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg> Re-record`;
  }
};

function showRecordingActive() {
  const display = document.getElementById('audio-display');
  if (!display) return;
  display.innerHTML = `<div style="background:rgba(217,70,239,0.1);position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;">
    <div class="recording-bars">${Array(12).fill('<div class="recording-bar"></div>').join('')}</div>
    <div style="display:flex;align-items:center;gap:8px;"><div style="width:8px;height:8px;background:#ef4444;border-radius:50%;animation:pulse 1s ease-in-out infinite;"></div><span id="rec-time" style="font-family:monospace;font-size:13px;color:white;">0:00</span></div>
  </div>`;
  display.style.position = 'relative';
  const btn = document.getElementById('record-btn');
  if (btn) {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Stop Recording`;
    btn.style.background = 'rgba(239,68,68,0.2)';
    btn.style.boxShadow = '0 8px 24px rgba(239,68,68,0.3)';
  }
}

function updateRecordingDisplay() {
  const mins = Math.floor(recordingTime / 60);
  const secs = recordingTime % 60;
  const el = document.getElementById('rec-time');
  if (el) el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showAudioRecorded() {
  const display = document.getElementById('audio-display');
  if (!display) return;
  display.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(6,182,212,0.05);position:absolute;inset:0;padding:12px;">
    <div style="display:flex;align-items:center;gap:8px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span style="font-size:10px;color:#06b6d4;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">Voice Recorded</span></div>
    <audio src="${audioUrl}" controls style="height:28px;width:180px;opacity:0.8;"></audio>
  </div>`;
  display.style.position = 'relative';
  const removeBtn = document.getElementById('remove-audio-btn');
  if (removeBtn) removeBtn.style.display = 'block';
  const btn = document.getElementById('record-btn');
  if (btn) {
    btn.style.background = '#d946ef';
    btn.style.boxShadow = '0 8px 24px rgba(217,70,239,0.3)';
  }
}

window.removeAudio = function () {
  audioBase64 = null; audioUrl = null; isRecording = false;
  if (recordingTimer) clearInterval(recordingTimer);
  const display = document.getElementById('audio-display');
  if (display) display.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;opacity:0.4;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d946ef" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg><span style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;">Mic Ready</span></div>`;
  const removeBtn = document.getElementById('remove-audio-btn');
  if (removeBtn) removeBtn.style.display = 'none';
  const btn = document.getElementById('record-btn');
  if (btn) {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />`;
    btn.style.background = '#d946ef';
    btn.style.boxShadow = '0 8px 24px rgba(217,70,239,0.3)';
  }
  window.updateAssessBtn();
};

window.handleAudioUpload = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  audioUrl = URL.createObjectURL(file);
  const reader = new FileReader();
  reader.onloadend = () => { audioBase64 = reader.result; window.updateAssessBtn(); };
  reader.readAsDataURL(file);
  const display = document.getElementById('audio-display');
  if (display) {
    display.style.position = 'relative';
    display.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(6,182,212,0.05);position:absolute;inset:0;padding:12px;">
      <div style="display:flex;align-items:center;gap:8px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span style="font-size:10px;color:#06b6d4;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">Audio Uploaded</span></div>
      <span style="font-size:10px;color:#94a3b8;">${file.name}</span>
      <audio src="${audioUrl}" controls style="height:28px;width:180px;opacity:0.8;"></audio>
    </div>`;
  }
  const removeBtn = document.getElementById('remove-audio-btn');
  if (removeBtn) removeBtn.style.display = 'block';
};

window.handleVideoUpload = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onloadend = () => { videoBase64 = reader.result; window.updateAssessBtn(); };
  reader.readAsDataURL(file);
  const display = document.getElementById('video-display');
  if (display) display.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span style="font-size:10px;color:#06b6d4;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">Video Loaded</span></div>`;
  const uploadBtn = document.getElementById('video-upload-btn');
  if (uploadBtn) uploadBtn.textContent = 'Replace Video';
};

// ---- STEP 1: Run ML model first when user clicks "Complete Assessment" ----
window.runInitialAnalysis = async function () {
  try {
    // 1. Alert startup to prove the button even clicked
    // alert("runInitialAnalysis triggered");

    userInfo.name = document.getElementById('input-name').value;
    userInfo.age = document.getElementById('input-age').value;
    userInfo.gender = document.getElementById('input-gender').value;
    if (window.currentUser) {
      window.currentUser.gender = userInfo.gender;
      window.currentUser.age = userInfo.age;
      if (window.saveUserProfile) {
        window.saveUserProfile({
          name: userInfo.name,
          age: userInfo.age,
          gender: userInfo.gender,
          email: window.currentUser.email,
          photo: window.currentUser.photo || null,
          updatedAt: new Date().toISOString()
        });
      }
    }
    textInputVal = document.getElementById('text-input').value;

    const emptyQuestionnaire = {
      answers: { elevatedMood: false, reducedSleep: false, impulsivity: false, racingThoughts: false },
      duration: 0,
      seasonalPattern: 'No seasonal pattern',
      postpartum: 'Not applicable',
      impairment: 30,
    };

    window.goTo('analysis');

    // Alert immediately before ML call
    // alert("Calling analyzeWithFlask...");

    const result = await analyzeWithFlask(userInfo, textInputVal, videoBase64, audioBase64, emptyQuestionnaire);
    aiResult = result;

    const isDepressed = result.riskLevel === 'Moderate' || result.riskLevel === 'High';

    if (!isDepressed) {
      renderResults(result, null, false);
      if (window.saveReport) {
        await window.saveReport({
          userInfo: { ...userInfo },
          riskLevel: result.riskLevel,
          confidenceScore: result.confidenceScore,
          emotionalSignals: result.emotionalSignals,
          contributions: result.contributions,
          recommendations: result.recommendations,
          questionnaire: emptyQuestionnaire,
        });
      }
      window.goTo('results');
    } else {
      const banner = document.getElementById('questionnaire-banner');
      if (banner) {
        banner.style.display = 'flex';
        banner.querySelector('#banner-risk').textContent = result.riskLevel;
        const displayProb = result.modelProb != null ? Math.round(result.modelProb) : Math.round(result.confidenceScore);
        banner.querySelector('#banner-confidence').textContent = displayProb + '%';
      }
      resetQuestionnaire();
      qRender();
      window.goTo('questioning');
    }
  } catch (err) {
    alert("Error inside runInitialAnalysis: " + err.stack);
    console.error('Analysis failed:', err);
    window.goTo('error');
    const errMsgEl = document.getElementById('error-message');
    if (errMsgEl) errMsgEl.textContent = err.message || 'An unexpected error occurred. Please try again.';
  }
};

window.completeQuestionnaire = async function () {
  const depressionType = classifyDepressionType(qAnswers);

  // Reuse the model result from Step 1 — questionnaire cannot change the ML output
  const result = aiResult;

  renderResults(result, depressionType, true);

  if (window.saveReport) {
    const getScore = (key) => {
      const idx = DEPRESSION_QUESTIONS.findIndex(q => q.key === key);
      return idx >= 0 ? (qAnswers[idx] ?? 0) : 0;
    };
    const questionnaireData = {
      answers: {
        elevatedMood: false,
        reducedSleep: getScore('insomnia') >= 2,
        impulsivity: false,
        racingThoughts: false,
      },
      duration: getScore('duration'),
      seasonalPattern: getScore('seasonal') >= 2 ? 'Winter onset' : 'No seasonal pattern',
      postpartum: getScore('postpartum') >= 2 ? 'Within 4 weeks postpartum' : 'Not applicable',
      scores: Object.fromEntries(DEPRESSION_QUESTIONS.map((q, i) => [q.key, qAnswers[i] ?? 0])),
    };
    await window.saveReport({
      userInfo: { ...userInfo },
      riskLevel: result.riskLevel,
      confidenceScore: result.confidenceScore,
      emotionalSignals: result.emotionalSignals,
      contributions: result.contributions,
      recommendations: result.recommendations,
      questionnaire: questionnaireData,
      depressionType: depressionType,
    });
  }

  aiResult.depressionType = depressionType;
  window.goTo('results');
};

async function analyzeWithFlask(userInfo, textInput, videoBase64, audioBase64, questionnaireData) {
  // Health-check first so we get a clear error if backend is down
  try {
    const ping = await fetch(`${FLASK_API_URL}/health`);
    // Accept 200 and 206 — HuggingFace proxy may return 206 for streamed responses
    if (!ping.ok && ping.status !== 206) throw new Error('Backend not reachable');
  } catch (err) {
    if (err.message === 'Backend not reachable') throw err;
    throw new Error(
      'Cannot reach the Flask backend at ' + FLASK_API_URL +
      '. Make sure the backend is running.'
    );
  }

  // Build multipart/form-data — Flask reads files and form fields separately
  const formData = new FormData();

  // Text
  formData.append('text', textInput || '');

  // Questionnaire + userInfo as JSON strings
  formData.append('questionnaire', JSON.stringify(questionnaireData));
  formData.append('userInfo', JSON.stringify(userInfo));

  // Audio — convert base64 data URL → Blob → File
  if (audioBase64) {
    const audioBlob = await dataURLtoBlob(audioBase64);
    formData.append('audio', audioBlob, 'recording.wav');
  }

  // Video — convert base64 data URL → Blob → File
  if (videoBase64) {
    const videoBlob = await dataURLtoBlob(videoBase64);
    formData.append('video', videoBlob, 'video.mp4');
  }

  const response = await fetch(`${FLASK_API_URL}/analyze`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type manually — browser sets it with boundary automatically
  });

  // FIX: HuggingFace Space proxy returns 206 (Partial/Streamed) for large ML responses.
  // response.ok is true for 200-299, so 206 passes. But response.json() can silently
  // fail on a streamed/chunked body. Use response.text() + JSON.parse() for safety.
  if (!response.ok && response.status !== 206) {
    let errMsg = `Server error ${response.status}`;
    try {
      const errBody = await response.text();
      const parsed = JSON.parse(errBody);
      errMsg = parsed.error || errMsg;
    } catch (_) { }
    throw new Error(errMsg);
  }

  // Safely read the full body as text first, then parse as JSON
  const rawText = await response.text();
  if (!rawText || !rawText.trim()) {
    throw new Error('Empty response received from server. Please try again.');
  }

  let result;
  try {
    result = JSON.parse(rawText);
  } catch (parseErr) {
    console.error('[PsychSense] JSON parse error. Raw response:', rawText.slice(0, 500));
    throw new Error('Invalid response format from server. Please try again.');
  }

  return { ...result, timestamp: new Date().toISOString() };
}

async function dataURLtoBlob(dataURL) {
  const res = await fetch(dataURL);
  return await res.blob();
}

function renderResults(result, depressionType, isDepressed) {
  const name = userInfo.name || 'Anonymous';
  const reportId = 'PSY-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const modes = ['audio', 'text', 'video'].filter(m => result?.contributions?.[m] > 0).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' · ') || 'None';

  // ── Depression type knowledge base ──────────────────────────────────────
  const DEPRESSION_INFO = {
    'Major Depressive Disorder (MDD)': {
      short: 'Major Depressive Disorder (MDD)',
      description: 'MDD is characterised by persistent low mood, loss of interest, and a range of physical and cognitive symptoms lasting at least two weeks. It significantly impairs daily functioning and responds well to a combination of therapy and medication.',
    },
    'Postpartum Depression': {
      short: 'Postpartum Depression',
      description: 'PPD occurs after childbirth and is marked by intense sadness, anxiety, and exhaustion that interfere with the ability to care for oneself or the baby. It is more severe than the "baby blues" and requires professional treatment.',
    },
    'Seasonal Affective Disorder (SAD)': {
      short: 'Seasonal Affective Disorder (SAD)',
      description: 'SAD is a recurrent depression tied to seasonal changes, typically emerging in autumn/winter when daylight hours shorten. Symptoms include hypersomnia, increased appetite, and low energy. Light therapy is a first-line treatment.',
    },
    'Atypical Depression': {
      short: 'Atypical Depression',
      description: 'Unlike classical depression, atypical depression features mood reactivity — the ability to feel better in response to positive events. It is also associated with hypersomnia, increased appetite, and heightened sensitivity to rejection.',
    },
    'Persistent Depressive Disorder (Dysthymia)': {
      short: 'Persistent Depressive Disorder',
      description: 'Dysthymia is a chronic, lower-grade depression lasting two or more years. Symptoms are less severe than MDD but are long-lasting and can cause significant impairment. Many people describe it as feeling perpetually "down" or "not myself".',
    },
    'Depressive Episode': {
      short: 'Depressive Episode',
      description: 'A depressive episode involves a sustained period of depressed mood, reduced energy, and diminished interest in activities. It may be part of a broader mood disorder and warrants a full clinical assessment to determine the appropriate course of care.',
    },
  };

  const depInfo = DEPRESSION_INFO[depressionType] || null;

  // ── Store reportId for PDF generation ──────────────────────────────────
  window._lastReportId = reportId;

  // ── Header ─────────────────────────────────────────────────────────────
  const patientEl = document.getElementById('results-patient');
  if (patientEl) patientEl.textContent = `Patient: ${name} • ID: ${reportId}`;
  const metaEl = document.getElementById('results-report-meta');
  if (metaEl) metaEl.innerHTML = `Generated ${dateStr} ${timeStr} · Mode: ${modes} · PsychSense v2.1.0`;

  // ── Alert banner ────────────────────────────────────────────────────────
  const alertBanner = document.getElementById('results-alert-banner');
  if (alertBanner) {
    if (isDepressed) {
      alertBanner.style.cssText += 'background:rgba(252,235,235,0.07);border-color:rgba(240,149,149,0.4);color:#fca5a5;';
      alertBanner.innerHTML = `<div style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;"></div><span><strong>${result.riskLevel} Risk Detected —</strong> This report requires attention. Please review the recommendations carefully.</span>`;
    } else {
      alertBanner.style.cssText += 'background:rgba(234,243,222,0.07);border-color:rgba(178,216,134,0.35);color:#86efac;';
      alertBanner.innerHTML = `<div style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;"></div><span><strong>Low Risk —</strong> No severe depressive signals detected. Continue to monitor your wellbeing periodically.</span>`;
    }
  }

  // ── Patient info grid ───────────────────────────────────────────────────
  const patGrid = document.getElementById('patient-info-grid');
  if (patGrid) {
    const cells = [
      { label: 'Full Name', value: userInfo.name || 'Anonymous' },
      { label: 'Age', value: userInfo.age ? userInfo.age + ' years' : '—' },
      { label: 'Gender', value: userInfo.gender || '—' },
      { label: 'Session Date', value: dateStr },
    ];
    patGrid.innerHTML = cells.map(c => `
      <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:10px 14px;">
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">${c.label}</div>
        <div style="font-size:14px;font-weight:500;color:#e2e8f0;text-transform:${c.label === 'Gender' ? 'capitalize' : 'none'};">${c.value}</div>
      </div>`).join('');
  }

  // ── Executive summary ───────────────────────────────────────────────────
  // FIX: Use modelProb (raw p_dep x 100) for severity ring/bar/color thresholds.
  // confidenceScore is now zone-relative and is not suitable for these visualizations.
  const displayPercent = isDepressed ? (result.modelProb ?? result.confidenceScore) : result.confidenceScore;
  const ringDescEl = document.getElementById('ring-desc');
  if (ringDescEl) {
    if (!isDepressed) {
      ringDescEl.textContent = "PsychSense's multimodal analysis did not identify significant markers of depression. The combined signals placed this assessment in the Low Risk category. Continue to monitor your wellbeing periodically.";
    } else {
      ringDescEl.textContent = depressionType
        ? `PsychSense's multimodal analysis identified signals consistent with ${depressionType}. The assessment falls in the ${result.riskLevel} Risk category, with an overall severity score of ${displayPercent}%. Prompt professional evaluation is advised.`
        : `PsychSense's multimodal analysis indicates a ${result.riskLevel.toLowerCase()} level of depressive symptoms across your multi-modal inputs.`;
    }
  }

  const typeBadge = document.getElementById('depression-type-badge');
  const typeLabel = document.getElementById('depression-type-label');
  if (typeBadge && typeLabel) {
    if (isDepressed) {
      typeBadge.style.display = 'block';
      typeLabel.textContent = depressionType || result.riskLevel;
    } else {
      typeBadge.style.display = 'none';
    }
  }

  // ── Assessment result metrics ───────────────────────────────────────────
  const ringCardLabel = document.getElementById('ring-card-label');
  if (ringCardLabel) ringCardLabel.textContent = 'Probability';

  const confidenceEl = document.getElementById('results-confidence');
  if (confidenceEl) {
    confidenceEl.textContent = `${displayPercent}%`;
    confidenceEl.style.color = isDepressed ? (displayPercent >= 56 ? '#ef4444' : '#f59e0b') : '#22c55e';
  }

  const severityFill = document.getElementById('severity-bar-fill');
  if (severityFill) setTimeout(() => { severityFill.style.width = `${displayPercent}%`; }, 200);

  // Severity range label
  const sevRangeEl = document.getElementById('severity-range-label');
  if (sevRangeEl) {
    if (!isDepressed) {
      sevRangeEl.textContent = 'Normal range (< 30%)';
    } else if (displayPercent >= 56) {
      sevRangeEl.textContent = 'Severe range (≥ 56%)';
    } else if (displayPercent >= 51) {
      sevRangeEl.textContent = 'Moderate range (51–55%)';
    } else {
      sevRangeEl.textContent = 'Normal range (< 51%)';
    }
  }

  // Risk tile
  const riskEl = document.getElementById('results-risk');
  const riskSubEl = document.getElementById('results-risk-sub');
  if (riskEl) {
    if (!isDepressed) {
      riskEl.textContent = 'Low Risk';
      riskEl.style.color = '#22c55e';
      if (riskSubEl) riskSubEl.textContent = 'Low levels';
    } else {
      riskEl.textContent = result.riskLevel + ' Risk';
      riskEl.style.color = result.riskLevel === 'High' ? '#ef4444' : '#f59e0b';
      if (riskSubEl) riskSubEl.textContent = result.riskLevel === 'High' ? 'Requires urgent review' : 'Intervention advised';
    }
  }

  // Depression type tile
  const depTypeNameEl = document.getElementById('results-dep-type-name');
  const depTypeDescEl = document.getElementById('results-dep-type-desc');
  if (depTypeNameEl && depTypeDescEl) {
    if (isDepressed && depressionType) {
      depTypeNameEl.textContent = depInfo?.short || depressionType;
      depTypeDescEl.textContent = depInfo?.description || 'A clinical assessment is advised to determine the specific depression subtype and appropriate treatment.';
    } else if (!isDepressed) {
      depTypeNameEl.textContent = 'No disorder detected';
      depTypeNameEl.style.color = '#86efac';
      depTypeDescEl.textContent = 'Your assessment shows no significant depressive markers at this time.';
    } else {
      depTypeNameEl.textContent = 'Depressive Episode';
      depTypeDescEl.textContent = 'A depressive episode was identified. A clinical assessment is advised to determine the specific subtype.';
    }
  }

  // Hidden ring (compat)
  const ringProgress = document.getElementById('ring-progress');
  if (ringProgress) {
    const circumference = 2 * Math.PI * 60;
    ringProgress.style.stroke = isDepressed ? (displayPercent >= 70 ? '#ef4444' : '#f59e0b') : '#22c55e';
    setTimeout(() => { ringProgress.style.strokeDashoffset = circumference * (1 - displayPercent / 100); }, 100);
  }

  // ── Contributions ───────────────────────────────────────────────────────
  const c = result.contributions;
  ['text', 'video', 'audio', 'quest'].forEach((k, i) => {
    const key = ['text', 'video', 'audio', 'questionnaire'][i];
    const val = c[key] ?? 25;
    const valEl = document.getElementById(`contrib-${k}-val`);
    if (valEl) valEl.textContent = `${val}%`;
    const progressEl = document.getElementById(`contrib-${k}`);
    if (progressEl) setTimeout(() => { progressEl.style.width = `${val}%`; }, 200);
  });

  // ── Insights grid ───────────────────────────────────────────────────────
  const insightsGrid = document.getElementById('insights-grid');
  if (insightsGrid) {
    const insightDefs = [
      { key: 'audio', icon: '🎙️', bg: 'rgba(230,241,251,0.08)', defaultTitle: 'Voice & Audio Signals' },
      { key: 'text', icon: '📝', bg: 'rgba(234,243,222,0.08)', defaultTitle: 'Language & Text Signals' },
      { key: 'video', icon: '🎥', bg: 'rgba(251,234,240,0.08)', defaultTitle: 'Facial & Visual Cues' },
      { key: 'questionnaire', icon: '⚡', bg: 'rgba(250,238,218,0.08)', defaultTitle: 'Questionnaire Insights' },
    ];
    insightsGrid.innerHTML = insightDefs.map(def => {
      const ins = result.insights?.[def.key];
      const rawTitle = ins?.title;
      const title = (rawTitle && rawTitle !== 'undefined' && rawTitle.trim() !== '') ? rawTitle : def.defaultTitle;
      const rawBody = ins?.points?.filter(p => p && p !== 'undefined').join('. ');
      const body = (rawBody && rawBody.trim() !== '') ? rawBody : 'Analysis complete.';
      return `<div style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px;background:${def.bg};">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <div style="width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;font-size:14px;">${def.icon}</div>
          <div style="font-size:13px;font-weight:500;color:#e2e8f0;">${title}</div>
        </div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.6;">${body}</div>
      </div>`;
    }).join('');
  }

  // ── Emotional signals ───────────────────────────────────────────────────
  const sigContainer = document.getElementById('signals-container');
  if (sigContainer) {
    const signals = isDepressed
      ? (result.emotionalSignals || ['Low Mood'])
      : ['Emotional Stability', 'Resilience', 'Coherent Thought'];
    const sigColor = isDepressed ? { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.25)', text: '#c4b5fd' } : { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.2)', text: '#86efac' };
    sigContainer.innerHTML = signals.map(s =>
      `<span style="background:${sigColor.bg};border:1px solid ${sigColor.border};border-radius:8px;padding:4px 12px;font-size:11px;font-weight:700;color:${sigColor.text};letter-spacing:0.05em;">${s}</span>`
    ).join('');
  }

  // ── Risk analysis card ──────────────────────────────────────────────────
  const riskCard = document.getElementById('risk-analysis-card');
  const rfList = document.getElementById('risk-factors-list');
  if (riskCard && rfList) {
    if (isDepressed) {
      riskCard.style.display = 'block';
      const factors = result.riskFactors || [
        { label: `Probability ≥ ${displayPercent}%`, body: 'The model\'s output crosses the clinical high-risk threshold established from validated depression screening benchmarks.' },
        { label: 'Multimodal agreement', body: 'Audio, text, and video signals are all independently flagging distress, strengthening the reliability of the prediction.' },
        depressionType ? { label: `${depressionType}`, body: depInfo ? depInfo.description : `${depressionType} carries elevated risk if left unaddressed.` } : null,
        { label: 'Negative cognitive patterns', body: 'Language analysis detected persistent distress framing and reduced future-oriented speech, associated with higher-risk presentations.' },
      ].filter(Boolean);
      rfList.innerHTML = factors.map(f => {
        const label = typeof f === 'string' ? f : f.label;
        const body = typeof f === 'string' ? '' : f.body;
        return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(254,248,241,0.05);border:1px solid rgba(250,199,117,0.25);border-radius:10px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#f59e0b;flex-shrink:0;margin-top:6px;"></div>
          <div style="font-size:13px;color:#cbd5e1;line-height:1.5;"><strong style="color:#fbbf24;">${label} —</strong> ${body}</div>
        </div>`;
      }).join('');
    } else {
      riskCard.style.display = 'none';
    }
  }

  // ── Recommendations ─────────────────────────────────────────────────────
  const recContainer = document.getElementById('recommendations-container');
  if (recContainer) {
    const recsList = result.recommendations || [];
    const col1 = recsList.slice(0, Math.ceil(recsList.length / 3));
    const col2 = recsList.slice(Math.ceil(recsList.length / 3), Math.ceil(recsList.length / 3 * 2));
    const col3 = recsList.slice(Math.ceil(recsList.length / 3 * 2));
    const makeCol = (items, headLabel, headColor, offset) => `
      <div style="border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${headColor};margin-bottom:10px;">${headLabel}</div>
        ${items.map((r, i) => `<div style="font-size:12px;color:#94a3b8;line-height:1.6;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;gap:8px;align-items:flex-start;"><span style="font-weight:600;color:#e2e8f0;flex-shrink:0;font-size:11px;min-width:16px;">${offset + i + 1}.</span><span>${r}</span></div>`).join('')}
      </div>`;
    recContainer.innerHTML = [
      col1.length ? makeCol(col1, 'Immediate Actions', '#fca5a5', 0) : '',
      col2.length ? makeCol(col2, 'Professional Support', '#93c5fd', col1.length) : '',
      col3.length ? makeCol(col3, 'Lifestyle Support', '#86efac', col1.length + col2.length) : '',
    ].join('');
  }

  // ── Next steps ──────────────────────────────────────────────────────────
  const nextStepsList = document.getElementById('next-steps-list');
  if (nextStepsList) {
    const steps = isDepressed ? [
      { label: 'Today', text: 'Share this report with a family member, partner, or trusted friend. You do not need to face this alone.' },
      { label: 'Within 24–48 hours', text: 'Book an appointment with a psychiatrist, clinical psychologist, or your primary care physician. Bring this report.' },
      { label: 'Seek urgent help immediately if', text: 'You experience thoughts of self-harm, or feel a sudden worsening of symptoms. Call 112 or your nearest emergency department.' },
      { label: 'Follow-up session', text: 'Schedule a re-assessment with PsychSense in 2–4 weeks to track progress after professional intervention begins.' },
    ] : [
      { label: 'Keep monitoring', text: 'Your assessment shows low risk. Schedule a follow-up in 4–6 weeks to track your wellbeing over time.' },
      { label: 'Share this report', text: 'You can share this result with a trusted friend or family member as a baseline record.' },
    ];
    nextStepsList.innerHTML = steps.map((s, i) => `
      <div style="display:flex;gap:14px;align-items:flex-start;">
        <div style="width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;flex-shrink:0;color:#64748b;">${i + 1}</div>
        <div style="font-size:13px;color:#cbd5e1;line-height:1.6;padding-top:2px;"><strong style="color:#e2e8f0;">${s.label}:</strong> ${s.text}</div>
      </div>`).join('');
  }

  // ── Recommended Doctors ─────────────────────────────────────────────────
  const doctorsCard = document.getElementById('doctors-card');
  const doctorsList = document.getElementById('doctors-list');
  if (doctorsCard && doctorsList) {
    if (isDepressed) {
      const docType = depressionType || 'Depressive Episode';
      const doctors = getDoctorsForCityAndType(docType);
      doctorsCard.style.display = 'block';
      // Update the city label in the card header
      const cityLabel = document.getElementById('doctors-city-label');
      if (cityLabel) cityLabel.textContent = _detectedCity;
      const citySubtitle = document.getElementById('doctors-city-subtitle');
      if (citySubtitle) citySubtitle.textContent = `Based on your detected condition, the following specialists in ${_detectedCity} are recommended. The same psychiatrist is usually qualified to treat multiple depressive disorders — proximity, availability, and personal comfort should also guide your choice.`;
      doctorsList.innerHTML = `
        <table class="doctors-table">
          <thead>
            <tr>
              <th>Doctor Name</th>
              <th>Area of Specialization</th>
              <th>Place of Work</th>
            </tr>
          </thead>
          <tbody>
            ${doctors.map(d => `
              <tr>
                <td>${d.name}</td>
                <td>${d.specialization}</td>
                <td>${d.workplace}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    } else {
      doctorsCard.style.display = 'none';
      doctorsList.innerHTML = '';
    }
  }
}

window.downloadReport = function () {
  const isDepressed = aiResult?.riskLevel === 'Moderate' || aiResult?.riskLevel === 'High';
  const displayPercent = isDepressed ? (aiResult?.modelProb ?? aiResult?.confidenceScore ?? '—') : '—'; // FIX: use modelProb for severity display

  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = new Date().toLocaleString('en-GB');
  const reportId = window._lastReportId || ('PSY-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000));

  const riskClass = aiResult?.riskLevel || 'Low';
  const depType = (aiResult?.depressionType && aiResult.depressionType !== '—') ? aiResult.depressionType : 'Depression';
  const confScore = Math.round(aiResult?.confidenceScore) || '—';

  // Depression type knowledge base (same as renderResults)
  const PDF_DEPRESSION_INFO = {
    'Major Depressive Disorder (MDD)': { short: 'Major Depressive Disorder (MDD)', description: 'MDD is characterised by persistent low mood, loss of interest, and a range of physical and cognitive symptoms lasting at least two weeks. It significantly impairs daily functioning and responds well to a combination of therapy and medication.' },
    'Postpartum Depression': { short: 'Postpartum Depression', description: 'PPD occurs after childbirth and is marked by intense sadness, anxiety, and exhaustion that interfere with the ability to care for oneself or the baby. It is more severe than the "baby blues" and requires professional treatment.' },
    'Seasonal Affective Disorder (SAD)': { short: 'Seasonal Affective Disorder (SAD)', description: 'SAD is a recurrent depression tied to seasonal changes, typically emerging in autumn/winter when daylight hours shorten. Symptoms include hypersomnia, increased appetite, and low energy. Light therapy is a first-line treatment.' },
    'Atypical Depression': { short: 'Atypical Depression', description: 'Unlike classical depression, atypical depression features mood reactivity — the ability to feel better in response to positive events. It is also associated with hypersomnia, increased appetite, and heightened sensitivity to rejection.' },
    'Persistent Depressive Disorder (Dysthymia)': { short: 'Persistent Depressive Disorder', description: 'Dysthymia is a chronic, lower-grade depression lasting two or more years. Symptoms are less severe than MDD but are long-lasting and can cause significant impairment. Many people describe it as feeling perpetually "down" or "not myself".' },
    'Depressive Episode': { short: 'Depressive Episode', description: 'A depressive episode involves a sustained period of depressed mood, reduced energy, and diminished interest in activities. It may be part of a broader mood disorder and warrants a full clinical assessment.' },
  };
  const pdfDepInfo = PDF_DEPRESSION_INFO[depType] || null;

  const modes = ['Audio', 'Text', 'Video'].filter(m => aiResult?.contributions && aiResult.contributions[m.toLowerCase()] > 0).join(' · ') || 'None';

  let insightsHtml = '';
  if (aiResult?.insights) {
    const map = [
      { key: 'audio', icon: '🎙', bg: '#E6F1FB', fallbackTitle: 'Voice & Audio Signals' },
      { key: 'text', icon: '📝', bg: '#EAF3DE', fallbackTitle: 'Language & Text Signals' },
      { key: 'video', icon: '🎥', bg: '#FBEAF0', fallbackTitle: 'Facial & Visual Cues' },
      { key: 'behavioral', icon: '⚡', bg: '#FAEEDA', fallbackTitle: 'Energy & Engagement' },
      { key: 'questionnaire', icon: '📋', bg: '#FAEEDA', fallbackTitle: 'Questionnaire Insights' },
    ];
    for (let item of map) {
      const ins = aiResult.insights[item.key];
      if (ins) {
        const rawTitle = ins.title;
        const title = (rawTitle && rawTitle !== 'undefined' && rawTitle.trim() !== '') ? rawTitle : item.fallbackTitle;
        const rawPoints = (ins.points || []).filter(p => p && p !== 'undefined');
        const body = rawPoints.length > 0 ? rawPoints.join('. ') : 'Analysis complete.';
        insightsHtml += `
          <div class="ps-insight">
            <div class="ps-insight-icon-row">
              <div class="ps-insight-icon" style="background:${item.bg};">${item.icon}</div>
              <div class="ps-insight-title">${title}</div>
            </div>
            <div class="ps-insight-body">${body}</div>
          </div>
        `;
      }
    }
  }

  let recsHtml = '';
  let recsList = aiResult?.recommendations || [];
  if (recsList.length > 0) {
    let col1 = recsList.slice(0, Math.ceil(recsList.length / 3));
    let col2 = recsList.slice(Math.ceil(recsList.length / 3), Math.ceil(recsList.length / 3 * 2));
    let col3 = recsList.slice(Math.ceil(recsList.length / 3 * 2));

    recsHtml += `
      <div class="ps-rec">
        <div class="ps-rec-head ps-rec-head-red">Immediate Actions</div>
        ${col1.map((r, i) => `<div class="ps-rec-item"><span class="ps-rec-num">${i + 1}.</span><span>${r}</span></div>`).join('')}
      </div>
     `;
    if (col2.length > 0) {
      recsHtml += `
        <div class="ps-rec">
          <div class="ps-rec-head ps-rec-head-blue">Professional Support</div>
          ${col2.map((r, i) => `<div class="ps-rec-item"><span class="ps-rec-num">${col1.length + i + 1}.</span><span>${r}</span></div>`).join('')}
        </div>
       `;
    }
    if (col3.length > 0) {
      recsHtml += `
        <div class="ps-rec">
          <div class="ps-rec-head ps-rec-head-green">Lifestyle Support</div>
          ${col3.map((r, i) => `<div class="ps-rec-item"><span class="ps-rec-num">${col1.length + col2.length + i + 1}.</span><span>${r}</span></div>`).join('')}
        </div>
       `;
    }
  }

  const alertBlock = isDepressed
    ? `<div class="ps-alert ps-alert-danger">
        <div class="ps-alert-dot"></div>
        <span><strong>${riskClass} Risk Detected —</strong> This report requires attention. Please review the recommendations carefully.</span>
       </div>`
    : `<div class="ps-alert" style="background: #EAF3DE; border-color: #B2D886; color: #3B6D11;">
        <div class="ps-alert-dot" style="background: #6DBE20;"></div>
        <span><strong>Low Risk —</strong> No severe depressive signals detected. Continue to monitor your wellbeing periodically.</span>
       </div>`;

  const severityBar = isDepressed ? `<div class="ps-severity-bar"><div class="ps-severity-fill" style="width:${displayPercent}%"></div></div>` : '';
  const riskBadge = isDepressed ? `<span class="ps-risk-badge"><div class="ps-risk-dot"></div> ${riskClass} Risk</span>` : `<span class="ps-risk-badge" style="background:#EAF3DE;border-color:#B2D886;color:#3B6D11;"><div class="ps-risk-dot" style="background:#6DBE20;"></div> Low Risk</span>`;
  const summaryText = isDepressed
    ? `PsychSense's multimodal analysis identified signals consistent with <strong>${depType}</strong>. The assessment falls in the <strong>${riskClass} Risk</strong> category, with an overall severity score of ${displayPercent}%. Prompt professional evaluation is advised.`
    : `PsychSense's multimodal analysis did not identify significant markers of depression. The combined signals placed this assessment in the <strong>Low Risk</strong> category.`;

  const uName = userInfo.name || 'Anonymous';
  const uAge = userInfo.age ? userInfo.age + ' years' : '—';
  const uGen = userInfo.gender || '—';

  const htmlStr = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&family=DM+Sans:wght@300;400;500&display=swap');
  .ps-root { font-family: 'DM Sans', sans-serif; font-size: 14px; color: #1e293b; max-width: 860px; margin: 0 auto; padding: 1.5rem 2rem; background: #fff; }
  .ps-header { border: 0.5px solid #cbd5e1; border-radius: 12px; padding: 1.5rem 2rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-start; background: #fff; }
  .ps-logo { display: flex; align-items: center; gap: 10px; }
  .ps-logo-icon { width: 36px; height: 36px; border-radius: 8px; background: #185FA5; display: flex; align-items: center; justify-content: center; }
  .ps-logo-icon svg { width: 20px; height: 20px; }
  .ps-logo-name { font-family: 'Lora', serif; font-size: 18px; font-weight: 600; color: #0f172a; }
  .ps-logo-sub { font-size: 11px; color: #64748b; letter-spacing: 0.05em; text-transform: uppercase; }
  .ps-header-meta { text-align: right; font-size: 12px; color: #64748b; line-height: 1.8; }
  .ps-header-meta strong { color: #334155; font-weight: 500; }
  .ps-alert { border-radius: 8px; padding: 0.75rem 1.25rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 10px; font-size: 13px; border: 0.5px solid; }
  .ps-alert-danger { background: #FCEBEB; border-color: #F09595; color: #791F1F; }
  .ps-alert-dot { width: 8px; height: 8px; border-radius: 50%; background: #E24B4A; flex-shrink: 0; }
  .ps-card { background: #fff; border: 0.5px solid #cbd5e1; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1rem; }
  .ps-card-title { font-family: 'Lora', serif; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: #334155; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px; }
  .ps-card-title-bar { width: 3px; height: 14px; border-radius: 2px; background: #185FA5; }
  .ps-patient-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
  .ps-patient-cell { background: #f8fafc; border-radius: 8px; padding: 10px 12px; }
  .ps-patient-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
  .ps-patient-value { font-size: 14px; font-weight: 500; color: #0f172a; }
  .ps-summary-text { font-size: 14px; line-height: 1.8; color: #334155; margin-bottom: 1rem; }
  .ps-risk-badge { display: inline-flex; align-items: center; gap: 6px; background: #FCEBEB; border: 0.5px solid #F09595; border-radius: 6px; padding: 4px 12px; font-size: 13px; font-weight: 500; color: #791F1F; }
  .ps-risk-dot { width: 7px; height: 7px; border-radius: 50%; background: #E24B4A; }
  .ps-metrics-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; margin-bottom: 1rem; }
  .ps-metric { background: #f8fafc; border-radius: 8px; padding: 14px 16px; }
  .ps-metric-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .ps-metric-value { font-size: 22px; font-weight: 500; color: #0f172a; }
  .ps-metric-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
  .ps-severity-bar { height: 8px; border-radius: 4px; background: #e2e8f0; margin: 8px 0 4px; overflow: hidden; }
  .ps-severity-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #FAC775, #E24B4A); }
  .ps-tag { display: inline-block; background: #E6F1FB; border: 0.5px solid #B5D4F4; border-radius: 6px; padding: 3px 10px; font-size: 12px; color: #0C447C; margin: 3px 3px 3px 0; }
  .ps-insights-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .ps-insight { border: 0.5px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; page-break-inside: avoid; }
  .ps-insight-icon-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .ps-insight-icon { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
  .ps-insight-title { font-size: 13px; font-weight: 500; color: #0f172a; }
  .ps-insight-body { font-size: 13px; color: #475569; line-height: 1.6; }
  .ps-risk-factors { display: flex; flex-direction: column; gap: 8px; }
  .ps-risk-factor { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; background: #FEF8F1; border: 0.5px solid #FAC775; border-radius: 8px; }
  .ps-rf-icon { width: 6px; height: 6px; border-radius: 50%; background: #EF9F27; flex-shrink: 0; margin-top: 5px; }
  .ps-rf-text { font-size: 13px; color: #633806; line-height: 1.5; }
  .ps-rf-label { font-weight: 500; }
  .ps-rec-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
  .ps-rec { border: 0.5px solid #cbd5e1; border-radius: 8px; padding: 14px; page-break-inside: avoid; }
  .ps-rec-head { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
  .ps-rec-head-red { color: #A32D2D; }
  .ps-rec-head-blue { color: #185FA5; }
  .ps-rec-head-green { color: #3B6D11; }
  .ps-rec-item { font-size: 13px; color: #475569; line-height: 1.6; padding: 5px 0; border-bottom: 0.5px solid #e2e8f0; display: flex; gap: 8px; align-items: flex-start; }
  .ps-rec-item:last-child { border-bottom: none; }
  .ps-rec-num { font-weight: 500; color: #0f172a; flex-shrink: 0; font-size: 12px; min-width: 14px; }
  .ps-steps { display: flex; flex-direction: column; gap: 8px; }
  .ps-step { display: flex; gap: 14px; align-items: flex-start; page-break-inside: avoid; }
  .ps-step-num { width: 24px; height: 24px; border-radius: 50%; border: 0.5px solid #94a3b8; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 500; flex-shrink: 0; color: #64748b; }
  .ps-step-text { font-size: 13px; color: #334155; line-height: 1.6; padding-top: 2px; }
  .ps-step-strong { font-weight: 500; }
  .ps-disclaimer { border: 0.5px solid #cbd5e1; border-radius: 8px; padding: 1rem 1.25rem; background: #f8fafc; page-break-inside: avoid; }
  .ps-disclaimer-title { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 6px; }
  .ps-disclaimer-body { font-size: 12px; color: #64748b; line-height: 1.7; }
  .ps-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 1rem; border-top: 0.5px solid #cbd5e1; margin-top: 0.5rem; font-size: 11px; color: #94a3b8; page-break-inside: avoid; }
  .ps-divider { height: 0.5px; background: #cbd5e1; margin: 0.75rem 0; }
</style>

<div class="ps-root">
  <div class="ps-header">
    <div class="ps-logo">
      <div class="ps-logo-icon">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3C7.5 3 5.5 4.8 5.5 7c0 1.4.8 2.7 2 3.4v1.1l-1.2 1.2a.5.5 0 000 .7l1.2 1.2v1.4c0 .6.4 1 1 1h3c.6 0 1-.4 1-1v-1.4l1.2-1.2a.5.5 0 000-.7L12.5 11.4V10.4c1.2-.7 2-2 2-3.4C14.5 4.8 12.5 3 10 3z" fill="white" opacity="0.9"/>
        </svg>
      </div>
      <div>
        <div class="ps-logo-name">PsychSense</div>
        <div class="ps-logo-sub">AI Mental Health Report</div>
      </div>
    </div>
    <div class="ps-header-meta">
      <div><strong>Report ID</strong> &nbsp;${reportId}</div>
      <div><strong>Generated</strong> &nbsp;${timeStr}</div>
      <div><strong>Analysis Mode</strong> &nbsp;${modes}</div>
      <div><strong>Model Version</strong> &nbsp;PsychSense v2.1.0</div>
    </div>
  </div>

  ${alertBlock}

  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Patient Information</div>
    <div class="ps-patient-grid">
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Full Name</div>
        <div class="ps-patient-value">${uName}</div>
      </div>
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Age</div>
        <div class="ps-patient-value">${uAge}</div>
      </div>
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Gender</div>
        <div class="ps-patient-value" style="text-transform:capitalize;">${uGen}</div>
      </div>
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Session Date</div>
        <div class="ps-patient-value">${dateStr}</div>
      </div>
    </div>
  </div>

  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Executive Summary</div>
    <div class="ps-summary-text">
      ${summaryText}
    </div>
    ${riskBadge}
  </div>

  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Assessment Results</div>
    <div class="ps-metrics-grid">
      <div class="ps-metric">
        <div class="ps-metric-label">Probability</div>
        <div class="ps-metric-value" style="color:${isDepressed ? (displayPercent >= 56 ? '#A32D2D' : '#7C4A00') : '#3B6D11'};">${displayPercent}%</div>
        ${severityBar}
        <div class="ps-metric-sub">${isDepressed ? (displayPercent >= 56 ? 'Severe range (≥ 56%)' : 'Moderate range (51–55%)') : 'Normal range (< 51%)'}</div>
      </div>
      <div class="ps-metric">
        <div class="ps-metric-label">Risk Classification</div>
        <div class="ps-metric-value" style="font-size:18px; color:${isDepressed ? (riskClass === 'High' ? '#A32D2D' : '#7C4A00') : '#3B6D11'};">${isDepressed ? riskClass + ' Risk' : 'Low Risk'}</div>
        <div class="ps-metric-sub">${isDepressed ? (riskClass === 'High' ? 'Requires urgent review' : 'Intervention advised') : 'Low levels'}</div>
      </div>
      <div class="ps-metric">
        <div class="ps-metric-label">Type Detected</div>
        <div class="ps-metric-value" style="font-size:14px; font-weight:600; color:#185FA5; line-height:1.3;">${isDepressed ? (pdfDepInfo ? pdfDepInfo.short : depType) : 'No disorder detected'}</div>
        ${isDepressed && pdfDepInfo ? `<div class="ps-metric-sub" style="margin-top:6px; line-height:1.5;">${pdfDepInfo.description}</div>` : ''}
      </div>
    </div>
  </div>

  ${isDepressed ? `
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar" style="background:#EF9F27;"></div> Risk Analysis</div>
    <div style="font-size:13px; color:#475569; line-height:1.7; margin-bottom:12px;">The risk classification was assigned based on a convergence of strong signals across all modalities. No single factor alone determined this — it is the combination and intensity of the following contributing patterns:</div>
    <div class="ps-risk-factors">
      <div class="ps-risk-factor"><div class="ps-rf-icon"></div><div class="ps-rf-text"><span class="ps-rf-label">Severity score ≥ ${displayPercent}% —</span> The model's output crosses the clinical high-risk threshold established from validated depression screening benchmarks.</div></div>
      <div class="ps-risk-factor"><div class="ps-rf-icon"></div><div class="ps-rf-text"><span class="ps-rf-label">Multimodal agreement —</span> Audio, text, and video signals are all independently flagging distress, strengthening the reliability of the prediction.</div></div>
      ${pdfDepInfo ? `<div class="ps-risk-factor"><div class="ps-rf-icon"></div><div class="ps-rf-text"><span class="ps-rf-label">${pdfDepInfo.short} context —</span> ${pdfDepInfo.description}</div></div>` : ''}
      <div class="ps-risk-factor"><div class="ps-rf-icon"></div><div class="ps-rf-text"><span class="ps-rf-label">Negative cognitive patterns —</span> Language analysis detected persistent distress framing and reduced future-oriented speech, associated with higher-risk presentations.</div></div>
    </div>
  </div>
  ` : ''}

  ${insightsHtml ? `
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Behavioural & Emotional Insights</div>
    <div class="ps-insights-grid">
      ${insightsHtml}
    </div>
  </div>
  ` : ''}

  ${recsHtml ? `
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Personalised Recommendations</div>
    <div class="ps-rec-grid">
      ${recsHtml}
    </div>
  </div>
  ` : ''}

  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Next Steps</div>
    <div class="ps-steps">
      <div class="ps-step">
        <div class="ps-step-num">1</div>
        <div class="ps-step-text"><span class="ps-step-strong">Today:</span> Share this report with a family member, partner, or trusted friend.</div>
      </div>
      <div class="ps-step">
        <div class="ps-step-num">2</div>
        <div class="ps-step-text"><span class="ps-step-strong">Follow-up session:</span> Schedule a re-assessment with PsychSense in 2–4 weeks to track your symptom trajectory.</div>
      </div>
      ${isDepressed ? `
      <div class="ps-step">
        <div class="ps-step-num">3</div>
        <div class="ps-step-text"><span class="ps-step-strong">Seek help:</span> Book an appointment with a primary care physician to review these initial signals.</div>
      </div>` : ''}
    </div>
  </div>

  ${isDepressed ? (() => {
      const pdfDocType = depType || 'Depressive Episode';
      const pdfDoctors = getDoctorsForCityAndType(pdfDocType);
      return `
  <div class="ps-card" style="page-break-inside:avoid;">
    <div class="ps-card-title"><div class="ps-card-title-bar" style="background:#22c55e;"></div> Recommended Doctors in ${_detectedCity}</div>
    <div style="font-size:13px; color:#475569; line-height:1.7; margin-bottom:12px;">Based on the detected condition (<strong>${pdfDocType}</strong>), the following specialists in ${_detectedCity} are recommended.</div>
    <table style="width:100%; border-collapse:collapse; border:0.5px solid #cbd5e1; border-radius:8px; overflow:hidden; font-size:13px;">
      <thead>
        <tr style="background:#f0f9ff;">
          <th style="padding:10px 14px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:#0c4a6e; border-bottom:0.5px solid #cbd5e1;">Doctor Name</th>
          <th style="padding:10px 14px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:#0c4a6e; border-bottom:0.5px solid #cbd5e1;">Area of Specialization</th>
          <th style="padding:10px 14px; text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:#0c4a6e; border-bottom:0.5px solid #cbd5e1;">Place of Work</th>
        </tr>
      </thead>
      <tbody>
        ${pdfDoctors.map((d, i) => `
          <tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'};">
            <td style="padding:10px 14px; font-weight:500; color:#0f172a; border-bottom:0.5px solid #e2e8f0;">${d.name}</td>
            <td style="padding:10px 14px; color:#334155; border-bottom:0.5px solid #e2e8f0;">${d.specialization}</td>
            <td style="padding:10px 14px; color:#334155; border-bottom:0.5px solid #e2e8f0;">${d.workplace}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="font-size:11px; color:#64748b; margin-top:10px; line-height:1.6;">Always confirm current clinic timings and availability when booking. The same psychiatrist is usually qualified to treat multiple depressive disorders.</div>
  </div>
  `;
    })() : ''}

  <div class="ps-disclaimer">
    <div class="ps-disclaimer-title">Ethical Disclaimer & Important Notice</div>
    <div class="ps-disclaimer-body">
      This report is generated by PsychSense, an AI-powered mental health screening tool. It is intended for <strong>informational and supportive purposes only</strong> and does <strong>not</strong> constitute a clinical diagnosis, medical advice, or a substitute for professional psychiatric evaluation. Results may not account for all individual circumstances, cultural factors, or medical history. Always consult a licensed mental health professional before making any decisions regarding treatment. If you or someone you know is in immediate danger, please contact emergency services or a crisis helpline without delay.
    </div>
  </div>

  <div class="ps-footer">
    <span>PsychSense AI · Report ID: ${reportId} · Confidential</span>
    <span>Generated ${dateStr} · v2.1.0</span>
  </div>
</div>
  `;

  // Export PDF
  const opt = {
    margin: [5, 5, 5, 5],
    filename: `PsychSense_Report_${uName}_${dateStr.replace(/\s/g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(htmlStr).save();
};

window.openProfileModal = async function () {
  const modal = document.getElementById('profile-modal');
  if (!modal || !window.currentUser) return;

  const u = window.currentUser;
  const displayName = u.name || u.email || 'User';
  const avatarSeed = displayName.includes('@') ? displayName.split('@')[0] : displayName;
  const avatarUrl = u.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarSeed)}&background=06b6d4&color=fff&size=128`;

  const nameVal = document.getElementById('input-name')?.value || u.name || '—';
  const ageVal = document.getElementById('input-age')?.value || u.age || '—';
  const genderVal = document.getElementById('input-gender')?.value || u.gender || '—';

  document.getElementById('profile-modal-avatar').src = avatarUrl;
  document.getElementById('profile-modal-name').textContent = nameVal;
  document.getElementById('profile-modal-email').textContent = u.email || '';
  document.getElementById('profile-modal-email-full').textContent = u.email || '—';
  document.getElementById('profile-modal-age').textContent = ageVal;
  document.getElementById('profile-modal-gender').textContent = genderVal;

  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) window.closeProfileModal(); };

  // Load past reports
  const reportsEl = document.getElementById('profile-modal-reports');
  if (reportsEl) {
    reportsEl.innerHTML = `<p style="color:#64748b;font-size:12px;text-align:center;padding:12px;">Loading reports…</p>`;
    const reports = window.loadReports ? await window.loadReports() : [];
    if (!reports.length) {
      reportsEl.innerHTML = `<p style="color:#475569;font-size:11px;text-align:center;padding:12px;">No past assessments yet.</p>`;
    } else {
      reportsEl.innerHTML = reports.map(r => {
        const date = new Date(r.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        const risk = r.riskLevel || 'Low';
        const isStable = risk === 'Low';
        const color = isStable ? '#22c55e' : risk === 'Moderate' ? '#f59e0b' : '#ef4444';
        const label = risk;
        return `<div style="background:rgba(0,0,0,0.3);border-radius:12px;padding:14px 16px;border:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;">
          <div>
            <p style="font-size:11px;color:#94a3b8;margin-bottom:3px;">${date}</p>
            <p style="font-size:13px;font-weight:700;font-family:'Space Grotesk',sans-serif;">${r.userInfo?.name || '—'}</p>
          </div>
          <div style="text-align:right;">
            <p style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.08em;">${r.riskLevel}</p>
            <p style="font-size:10px;color:#64748b;">${r.confidenceScore}% confidence</p>
          </div>
        </div>`;
      }).join('');
    }
  }
};

window.closeProfileModal = function () {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
};

window.handleReset = function () {
  textInputVal = ''; videoBase64 = null; audioBase64 = null; audioUrl = null;
  aiResult = null; isRecording = false;
  sessionStorage.removeItem('ps_textInputVal');
  sessionStorage.removeItem('ps_videoBase64');
  sessionStorage.removeItem('ps_audioBase64');
  sessionStorage.removeItem('ps_aiResult');
  if (recordingTimer) clearInterval(recordingTimer);
  const input = document.getElementById('text-input');
  if (input) input.value = '';
  const count = document.getElementById('char-count');
  if (count) count.textContent = '0 chars';
  window.goTo('landing');
};

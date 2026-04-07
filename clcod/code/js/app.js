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
let currentPage = 'landing';
let userInfo = { name: '', age: '', gender: '' };
let textInputVal = '';
let videoBase64 = null;
let audioBase64 = null;
let audioUrl = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingTime = 0;
let aiResult = null;
let questionnaireAnswers = { elevatedMood: false, reducedSleep: false, impulsivity: false, racingThoughts: false };

// ── BACKEND URL CONFIG ──────────────────────────────────────────────────────
// For local development, keep this as http://127.0.0.1:5000
// Before deploying to production, change this to your hosted backend URL, e.g.:
//   const FLASK_API_URL = 'https://your-backend.railway.app';
const FLASK_API_URL = 'https://sense123-psychsense.hf.space';
// ────────────────────────────────────────────────────────────────────────────

window.goTo = function (page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');
  currentPage = page;
  if (page === 'user-info') prefillUserInfo();
};

// ── Toast notification ────────────────────────────────────────────────────────
let _toastTimer = null;
window.showToast = function (msg, type = 'warn') {
  const toast = document.getElementById('ps-toast');
  const msgEl  = document.getElementById('ps-toast-msg');
  const icon   = document.getElementById('ps-toast-icon');
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
  const list  = document.getElementById('results-history-list');
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

    const risk = r.riskLevel || 'Stable';
    const isStable = risk === 'Stable' || risk === 'Low';
    const riskColour = isStable ? '#22c55e' : risk === 'High' ? '#ef4444' : '#f59e0b';
    const riskLabel = isStable ? 'Stable' : risk;
    const scoreLabel  = r.confidenceScore != null ? `${r.confidenceScore}%` : '—';
    const typeLabel   = r.depressionType || '';
    const name        = r.userInfo?.name || window.currentUser?.name || '—';

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

function prefillUserInfo() {
  if (!window.currentUser) return;

  const nameInput = document.getElementById('input-name');
  const genderInput = document.getElementById('input-gender');
  const photoWrap = document.getElementById('user-info-photo-wrap');

  if (nameInput && window.currentUser.name) {
    nameInput.value = window.currentUser.name;
  }
  if (genderInput && window.currentUser.gender) {
    genderInput.value = window.currentUser.gender;
  }

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
  textInputVal = document.getElementById('text-input').value;
  const btn = document.getElementById('assess-continue-btn');
  if (btn) btn.disabled = !textInputVal.trim() && !videoBase64 && !audioBase64;
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

  const seasonal   = get('seasonal');
  const postpartum = get('postpartum');
  const duration   = get('duration');
  const hypersomnia= get('hypersomnia');
  const appetite   = get('appetite');
  const moodReact  = get('moodReactivity');
  const sadness    = get('sadness');
  const anhedonia  = get('anhedonia');

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
  userInfo.name = document.getElementById('input-name').value;
  userInfo.age = document.getElementById('input-age').value;
  userInfo.gender = document.getElementById('input-gender').value;
  if (window.currentUser) {
    window.currentUser.gender = userInfo.gender;
    window.currentUser.age = userInfo.age;
    if (window.saveUserProfile) {
      await window.saveUserProfile({
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

  // Empty questionnaire — first pass uses pure model output only
  const emptyQuestionnaire = {
    answers: { elevatedMood: false, reducedSleep: false, impulsivity: false, racingThoughts: false },
    duration: 0,
    seasonalPattern: 'No seasonal pattern',
    postpartum: 'Not applicable',
    impairment: 30,
  };

  window.goTo('analysis');
  try {
    const result = await analyzeWithFlask(userInfo, textInputVal, videoBase64, audioBase64, emptyQuestionnaire);
    aiResult = result;

    // NEW FLOW: model output is binary — depressed or not
    // If riskLevel is Low → patient is NOT depressed → show Stable result, no questionnaire
    // If riskLevel is Moderate or High → patient IS depressed → always show questionnaire
    const isDepressed = result.riskLevel === 'Moderate' || result.riskLevel === 'High';

    if (!isDepressed) {
      // Not depressed — show stable result immediately
      renderResults(result, null, false);
      if (window.saveReport) {
        await window.saveReport({
          userInfo: { ...userInfo },
          riskLevel: 'Stable',
          confidenceScore: result.confidenceScore,
          emotionalSignals: result.emotionalSignals,
          contributions: result.contributions,
          recommendations: result.recommendations,
          questionnaire: emptyQuestionnaire,
        });
      }
      window.goTo('results');
    } else {
      // Depressed — show questionnaire to determine type and severity
      const banner = document.getElementById('questionnaire-banner');
      if (banner) {
        banner.style.display = 'flex';
        banner.querySelector('#banner-risk').textContent = result.riskLevel;
        banner.querySelector('#banner-confidence').textContent = result.confidenceScore + '%';
      }
      resetQuestionnaire();
      qRender();
      window.goTo('questioning');
    }
  } catch (err) {
    console.error('Analysis failed:', err);
    window.goTo('error');
    const errMsgEl = document.getElementById('error-message');
    if (errMsgEl) errMsgEl.textContent = err.message || 'An unexpected error occurred. Please try again.';
  }
};

// ---- STEP 2: After questionnaire is filled (only reached if model flagged depression) ----
window.completeQuestionnaire = async function () {
  const getScore = (key) => {
    const idx = DEPRESSION_QUESTIONS.findIndex(q => q.key === key);
    return idx >= 0 ? (qAnswers[idx] ?? 0) : 0;
  };

  // Calculate depression severity % purely from questionnaire answers (0–36 scale → 0–100%)
  // Core symptom keys weighted for clinical relevance
  const coreKeys = ['sadness','anhedonia','fatigue','insomnia','hypersomnia','appetite','concentration','suicidality'];
  const rawScore = coreKeys.reduce((sum, key) => sum + getScore(key), 0);
  const maxScore = coreKeys.length * 3; // 24
  const depressionPercent = Math.round((rawScore / maxScore) * 100);

  const questionnaireData = {
    answers: {
      elevatedMood:   false,
      reducedSleep:   getScore('insomnia') >= 2,
      impulsivity:    false,
      racingThoughts: false,
    },
    duration:        getScore('duration'),
    seasonalPattern: getScore('seasonal') >= 2 ? 'Winter onset' : 'No seasonal pattern',
    postpartum:      getScore('postpartum') >= 2 ? 'Within 4 weeks postpartum' : 'Not applicable',
    impairment:      Math.round((getScore('sadness') + getScore('anhedonia') + getScore('fatigue')) / 9 * 100),
    scores:          Object.fromEntries(DEPRESSION_QUESTIONS.map((q, i) => [q.key, qAnswers[i] ?? 0])),
    depressionPercent: depressionPercent,  // questionnaire-derived severity %
  };

  const depressionType = classifyDepressionType(qAnswers);

  window.goTo('analysis');
  try {
    const result = await analyzeWithFlask(userInfo, textInputVal, videoBase64, audioBase64, questionnaireData);
    aiResult = result;
    aiResult.depressionType = depressionType;
    // Override confidenceScore with the questionnaire-derived depression %
    aiResult.displayPercent = depressionPercent;
    renderResults(result, depressionType, true);
    if (window.saveReport) {
      await window.saveReport({
        userInfo:         { ...userInfo },
        riskLevel:        result.riskLevel,
        confidenceScore:  depressionPercent,
        emotionalSignals: result.emotionalSignals,
        contributions:    result.contributions,
        recommendations:  result.recommendations,
        questionnaire:    questionnaireData,
        depressionType:   depressionType,
      });
    }
    window.goTo('results');
  } catch (err) {
    console.error('Analysis failed:', err);
    window.goTo('error');
    const errMsgEl = document.getElementById('error-message');
    if (errMsgEl) errMsgEl.textContent = err.message || 'An unexpected error occurred. Please try again.';
  }
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
    const audioBlob = dataURLtoBlob(audioBase64);
    formData.append('audio', audioBlob, 'recording.wav');
  }

  // Video — convert base64 data URL → Blob → File
  if (videoBase64) {
    const videoBlob = dataURLtoBlob(videoBase64);
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
    } catch (_) {}
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

// Helper: convert a base64 data URL to a Blob
function dataURLtoBlob(dataURL) {
  const [header, base64] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function renderResults(result, depressionType, isDepressed) {
  const name = userInfo.name || 'Anonymous';
  const patientEl = document.getElementById('results-patient');
  if (patientEl) patientEl.textContent = `Patient: ${name} • ID: PS-${Math.floor(Math.random() * 9000) + 1000}`;

  // ── What % to show in the ring ──────────────────────────────────────────
  // If depressed: show questionnaire-derived depression %
  // If stable: show model's low probability % (informational)
  const displayPercent = isDepressed
    ? (result.displayPercent ?? result.confidenceScore)
    : result.confidenceScore;

  const confidenceEl = document.getElementById('results-confidence');
  if (confidenceEl) confidenceEl.textContent = `${displayPercent}%`;

  // ── Ring label & colour ─────────────────────────────────────────────────
  const ringProgress = document.getElementById('ring-progress');
  if (ringProgress) {
    const circumference = 2 * Math.PI * 60;
    const offset = circumference * (1 - displayPercent / 100);
    // Green for stable, red-spectrum for depressed
    ringProgress.style.stroke = isDepressed
      ? (displayPercent >= 70 ? '#ef4444' : displayPercent >= 45 ? '#f59e0b' : '#06b6d4')
      : '#22c55e';
    setTimeout(() => { ringProgress.style.strokeDashoffset = offset; }, 100);
  }

  // ── Risk / Status label ─────────────────────────────────────────────────
  const riskEl = document.getElementById('results-risk');
  if (riskEl) {
    if (!isDepressed) {
      riskEl.textContent = 'Stable';
      riskEl.style.color = '#22c55e';
    } else {
      riskEl.textContent = result.riskLevel;
      riskEl.style.color = result.riskLevel === 'High' ? '#ef4444' : '#f59e0b';
    }
  }

  // ── Ring label (inside the donut) ───────────────────────────────────────
  const ringLabelEl = document.getElementById('ring-label');
  if (ringLabelEl) ringLabelEl.textContent = isDepressed ? result.riskLevel : 'Stable';

  // ── Description text ────────────────────────────────────────────────────
  const ringDescEl = document.getElementById('ring-desc');
  if (ringDescEl) {
    if (!isDepressed) {
      ringDescEl.textContent = 'No significant indicators of depression were detected across your multi-modal inputs. Continue to monitor your wellbeing periodically.';
    } else {
      ringDescEl.textContent = depressionType
        ? `Analysis indicates ${depressionType}. The score above reflects the severity of your symptoms based on your questionnaire responses.`
        : `Analysis indicates a ${result.riskLevel.toLowerCase()} level of depressive symptoms across your multi-modal inputs.`;
    }
  }

  // ── Depression label on the ring card ──────────────────────────────────
  const ringCardLabel = document.getElementById('ring-card-label');
  if (ringCardLabel) {
    ringCardLabel.textContent = isDepressed ? 'Depression Severity' : 'Wellbeing Score';
  }

  // ── Depression type badge ───────────────────────────────────────────────
  const typeBadge = document.getElementById('depression-type-badge');
  const typeLabel = document.getElementById('depression-type-label');
  if (typeBadge && typeLabel) {
    if (isDepressed && depressionType) {
      typeBadge.style.display = 'inline-flex';
      typeLabel.textContent = depressionType;
    } else {
      typeBadge.style.display = 'none';
    }
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

  // ── Emotional signals ───────────────────────────────────────────────────
  const sigContainer = document.getElementById('signals-container');
  if (sigContainer) {
    const signals = isDepressed
      ? (result.emotionalSignals || ['Low Mood'])
      : ['Emotional Stability', 'Resilience', 'Coherent Thought'];
    sigContainer.innerHTML = signals.map(s =>
      `<span class="tag" style="background:${isDepressed ? 'rgba(139,92,246,0.1)' : 'rgba(34,197,94,0.1)'};border:1px solid ${isDepressed ? 'rgba(139,92,246,0.2)' : 'rgba(34,197,94,0.2)'};color:${isDepressed ? '#c4b5fd' : '#86efac'};">${s}</span>`
    ).join('');
  }

  // ── Modality insights ───────────────────────────────────────────────────
  ['text', 'video', 'audio', 'quest'].forEach((k, i) => {
    const key = ['text', 'video', 'audio', 'questionnaire'][i];
    const insights = result.insights?.[key];
    const firstPoint = insights?.points?.[0] ?? 'Analysis complete.';
    const pointEl = document.getElementById(`point-${k}`);
    if (pointEl) pointEl.textContent = firstPoint;
    const barEl = document.getElementById(`bar-${k}`);
    if (barEl) setTimeout(() => { barEl.style.width = `${70 + Math.random() * 25}%`; }, 200);
  });

  ['text', 'video', 'audio'].forEach(k => {
    const ul = document.getElementById(`insights-${k}`);
    if (ul) {
      const points = result.insights?.[k]?.points ?? [];
      ul.innerHTML = points.map(p => `<li style="display:flex;gap:8px;font-size:11px;color:#cbd5e1;line-height:1.5;"><div style="width:4px;height:4px;border-radius:50%;background:currentColor;margin-top:5px;flex-shrink:0;"></div>${p}</li>`).join('');
    }
  });

  // ── Recommendations ─────────────────────────────────────────────────────
  const recContainer = document.getElementById('recommendations-container');
  if (recContainer) {
    recContainer.innerHTML = (result.recommendations || []).map(r =>
      `<div class="rec-card"><svg class="check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p style="font-size:11px;color:#cbd5e1;line-height:1.5;">${r}</p></div>`
    ).join('');
  }
}

window.downloadReport = function () {
  const isDepressed = aiResult?.riskLevel === 'Moderate' || aiResult?.riskLevel === 'High';
  const displayPercent = isDepressed
    ? (aiResult?.displayPercent ?? aiResult?.confidenceScore ?? '—')
    : null;

  const lines = [
    '=== PsychSense Mental Health Report ===',
    '',
    `Patient: ${userInfo.name || 'Anonymous'}`,
    `Age: ${userInfo.age}`,
    `Gender: ${userInfo.gender}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    `Status: ${isDepressed ? aiResult?.riskLevel + ' Risk' : 'Stable — No Depression Detected'}`,
    isDepressed ? `Depression Type: ${aiResult?.depressionType ?? 'N/A'}` : null,
    isDepressed ? `Depression Severity: ${displayPercent}%` : null,
    '',
    'Recommendations:',
    ...(aiResult?.recommendations ?? []).map(r => `  - ${r}`),
    '',
    'Disclaimer: This system is for early mental health screening only — not a clinical diagnosis.',
  ].filter(l => l !== null);

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `PsychSense_Report_${userInfo.name || 'User'}.txt`;
  a.click();
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
        const risk = r.riskLevel || 'Stable';
        const isStable = risk === 'Stable' || risk === 'Low';
        const color = isStable ? '#22c55e' : risk === 'Moderate' ? '#f59e0b' : '#ef4444';
        const label = isStable ? 'Stable' : risk;
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
  if (recordingTimer) clearInterval(recordingTimer);
  const input = document.getElementById('text-input');
  if (input) input.value = '';
  const count = document.getElementById('char-count');
  if (count) count.textContent = '0 chars';
  window.goTo('landing');
};

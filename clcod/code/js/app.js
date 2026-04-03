// ---- Auth Modal ----
let currentAuthTab = 'login';

window.openAuthModal = function() {
  const modal = document.getElementById('auth-modal');
  if (modal) { modal.style.display = 'flex'; switchAuthTab('login'); }
};

window.closeAuthModal = function() {
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

window.switchAuthTab = function(tab) {
  currentAuthTab = tab;
  const nameField    = document.getElementById('auth-name-field');
  const confirmField = document.getElementById('auth-confirm-field');
  const submitBtn    = document.getElementById('auth-submit-btn');
  const tabLogin     = document.getElementById('tab-login');
  const tabSignup    = document.getElementById('tab-signup');

  const activeStyle   = 'background:rgba(139,92,246,0.2);color:#8b5cf6;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  const inactiveStyle = 'background:transparent;color:#64748b;box-shadow:none;';

  if (tab === 'login') {
    if (nameField)    nameField.style.display    = 'none';
    if (confirmField) confirmField.style.display = 'none';
    if (submitBtn)    submitBtn.textContent       = 'Login';
    if (tabLogin)     tabLogin.setAttribute('style', tabLogin.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + activeStyle);
    if (tabSignup)    tabSignup.setAttribute('style', tabSignup.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + inactiveStyle);
  } else {
    if (nameField)    nameField.style.display    = 'block';
    if (confirmField) confirmField.style.display = 'block';
    if (submitBtn)    submitBtn.textContent       = 'Create Account';
    if (tabSignup)    tabSignup.setAttribute('style', tabSignup.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + activeStyle);
    if (tabLogin)     tabLogin.setAttribute('style', tabLogin.getAttribute('style').replace(/background:[^;]+;color:[^;]+;box-shadow:[^;]+;/, '') + inactiveStyle);
  }
  clearAuthError();
};

window.togglePasswordVis = function() {
  const input = document.getElementById('auth-password');
  const icon  = document.getElementById('eye-icon');
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

window.handleAuthSubmit = async function() {
  clearAuthError();
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const btn      = document.getElementById('auth-submit-btn');

  if (!email || !password) { showAuthError('Please fill in all fields.'); return; }

  if (currentAuthTab === 'signup') {
    const name    = document.getElementById('auth-name')?.value.trim();
    const confirm = document.getElementById('auth-confirm')?.value;
    if (!name)              { showAuthError('Please enter your full name.'); return; }
    if (password !== confirm){ showAuthError('Passwords do not match.'); return; }
    if (password.length < 6){ showAuthError('Password must be at least 6 characters.'); return; }
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
      'auth/user-not-found':       'No account found with this email.',
      'auth/wrong-password':       'Incorrect password.',
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/invalid-email':        'Invalid email address.',
      'auth/too-many-requests':    'Too many attempts. Please try again later.',
      'auth/invalid-credential':   'Invalid email or password.',
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
const FLASK_API_URL = 'http://127.0.0.1:5000';
// ────────────────────────────────────────────────────────────────────────────

window.goTo = function(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');
  currentPage = page;
  if (page === 'user-info') prefillUserInfo();
};

function prefillUserInfo() {
  if (!window.currentUser) return;

  const nameInput   = document.getElementById('input-name');
  const genderInput = document.getElementById('input-gender');
  const photoWrap   = document.getElementById('user-info-photo-wrap');

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

window.handlePhotoChange = function(event) {
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

window.handleGoogleLogin = function() { 
  if (window.firebaseSignIn) window.firebaseSignIn(); 
};

window.updateAssessBtn = function() {
  textInputVal = document.getElementById('text-input').value;
  const btn = document.getElementById('assess-continue-btn');
  if (btn) btn.disabled = !textInputVal.trim() && !videoBase64 && !audioBase64;
};

// ---- Toggle answers ----
window.toggleAnswer = function(key, btn) {
  questionnaireAnswers[key] = !questionnaireAnswers[key];
  btn.className = 'toggle-btn ' + (questionnaireAnswers[key] ? 'on' : 'off');
  const label = document.getElementById('label-' + key);
  if (label) {
    label.textContent = questionnaireAnswers[key] ? 'YES' : 'NO';
    label.style.color = questionnaireAnswers[key] ? '#8b5cf6' : '#64748b';
  }
};

window.updateImpairmentLabel = function() {
  const el = document.getElementById('q-impairment');
  if (!el) return;
  const val = parseInt(el.value);
  const label = val < 33 ? 'Mild' : val < 66 ? 'Moderate' : 'Severe';
  const labelEl = document.getElementById('impairment-label');
  if (labelEl) labelEl.textContent = `${label} (${val}%)`;
};

// ---- Audio Recording ----
window.toggleRecording = async function() {
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

window.removeAudio = function() {
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

window.handleAudioUpload = function(event) {
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

window.handleVideoUpload = function(event) {
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

// ---- Questionnaire Complete ----
// ---- STEP 1: Run ML model first when user clicks "Complete Assessment" on assessment page ----
window.runInitialAnalysis = async function() {
  userInfo.name   = document.getElementById('input-name').value;
  userInfo.age    = document.getElementById('input-age').value;
  userInfo.gender = document.getElementById('input-gender').value;
  if (window.currentUser) {
    window.currentUser.gender = userInfo.gender;
    window.currentUser.age    = userInfo.age;
    if (window.saveUserProfile) {
      await window.saveUserProfile({
        name:   userInfo.name,
        age:    userInfo.age,
        gender: userInfo.gender,
        email:  window.currentUser.email,
        photo:  window.currentUser.photo || null,
        updatedAt: new Date().toISOString()
      });
    }
  }
  textInputVal = document.getElementById('text-input').value;

  // Run ML with empty questionnaire first
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

    // If depression likely → show questionnaire for more details
    if (result.riskLevel === 'High' || result.riskLevel === 'Moderate') {
      // Show a banner on questionnaire page explaining why
      const banner = document.getElementById('questionnaire-banner');
      if (banner) {
        banner.style.display = 'flex';
        banner.querySelector('#banner-risk').textContent = result.riskLevel;
        banner.querySelector('#banner-confidence').textContent = result.confidenceScore + '%';
      }
      window.goTo('questioning');
    } else {
      // Low risk → go straight to results
      renderResults(result);
      if (window.saveReport) {
        await window.saveReport({
          userInfo:        { ...userInfo },
          riskLevel:       result.riskLevel,
          confidenceScore: result.confidenceScore,
          emotionalSignals: result.emotionalSignals,
          contributions:   result.contributions,
          recommendations: result.recommendations,
          questionnaire:   emptyQuestionnaire,
        });
      }
      window.goTo('results');
    }
  } catch (err) {
    console.error('Analysis failed:', err);
    window.goTo('error');
    const errMsgEl = document.getElementById('error-message');
    if (errMsgEl) errMsgEl.textContent = err.message || 'An unexpected error occurred. Please try again.';
  }
};

// ---- STEP 2: After questionnaire is filled (only reached if depression was flagged) ----
window.completeQuestionnaire = async function() {
  const questionnaireData = {
    answers: { ...questionnaireAnswers },
    duration: parseInt(document.getElementById('q-duration').value) || 0,
    seasonalPattern: document.getElementById('q-seasonal').value,
    postpartum: document.getElementById('q-postpartum').value,
    impairment: parseInt(document.getElementById('q-impairment').value),
  };

  window.goTo('analysis');
  try {
    // Re-run with full questionnaire data for refined result
    const result = await analyzeWithFlask(userInfo, textInputVal, videoBase64, audioBase64, questionnaireData);
    aiResult = result;
    renderResults(result);
    if (window.saveReport) {
      await window.saveReport({
        userInfo:        { ...userInfo },
        riskLevel:       result.riskLevel,
        confidenceScore: result.confidenceScore,
        emotionalSignals: result.emotionalSignals,
        contributions:   result.contributions,
        recommendations: result.recommendations,
        questionnaire:   questionnaireData,
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
    if (!ping.ok) throw new Error('Backend not reachable');
  } catch {
    throw new Error(
      'Cannot reach the Flask backend at ' + FLASK_API_URL +
      '. Make sure you ran: python app.py'
    );
  }

  // Build multipart/form-data — Flask reads files and form fields separately
  const formData = new FormData();

  // Text
  formData.append('text', textInput || '');

  // Questionnaire + userInfo as JSON strings
  formData.append('questionnaire', JSON.stringify(questionnaireData));
  formData.append('userInfo',      JSON.stringify(userInfo));

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

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Server error ${response.status}`);
  }

  const result = await response.json();
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

function renderResults(result) {
  const name = userInfo.name || 'Anonymous';
  const patientEl = document.getElementById('results-patient');
  if (patientEl) patientEl.textContent = `Patient: ${name} • ID: PS-${Math.floor(Math.random()*9000)+1000}`;
  
  const confidenceEl = document.getElementById('results-confidence');
  if (confidenceEl) confidenceEl.textContent = `${result.confidenceScore}%`;
  
  const riskEl = document.getElementById('results-risk');
  if (riskEl) riskEl.textContent = result.riskLevel;
  
  const ringLabelEl = document.getElementById('ring-label');
  if (ringLabelEl) ringLabelEl.textContent = result.riskLevel === 'Low' ? 'Stable' : result.riskLevel;
  
  const ringDescEl = document.getElementById('ring-desc');
  if (ringDescEl) {
    ringDescEl.textContent = result.riskLevel === 'Low'
      ? 'Subject exhibits stable linguistic and vocal biomarkers, indicating low probability of acute depressive episodes.'
      : `Analysis indicates a ${result.riskLevel.toLowerCase()} probability of depressive symptoms across multi-modal biomarkers.`;
  }

  const ringProgress = document.getElementById('ring-progress');
  if (ringProgress) {
    const circumference = 2 * Math.PI * 80;
    const offset = circumference * (1 - result.confidenceScore / 100);
    setTimeout(() => { ringProgress.style.strokeDashoffset = offset; }, 100);
  }

  const c = result.contributions;
  ['text','video','audio','quest'].forEach((k, i) => {
    const key = ['text','video','audio','questionnaire'][i];
    const val = c[key] ?? 25;
    const valEl = document.getElementById(`contrib-${k}-val`);
    if (valEl) valEl.textContent = `${val}%`;
    const progressEl = document.getElementById(`contrib-${k}`);
    if (progressEl) setTimeout(() => { progressEl.style.width = `${val}%`; }, 200);
  });

  const sigContainer = document.getElementById('signals-container');
  if (sigContainer) {
    sigContainer.innerHTML = (result.emotionalSignals || ['Stability']).map(s =>
      `<span class="tag" style="background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.2);color:#06b6d4;">${s}</span>`
    ).join('');
  }

  ['text','video','audio','quest'].forEach((k, i) => {
    const key = ['text','video','audio','questionnaire'][i];
    const insights = result.insights?.[key];
    const firstPoint = insights?.points?.[0] ?? 'Analysis complete.';
    const pointEl = document.getElementById(`point-${k}`);
    if (pointEl) pointEl.textContent = firstPoint;
    const barEl = document.getElementById(`bar-${k}`);
    if (barEl) setTimeout(() => { barEl.style.width = `${70 + Math.random()*25}%`; }, 200);
  });

  ['text','video','audio'].forEach(k => {
    const ul = document.getElementById(`insights-${k}`);
    if (ul) {
      const points = result.insights?.[k]?.points ?? [];
      ul.innerHTML = points.map(p => `<li style="display:flex;gap:8px;font-size:11px;color:#cbd5e1;line-height:1.5;"><div style="width:4px;height:4px;border-radius:50%;background:currentColor;margin-top:5px;flex-shrink:0;"></div>${p}</li>`).join('');
    }
  });

  const recContainer = document.getElementById('recommendations-container');
  if (recContainer) {
    recContainer.innerHTML = (result.recommendations || []).map(r =>
      `<div class="rec-card"><svg class="check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p style="font-size:11px;color:#cbd5e1;line-height:1.5;">${r}</p></div>`
    ).join('');
  }
}

window.downloadReport = function() {
  const lines = [
    '=== PsychSense Mental Health Report ===',
    '',
    `Patient: ${userInfo.name || 'Anonymous'}`,
    `Age: ${userInfo.age}`,
    `Gender: ${userInfo.gender}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    `Risk Level: ${aiResult?.riskLevel ?? 'N/A'}`,
    `Confidence: ${aiResult?.confidenceScore ?? '—'}%`,
    '',
    'Recommendations:',
    ...(aiResult?.recommendations ?? []).map(r => `  - ${r}`),
    '',
    'Disclaimer: This system is for early mental health screening only — not a clinical diagnosis.',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `PsychSense_Report_${userInfo.name || 'User'}.txt`;
  a.click();
};

window.openProfileModal = async function() {
  const modal = document.getElementById('profile-modal');
  if (!modal || !window.currentUser) return;

  const u = window.currentUser;
  const displayName = u.name || u.email || 'User';
  const avatarSeed  = displayName.includes('@') ? displayName.split('@')[0] : displayName;
  const avatarUrl   = u.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarSeed)}&background=06b6d4&color=fff&size=128`;

  const nameVal   = document.getElementById('input-name')?.value   || u.name   || '—';
  const ageVal    = document.getElementById('input-age')?.value    || u.age    || '—';
  const genderVal = document.getElementById('input-gender')?.value || u.gender || '—';

  document.getElementById('profile-modal-avatar').src             = avatarUrl;
  document.getElementById('profile-modal-name').textContent       = nameVal;
  document.getElementById('profile-modal-email').textContent      = u.email || '';
  document.getElementById('profile-modal-email-full').textContent = u.email || '—';
  document.getElementById('profile-modal-age').textContent        = ageVal;
  document.getElementById('profile-modal-gender').textContent     = genderVal;

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
        const date  = new Date(r.createdAt).toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
        const color = r.riskLevel === 'Low' ? '#06b6d4' : r.riskLevel === 'Moderate' ? '#f59e0b' : '#ef4444';
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

window.closeProfileModal = function() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
};

window.handleReset = function() {
  textInputVal = ''; videoBase64 = null; audioBase64 = null; audioUrl = null;
  aiResult = null; isRecording = false;
  if (recordingTimer) clearInterval(recordingTimer);
  const input = document.getElementById('text-input');
  if (input) input.value = '';
  const count = document.getElementById('char-count');
  if (count) count.textContent = '0 chars';
  window.goTo('landing');
};

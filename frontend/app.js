// Taste Finder - Collaborative Partner Agent Frontend
const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') 
  ? 'http://127.0.0.1:8000' 
  : window.location.origin;

let currentUserId = localStorage.getItem('tf_user_id') || 'user_' + Math.random().toString(36).substring(2, 9);
let currentSessionId = localStorage.getItem('tf_session_id') || 'sess_' + Math.random().toString(36).substring(2, 9);

localStorage.setItem('tf_user_id', currentUserId);
localStorage.setItem('tf_session_id', currentSessionId);

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const clarificationBar = document.getElementById('clarificationBar');
const clarificationItems = document.getElementById('clarificationItems');

// Notebook Elements
const nbDestination = document.getElementById('nbDestination');
const nbPreferences = document.getElementById('nbPreferences');
const nbNotes = document.getElementById('nbNotes');
const nbShortlist = document.getElementById('nbShortlist');
const nbShortlistCount = document.getElementById('nbShortlistCount');

// Profile Elements
const profileSummary = document.getElementById('profileSummary');
const profileVibes = document.getElementById('profileVibes');
const profileCuisines = document.getElementById('profileCuisines');
const profileAvoids = document.getElementById('profileAvoids');
const weightAuth = document.getElementById('weightAuth');
const valAuth = document.getElementById('valAuth');
const weightCulinary = document.getElementById('weightCulinary');
const valCulinary = document.getElementById('valCulinary');
const weightAmbiance = document.getElementById('weightAmbiance');
const valAmbiance = document.getElementById('valAmbiance');
const weightValue = document.getElementById('weightValue');
const valValue = document.getElementById('valValue');

// Modal Elements
const uploadModal = document.getElementById('uploadModal');
const btnUploadModal = document.getElementById('btnUploadModal');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');
const btnResetSession = document.getElementById('btnResetSession');

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab') === 'notebook' ? 'tabNotebook' : 'tabProfile';
    document.getElementById(tabId).classList.add('active');
  });
});

// Load Initial Data
window.addEventListener('DOMContentLoaded', () => {
  loadUserProfile();
  loadSessionData();
});

async function loadUserProfile() {
  try {
    const res = await fetch(`${API_BASE}/api/profile/${currentUserId}`);
    if (res.ok) {
      const data = await res.json();
      renderUserProfile(data.taste_profile);
    }
  } catch (err) {
    console.error('Failed to load user profile:', err);
  }
}

async function loadSessionData() {
  try {
    const res = await fetch(`${API_BASE}/api/session/${currentSessionId}?user_id=${currentUserId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.notebook) {
        renderNotebook(data.notebook);
      }
    }
  } catch (err) {
    console.error('Failed to load session:', err);
  }
}

function renderUserProfile(tp) {
  if (!tp) return;
  profileSummary.textContent = tp.summary || 'Custom Taste Profile active.';
  
  // Weights
  const w = tp.weights || {};
  const auth = w.authenticity || 0.85;
  const cul = w.culinary_quality || 0.90;
  const amb = w.scenic_ambiance || 0.80;
  const val = w.value_for_money || 0.75;

  weightAuth.style.width = `${auth * 100}%`;
  valAuth.textContent = auth.toFixed(2);

  weightCulinary.style.width = `${cul * 100}%`;
  valCulinary.textContent = cul.toFixed(2);

  weightAmbiance.style.width = `${amb * 100}%`;
  valAmbiance.textContent = amb.toFixed(2);

  weightValue.style.width = `${val * 100}%`;
  valValue.textContent = val.toFixed(2);

  // Tags
  renderTagList(profileVibes, tp.vibes || []);
  renderTagList(profileCuisines, tp.cuisines || []);
  renderTagList(profileAvoids, tp.avoid || []);
}

function renderTagList(container, tags) {
  container.innerHTML = '';
  tags.forEach(t => {
    const span = document.createElement('span');
    span.className = 'tag-pill';
    span.textContent = t;
    container.appendChild(span);
  });
}

function renderNotebook(nb) {
  if (!nb) return;
  nbDestination.textContent = nb.destination || 'Not set';
  
  // Preferences
  const prefs = nb.clarified_preferences || {};
  nbPreferences.innerHTML = '';
  const prefKeys = Object.keys(prefs);
  if (prefKeys.length === 0) {
    nbPreferences.innerHTML = '<span class="empty-hint">Agent will record your preferences here as we converse.</span>';
  } else {
    prefKeys.forEach(k => {
      const span = document.createElement('span');
      span.className = 'tag-pill';
      span.textContent = `${k}: ${prefs[k]}`;
      nbPreferences.appendChild(span);
    });
  }

  // Notes
  const notes = nb.itinerary_notes || [];
  nbNotes.innerHTML = '';
  if (notes.length === 0) {
    nbNotes.innerHTML = '<li class="empty-hint">No notes logged yet.</li>';
  } else {
    notes.forEach(n => {
      const li = document.createElement('li');
      li.textContent = n;
      nbNotes.appendChild(li);
    });
  }

  // Shortlist
  const shortlist = nb.shortlist || [];
  nbShortlistCount.textContent = shortlist.length;
  nbShortlist.innerHTML = '';
  if (shortlist.length === 0) {
    nbShortlist.innerHTML = '<div class="empty-hint">Saved recommendations appear here.</div>';
  } else {
    shortlist.forEach(p => {
      const card = document.createElement('div');
      card.className = 'place-card';
      card.innerHTML = `
        <div class="place-header">
          <div class="place-name">${p.name}</div>
          <div class="place-score">★ ${p.rating || '4.5'}</div>
        </div>
        <div class="place-reason">${p.match_reason || ''}</div>
      `;
      nbShortlist.appendChild(card);
    });
  }
}

// Chat Submission
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  appendUserMessage(text);
  clarificationBar.classList.add('hidden');

  // Loading indicator
  const loadingCard = appendLoadingMessage();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUserId,
        session_id: currentSessionId,
        message: text
      })
    });

    loadingCard.remove();

    if (res.ok) {
      const data = await res.json();
      appendAgentResponse(data);
      if (data.notebook) {
        renderNotebook(data.notebook);
      }
    } else {
      appendErrorMessage('Failed to get response from Collaborative Agent.');
    }
  } catch (err) {
    loadingCard.remove();
    console.error('Chat error:', err);
    appendErrorMessage('Connection error. Ensure the backend server is running.');
  }
});

function appendUserMessage(text) {
  const card = document.createElement('div');
  card.className = 'message-card user';
  card.innerHTML = `
    <div class="avatar">👤</div>
    <div class="content">
      <div class="sender-name">You</div>
      <div class="text"><p>${escapeHtml(text)}</p></div>
    </div>
  `;
  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendLoadingMessage() {
  const card = document.createElement('div');
  card.className = 'message-card agent';
  card.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="content">
      <div class="sender-name">Taste Partner <span>Thinking...</span></div>
      <div class="text"><p>Synthesizing taste profile & querying Google Places...</p></div>
    </div>
  `;
  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return card;
}

function appendAgentResponse(data) {
  const card = document.createElement('div');
  card.className = 'message-card agent';

  let placesHtml = '';
  if (data.places && data.places.length > 0) {
    placesHtml = '<div class="places-grid">';
    data.places.forEach(p => {
      placesHtml += `
        <div class="place-card">
          <div class="place-header">
            <div>
              <div class="place-name">${escapeHtml(p.name)}</div>
              <div class="place-meta">
                <span>⭐ ${p.rating || 'N/A'} (${p.review_count || 0} reviews)</span>
                <span>• ${escapeHtml(p.address || '')}</span>
              </div>
            </div>
            <div class="place-score">Match: ${p.taste_match_score || 85}%</div>
          </div>
          <div class="place-reason">💡 ${escapeHtml(p.match_reason || '')}</div>
          <div class="place-actions">
            <div class="feedback-buttons">
              <button class="btn-thumb" onclick="sendFeedback('${p.id}', '${escapeHtml(p.name)}', 'like')">👍 Love it</button>
              <button class="btn-thumb" onclick="sendFeedback('${p.id}', '${escapeHtml(p.name)}', 'too_touristy')">🚩 Touristy</button>
              <button class="btn-thumb" onclick="sendFeedback('${p.id}', '${escapeHtml(p.name)}', 'wrong_vibe')">🎭 Wrong Vibe</button>
            </div>
            <a href="${p.maps_url}" target="_blank" class="maps-link">Open in Maps ↗</a>
          </div>
        </div>
      `;
    });
    placesHtml += '</div>';
  }

  card.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="content">
      <div class="sender-name">Taste Partner</div>
      <div class="text">${markedParse(data.message || '')}</div>
      ${placesHtml}
    </div>
  `;
  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // Handle Clarifying Questions
  if (data.clarifying_questions && data.clarifying_questions.length > 0) {
    clarificationItems.innerHTML = '';
    data.clarifying_questions.forEach(q => {
      const qDiv = document.createElement('div');
      qDiv.className = 'clarification-item';
      qDiv.innerHTML = `<strong>❓ ${escapeHtml(q)}</strong>`;
      qDiv.onclick = () => {
        chatInput.value = `Regarding "${q}": `;
        chatInput.focus();
      };
      clarificationItems.appendChild(qDiv);
    });
    clarificationBar.classList.remove('hidden');
  }
}

function appendErrorMessage(msg) {
  const card = document.createElement('div');
  card.className = 'message-card agent';
  card.innerHTML = `
    <div class="avatar">⚠️</div>
    <div class="content" style="border-color: #ef4444;">
      <div class="sender-name">System</div>
      <div class="text"><p style="color: #fca5a5;">${escapeHtml(msg)}</p></div>
    </div>
  `;
  chatContainer.appendChild(card);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Interactive Feedback Loop
async function sendFeedback(placeId, placeName, feedbackType) {
  try {
    const res = await fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUserId,
        session_id: currentSessionId,
        place_id: placeId,
        place_name: placeName,
        feedback_type: feedbackType
      })
    });
    if (res.ok) {
      alert(`Feedback recorded: "${feedbackType}". Live taste vector adapted in Firestore!`);
      loadUserProfile();
    }
  } catch (err) {
    console.error('Feedback failed:', err);
  }
}

function sendPrompt(text) {
  chatInput.value = text;
  chatForm.dispatchEvent(new Event('submit'));
}

// Modal Handling
btnUploadModal.onclick = () => uploadModal.classList.remove('hidden');
function closeModal() { uploadModal.classList.add('hidden'); }

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  uploadStatus.classList.remove('hidden');
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/api/upload-takeout?user_id=${currentUserId}`, {
      method: 'POST',
      body: formData
    });
    uploadStatus.classList.add('hidden');
    if (res.ok) {
      const data = await res.json();
      alert(`Successfully analyzed ${data.count} places with Gemini 3.5 on Vertex AI!`);
      closeModal();
      loadUserProfile();
    } else {
      alert('Upload failed. Please ensure the file is valid JSON.');
    }
  } catch (err) {
    uploadStatus.classList.add('hidden');
    alert('Upload error.');
  }
});

btnResetSession.onclick = () => {
  if (confirm('Start a fresh discovery session?')) {
    currentSessionId = 'sess_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('tf_session_id', currentSessionId);
    window.location.reload();
  }
};

// Utilities
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function markedParse(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

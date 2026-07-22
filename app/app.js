// Taste Finder — Main app logic

const App = {
  savedPlaces: new Set(), // starred places (session only)
  selectedPlaces: [], // checkbox-selected places for export
  currentPage: 0,
  pageSize: 10,
  currentResults: [],       // filtered view (score + display cap)
  allRankedResults: [],     // full ranked list for current search
  minScore: CONFIG.DEFAULT_MIN_SCORE || 5,
  sortBy: "score",
  currentCity: "",
  queryCount: 0,
  totalRanked: 0,
  resultMap: null,
  mapMarkers: [],
  _resultId: null,

  init() {
    this.cacheElements();
    this.bindEvents();
    this.loadFromStorage();
    this.loadChatHistory();
    if (document.querySelectorAll(".message").length === 0) {
      this.showWelcome();
    }
  },

  cacheElements() {
    this.els = {
      placesKey: document.getElementById("places-key"),
      llmKey: document.getElementById("llm-key"),
      llmModel: document.getElementById("llm-model"),
      dropZone: document.getElementById("drop-zone"),
      fileInput: document.getElementById("file-input"),
      fileStatus: document.getElementById("file-status"),
      profileSection: document.getElementById("profile-section"),
      profileDisplay: document.getElementById("profile-display"),
      rebuildProfile: document.getElementById("rebuild-profile"),
      messages: document.getElementById("messages"),
      typingIndicator: document.getElementById("typing-indicator"),
      chatInput: document.getElementById("chat-input"),
      sendBtn: document.getElementById("send-btn"),
    };
  },

  bindEvents() {
    // API key inputs — save to localStorage
    this.els.placesKey.addEventListener("input", () => {
      Engine.state.apiKey_places = this.els.placesKey.value;
      localStorage.setItem("tf_places_key", this.els.placesKey.value);
      this.checkReady();
    });
    this.els.llmKey.addEventListener("input", () => {
      Engine.state.apiKey_llm = this.els.llmKey.value;
      localStorage.setItem("tf_llm_key", this.els.llmKey.value);
      this.checkReady();
    });
    this.els.llmModel.addEventListener("change", () => {
      Engine.state.llmModel = this.els.llmModel.value;
      localStorage.setItem("tf_llm_model", this.els.llmModel.value);
    });

    // File upload
    this.els.dropZone.addEventListener("click", () => this.els.fileInput.click());
    this.els.dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.els.dropZone.classList.add("dragover");
    });
    this.els.dropZone.addEventListener("dragleave", () => {
      this.els.dropZone.classList.remove("dragover");
    });
    this.els.dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      this.els.dropZone.classList.remove("dragover");
      if (e.dataTransfer.files[0]) this.handleFile(e.dataTransfer.files[0]);
    });
    this.els.fileInput.addEventListener("change", (e) => {
      if (e.target.files[0]) this.handleFile(e.target.files[0]);
    });

    // Rebuild profile
    this.els.rebuildProfile.addEventListener("click", () => this.buildProfile());

    // Chat
    this.els.sendBtn.addEventListener("click", () => this.sendMessage());
    this.els.chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.sendMessage();
    });

    // Selection toolbar
    document.getElementById("open-selected-maps")?.addEventListener("click", () => this.openSelectedInMaps());
    document.getElementById("download-kml")?.addEventListener("click", () => this.downloadKML());
    document.getElementById("download-csv")?.addEventListener("click", () => this.downloadCSV());
    document.getElementById("clear-selection")?.addEventListener("click", () => this.clearSelection());

    // Clear chat
    document.getElementById("clear-chat")?.addEventListener("click", () => this.clearChatHistory());

    // Event delegation for result list (checkboxes / stars) — safe with special chars in names
    this.els.messages.addEventListener("change", (e) => {
      const t = e.target;
      if (t && t.matches?.("input.place-select-cb")) {
        const key = t.getAttribute("data-place-key");
        this.toggleSelectByKey(key, t.checked);
      }
    });
    this.els.messages.addEventListener("click", (e) => {
      const btn = e.target.closest?.("button.star-btn");
      if (btn) {
        const key = btn.getAttribute("data-place-key");
        this.toggleStarByKey(key, btn);
      }
    });
  },

  placeKey(p) {
    return p.id || p.name;
  },

  findPlaceByKey(key, list = this.currentResults) {
    return list.find(p => this.placeKey(p) === key)
      || this.allRankedResults.find(p => this.placeKey(p) === key)
      || this.selectedPlaces.find(p => this.placeKey(p) === key);
  },

  loadFromStorage() {
    const pk = localStorage.getItem("tf_places_key");
    const lk = localStorage.getItem("tf_llm_key");
    const lm = localStorage.getItem("tf_llm_model");
    const places = localStorage.getItem("tf_places_data");

    if (pk) { this.els.placesKey.value = pk; Engine.state.apiKey_places = pk; }
    if (lk) { this.els.llmKey.value = lk; Engine.state.apiKey_llm = lk; }
    if (lm) { this.els.llmModel.value = lm; Engine.state.llmModel = lm; }

    if (places) {
      try {
        Engine.state.places = JSON.parse(places);
        this.els.fileStatus.textContent = `✓ ${Engine.state.places.length} places loaded`;
      } catch { Engine.state.places = []; }
      const profile = localStorage.getItem("tf_profile");
      if (profile) {
        try {
          Engine.state.profile = JSON.parse(profile);
          this.displayProfile();
          this.checkReady();
        } catch { /* ignore */ }
      } else if (Engine.state.apiKey_llm) {
        this.buildProfile();
      }
    }

    this.checkReady();
  },

  checkReady() {
    const ready = Engine.state.apiKey_places && Engine.state.apiKey_llm &&
      Engine.state.profile && Engine.state.places.length > 0;
    this.els.chatInput.disabled = !ready;
    this.els.sendBtn.disabled = !ready;
    if (ready) {
      this.els.chatInput.placeholder = "Ask: 'Find fresh fish in Catania' or 'Craft beer in Berlin'";
    } else if (!Engine.state.profile) {
      this.els.chatInput.placeholder = "Upload your Google Maps export to start...";
    } else if (!Engine.state.apiKey_places || !Engine.state.apiKey_llm) {
      this.els.chatInput.placeholder = "Enter your API keys to start...";
    }
  },

  async handleFile(file) {
    this.els.fileStatus.textContent = "Parsing...";
    try {
      const places = await Parser.parse(file);
      Engine.state.places = places;
      localStorage.setItem("tf_places_data", JSON.stringify(places));
      this.els.fileStatus.textContent = `✓ ${places.length} places loaded`;
      await this.buildProfile();
    } catch (err) {
      this.els.fileStatus.textContent = `✗ Error: ${err.message}`;
    }
  },

  async buildProfile() {
    if (Engine.state.places.length === 0) {
      this.addMessage("bot", "Please upload your Google Maps export first.");
      return;
    }
    if (!Engine.state.apiKey_llm) {
      this.addMessage("bot", "Please enter your OpenRouter API key first.");
      return;
    }

    this.els.profileSection.style.display = "block";
    this.els.profileDisplay.innerHTML = "<p>Analyzing your places...</p>";

    const total = Engine.state.places.length;
    this.addMessage("bot", `🔍 Analyzing ${total} saved places to build your taste profile. This may take a few minutes for large exports...`);

    try {
      const profile = await Engine.buildProfile(Engine.state.places, (idx, totalBatches) => {
        if (idx === "merging") {
          this.updateProgress("🧠 Synthesizing final taste profile from all batches...");
        } else {
          const pct = Math.round((idx / totalBatches) * 100);
          this.updateProgress(`📊 Analyzing batch ${idx}/${totalBatches} (${pct}%) — processing your saved places...`);
        }
      });

      this.clearProgress();

      Engine.state.profile = profile;
      localStorage.setItem("tf_profile", JSON.stringify(profile));
      this.displayProfile();
      this.checkReady();
      this.addMessage("bot", `✅ Taste profile ready! ${profile.summary || ""}\n\nAsk me to find places in any city. Try: *"Find fresh fish in Catania"* or *"Craft beer bars in Berlin"*`);
    } catch (err) {
      this.els.profileDisplay.innerHTML = `<p style="color:#ef4444">Error: ${err.message}</p>`;
      this.addMessage("bot", `❌ Failed to build profile: ${err.message}`);
    }
  },

  displayProfile() {
    const p = Engine.state.profile;
    if (!p) return;

    let html = "";
    if (p.summary) html += `<p class="profile-summary">${this.escapeHtml(p.summary)}</p>`;
    if (p.cuisine_preferences?.length) {
      html += `<div>${p.cuisine_preferences.slice(0, 8).map(k => `<span class="profile-tag">${this.escapeHtml(k)}</span>`).join("")}</div>`;
    }
    if (p.outdoor_interests?.length) {
      html += `<div style="margin-top:6px">${p.outdoor_interests.slice(0, 5).map(k => `<span class="profile-tag">🌿 ${this.escapeHtml(k)}</span>`).join("")}</div>`;
    }
    if (p.drink_preferences?.length) {
      html += `<div style="margin-top:6px">${p.drink_preferences.slice(0, 5).map(k => `<span class="profile-tag">🍹 ${this.escapeHtml(k)}</span>`).join("")}</div>`;
    }
    this.els.profileDisplay.innerHTML = html;
    this.els.profileSection.style.display = "block";
  },

  showWelcome() {
    if (Engine.state.places.length === 0) {
      this.addMessage("bot", `Welcome to **Taste Finder**! 🍽️\n\nI learn your taste from your Google Maps saved places and recommend similar spots anywhere.\n\n**To get started:**\n1. Enter your Google Places + OpenRouter API keys (sidebar)\n2. Upload your Google Maps export from [Google Takeout](https://takeout.google.com)\n3. Ask me: *"Find fresh fish in Catania"*\n\nYour keys stay in your browser. No server, no tracking.`);
    } else if (Engine.state.profile) {
      const summary = Engine.state.profile.summary || "";
      this.addMessage("bot", `✅ **Ready!** Your taste profile is loaded.\n\n${summary}\n\nTry: *"Find fresh fish in Catania"* or *"Craft beer bars in Berlin"*`);
    } else {
      this.addMessage("bot", `Welcome back! You have **${Engine.state.places.length} places** loaded. Enter your API keys in the sidebar and I'll build your taste profile.`);
    }
  },

  async sendMessage() {
    const text = this.els.chatInput.value.trim();
    if (!text) return;

    this.addMessage("user", text);
    this.els.chatInput.value = "";
    this.setTyping(true);

    try {
      await this.processQuery(text);
    } catch (err) {
      this.addMessage("bot", `❌ Error: ${err.message}`);
    }

    this.setTyping(false);
  },

  async processQuery(text) {
    const profile = Engine.state.profile;
    if (!profile) {
      this.addMessage("bot", "Please upload your Google Maps export first to build a taste profile.");
      return;
    }

    const intent = Engine.parseUserIntent(text);
    const queries = Engine.buildQueries(profile, text);
    if (queries.length === 0) {
      this.addMessage("bot", "I couldn't understand that. Try: 'Find fresh fish in Catania'");
      return;
    }

    const city = intent.city || "your area";
    this.addMessage("bot", `🔍 Searching ${queries.length} queries for places in **${city}**...`);

    try {
      // Geocode city once → locationBias for all Text Search calls
      let locationBias = null;
      if (intent.city) {
        this.updateProgress(`📍 Locating ${intent.city} for map bias...`);
        locationBias = await Engine.geocodeCity(intent.city);
        if (locationBias) {
          this.updateProgress(`📍 Centered on ${locationBias.label || intent.city} (±${Math.round((CONFIG.LOCATION_BIAS_RADIUS_M || 25000) / 1000)}km)`);
        }
      }

      const candidates = await Engine.searchAllQueries(queries, (idx, total, query) => {
        this.updateProgress(`🔎 Searching query ${idx}/${total}: "${query}" — found ${Engine.state._lastCount || 0} places so far...`);
      }, locationBias);

      if (candidates.length === 0) {
        this.clearProgress();
        this.addMessage("bot", "No places found. Try a different query or city.");
        return;
      }

      this.clearProgress();
      this.addMessage("bot", `Found **${candidates.length} candidates** across ${queries.length} searches. Ranking ALL of them against your taste profile...`);

      const searchTerm = intent.searchTerm || text;
      const ranked = await Engine.rankCandidates(candidates, profile, (idx, total) => {
        const pct = Math.round((idx / total) * 100);
        this.updateProgress(`⏳ Ranking batch ${idx}/${total} (${pct}%) — scored ${Engine.state._scoredCount || 0} places so far...`);
      }, searchTerm);

      this.clearProgress();

      // Keep full ranked set; display filters applied in applyFilters
      this.allRankedResults = ranked;
      this.minScore = CONFIG.DEFAULT_MIN_SCORE || 5;
      this.sortBy = "score";
      this.currentCity = city;
      this.queryCount = queries.length;
      this.totalRanked = ranked.length;
      this.selectedPlaces = []; // clear selection on new search
      this.updateSelectionUI();

      this.applyFilters({ resetPage: true });
      if (this.currentResults.length === 0) {
        this.addMessage("bot", `Ranked ${ranked.length} places but none scored ≥ ${this.minScore}. Try a lower min score or a different query.`);
        // Still show results UI so user can lower the filter
        this.minScore = 0;
        this.applyFilters({ resetPage: true });
      }

      this.renderResultsMessage();
    } catch (err) {
      this.clearProgress();
      this.addMessage("bot", `❌ Search error: ${err.message}. Please check your API keys and try again.`);
    }
  },

  applyFilters({ resetPage = false } = {}) {
    const maxDisplay = CONFIG.MAX_DISPLAY_RESULTS || 100;
    let list = (this.allRankedResults || []).filter(r => (r.score || 0) >= this.minScore);

    if (this.sortBy === "score") {
      list.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (this.sortBy === "rating") {
      // Missing ratings last
      list.sort((a, b) => {
        const ar = a.rating == null ? -1 : a.rating;
        const br = b.rating == null ? -1 : b.rating;
        if (br !== ar) return br - ar;
        return (b.score || 0) - (a.score || 0);
      });
    } else if (this.sortBy === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    this.currentResults = list.slice(0, maxDisplay);
    if (resetPage) this.currentPage = 0;
  },

  renderResultsMessage() {
    const places = this.currentResults;
    const totalPages = Math.ceil(places.length / this.pageSize);
    this._resultId = Date.now();

    const aboveMin = (this.allRankedResults || []).filter(r => (r.score || 0) >= this.minScore).length;
    const city = this.currentCity || "this area";

    // Lightweight shell — cards/map filled by renderPage/renderMap (not saved as giant HTML)
    let html = "";
    html += `<div class="results-shell" data-result-id="${this._resultId}">`;
    html += `<p>Here are <strong>${places.length} places in ${this.escapeHtml(city)}</strong> that match your taste:</p>`;
    html += `<p class="results-meta">📊 Ranked ${this.totalRanked} candidates from ${this.queryCount} searches. Showing ${places.length} with score ≥ ${this.minScore}/10`;
    if (aboveMin > places.length) html += ` (capped at ${CONFIG.MAX_DISPLAY_RESULTS})`;
    html += `.</p>`;

    // Toolbar
    html += `<div class="results-toolbar">`;
    html += `<div class="toolbar-left">`;
    html += `<button type="button" onclick="App.selectAll()">☑️ Select All</button>`;
    html += `<button type="button" onclick="App.selectNone()">☐ Unselect All</button>`;
    html += `<span class="toolbar-label">Min score:</span>`;
    html += `<select class="sort-select" id="min-score-${this._resultId}" onchange="App.setMinScore(this.value)">`;
    for (const n of [0, 3, 4, 5, 6, 7, 8]) {
      html += `<option value="${n}" ${n === this.minScore ? "selected" : ""}>${n}+</option>`;
    }
    html += `</select>`;
    html += `<span class="toolbar-label">Sort:</span>`;
    html += `<select class="sort-select" id="sort-${this._resultId}" onchange="App.sortResults(this.value)">`;
    html += `<option value="score" ${this.sortBy === "score" ? "selected" : ""}>Taste Score</option>`;
    html += `<option value="rating" ${this.sortBy === "rating" ? "selected" : ""}>Rating</option>`;
    html += `<option value="name" ${this.sortBy === "name" ? "selected" : ""}>Name</option>`;
    html += `</select>`;
    html += `</div>`;
    html += `<div class="toolbar-right">`;
    html += `<button type="button" onclick="App.toggleMap()">🗺️ Toggle Map</button>`;
    html += `</div>`;
    html += `</div>`;

    // Map
    html += `<div class="map-container" id="map-container-${this._resultId}">`;
    html += `<div class="map-header" onclick="App.toggleMap()"><span>🗺️ Map View — <span id="map-count-${this._resultId}">${places.filter(p => p.lat && p.lng).length}</span> mapped</span><span class="toggle-icon">▼</span></div>`;
    html += `<div class="results-map" id="results-map-${this._resultId}"></div>`;
    html += `</div>`;

    html += `<div id="place-cards-${this._resultId}"></div>`;
    if (totalPages > 1) {
      html += `<div class="pagination" id="pagination-${this._resultId}"></div>`;
    } else {
      html += `<div class="pagination" id="pagination-${this._resultId}" style="display:none"></div>`;
    }
    html += `</div>`;

    this.addMessage("bot", html, { skipHistory: true });
    // Persist structured snapshot instead of giant HTML
    this.saveResultsSnapshot();

    this.renderPage();
    setTimeout(() => this.renderMap(), 100);
  },

  setMinScore(val) {
    this.minScore = Number(val) || 0;
    this.applyFilters({ resetPage: true });
    this.renderPage();
    this.renderMap();
    this.updateResultsMeta();
    this.saveResultsSnapshot();
  },

  updateResultsMeta() {
    // Soft update of map header count if present
    const mapCount = document.getElementById(`map-count-${this._resultId}`);
    if (mapCount) {
      mapCount.textContent = String(this.currentResults.filter(p => p.lat && p.lng).length);
    }
  },

  renderPage() {
    const places = this.currentResults;
    const totalPages = Math.ceil(Math.max(places.length, 1) / this.pageSize);
    if (this.currentPage >= totalPages) this.currentPage = Math.max(0, totalPages - 1);
    const start = this.currentPage * this.pageSize;
    const end = start + this.pageSize;
    const pagePlaces = places.slice(start, end);

    const container = document.getElementById(`place-cards-${this._resultId}`);
    if (!container) return;

    let html = "";
    for (let i = 0; i < pagePlaces.length; i++) {
      html += this.placeCardHTML(pagePlaces[i], start + i + 1);
    }
    if (pagePlaces.length === 0) {
      html = `<p class="results-meta">No places at this score threshold.</p>`;
    }
    container.innerHTML = html;

    const pagContainer = document.getElementById(`pagination-${this._resultId}`);
    if (pagContainer) {
      if (totalPages > 1 && places.length > 0) {
        pagContainer.style.display = "";
        let pagHtml = "";
        pagHtml += `<button type="button" onclick="App.goToPage(${this.currentPage - 1})" ${this.currentPage === 0 ? "disabled" : ""}>← Prev</button>`;
        // Collapse long page lists
        const maxButtons = 12;
        let from = 0;
        let to = totalPages;
        if (totalPages > maxButtons) {
          from = Math.max(0, this.currentPage - 4);
          to = Math.min(totalPages, from + maxButtons);
          from = Math.max(0, to - maxButtons);
        }
        if (from > 0) pagHtml += `<span class="page-info">…</span>`;
        for (let i = from; i < to; i++) {
          pagHtml += `<button type="button" onclick="App.goToPage(${i})" class="${i === this.currentPage ? "active" : ""}">${i + 1}</button>`;
        }
        if (to < totalPages) pagHtml += `<span class="page-info">…</span>`;
        pagHtml += `<button type="button" onclick="App.goToPage(${this.currentPage + 1})" ${this.currentPage >= totalPages - 1 ? "disabled" : ""}>Next →</button>`;
        pagHtml += `<span class="page-info">${start + 1}-${Math.min(end, places.length)} of ${places.length}</span>`;
        pagContainer.innerHTML = pagHtml;
      } else {
        pagContainer.style.display = "none";
        pagContainer.innerHTML = "";
      }
    }

    this.scrollToBottom();
  },

  goToPage(page) {
    const totalPages = Math.ceil(this.currentResults.length / this.pageSize);
    if (page < 0 || page >= totalPages) return;
    this.currentPage = page;
    this.renderPage();
  },

  sortResults(sortBy) {
    this.sortBy = sortBy || "score";
    this.applyFilters({ resetPage: true });
    this.renderPage();
    this.renderMap();
    this.saveResultsSnapshot();
  },

  toggleMap() {
    const container = document.getElementById(`map-container-${this._resultId}`);
    if (container) {
      container.classList.toggle("collapsed");
      if (!container.classList.contains("collapsed") && this.resultMap) {
        setTimeout(() => this.resultMap.invalidateSize(), 100);
      }
    }
  },

  renderMap() {
    const mapEl = document.getElementById(`results-map-${this._resultId}`);
    if (!mapEl) return;

    if (this.resultMap) {
      this.resultMap.remove();
      this.resultMap = null;
    }

    const places = this.currentResults.filter(p => p.lat != null && p.lng != null);
    if (places.length === 0) {
      mapEl.innerHTML = `<div class="map-empty">No coordinates for these results</div>`;
      return;
    }

    this.resultMap = L.map(mapEl, { scrollWheelZoom: false });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(this.resultMap);

    this.mapMarkers = [];
    const bounds = [];

    for (const p of places) {
      const score = Math.round(p.score || 0);
      const icon = L.divIcon({
        className: "custom-marker-wrap",
        html: `<div class="custom-marker" title="${this.escapeHtml(p.name)}"><span>${score}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -24],
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(this.resultMap);
      const mapsHref = p.google_maps_uri
        || (p.lat && p.lng
          ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + " " + (p.address || ""))}`);
      const popupHtml = `
        <strong>${this.escapeHtml(p.name)}</strong><br>
        <span style="color:#f97316">★ ${score}/10</span>
        ${p.rating != null ? ` | ⭐ ${p.rating} (${p.user_rating_count || 0})` : ""}<br>
        ${p.reason ? this.escapeHtml(p.reason) + "<br>" : ""}
        <a href="${mapsHref}" target="_blank" rel="noopener">Open in Maps →</a>
      `;
      marker.bindPopup(popupHtml);
      this.mapMarkers.push(marker);
      bounds.push([p.lat, p.lng]);
    }

    if (bounds.length === 1) {
      this.resultMap.setView(bounds[0], 14);
    } else if (bounds.length > 1) {
      this.resultMap.fitBounds(bounds, { padding: [40, 40] });
    }

    setTimeout(() => {
      if (this.resultMap) this.resultMap.invalidateSize();
    }, 200);
    this.updateResultsMeta();
  },

  // ─── Selection / Export ───────────────────────────────

  toggleSelectByKey(key, checked) {
    const place = this.findPlaceByKey(key);
    if (!place) return;
    if (checked) {
      if (!this.selectedPlaces.find(p => this.placeKey(p) === key)) {
        this.selectedPlaces.push(place);
      }
    } else {
      this.selectedPlaces = this.selectedPlaces.filter(p => this.placeKey(p) !== key);
    }
    this.updateSelectionUI();
  },

  selectAll() {
    for (const p of this.currentResults) {
      const key = this.placeKey(p);
      if (!this.selectedPlaces.find(s => this.placeKey(s) === key)) {
        this.selectedPlaces.push(p);
      }
    }
    this.renderPage();
    this.updateSelectionUI();
  },

  selectNone() {
    const currentKeys = new Set(this.currentResults.map(p => this.placeKey(p)));
    this.selectedPlaces = this.selectedPlaces.filter(p => !currentKeys.has(this.placeKey(p)));
    this.renderPage();
    this.updateSelectionUI();
  },

  clearSelection() {
    this.selectedPlaces = [];
    this.renderPage();
    this.updateSelectionUI();
  },

  updateSelectionUI() {
    const section = document.getElementById("selection-section");
    const countEl = document.getElementById("selection-count");
    const btns = ["open-selected-maps", "download-kml", "download-csv"];
    if (!section || !countEl) return;

    if (this.selectedPlaces.length > 0) {
      section.style.display = "block";
      countEl.textContent = `${this.selectedPlaces.length} place${this.selectedPlaces.length > 1 ? "s" : ""} selected`;
      btns.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
      });
    } else {
      section.style.display = "none";
      btns.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      });
    }
  },

  openSelectedInMaps() {
    if (this.selectedPlaces.length === 0) return;

    const maxStops = CONFIG.MAPS_DIR_MAX_STOPS || 10;
    let stops = this.selectedPlaces.slice(0, maxStops);

    // Prefer lat,lng waypoints — more reliable than free-text geocoding
    const parts = stops.map(p => {
      if (p.lat != null && p.lng != null) return `${p.lat},${p.lng}`;
      return encodeURIComponent(`${p.name} ${p.address || ""}`.trim());
    });

    if (this.selectedPlaces.length > maxStops) {
      // Adaptive fallback: open truncated route + tell user
      this.addMessage("bot", `⚠️ Google Maps directions support ~${maxStops} stops. Opening the first ${maxStops} of ${this.selectedPlaces.length}. Use **KML** for the full set in My Maps.`);
    }

    const url = `https://www.google.com/maps/dir/${parts.join("/")}`;
    window.open(url, "_blank", "noopener");
  },

  downloadKML() {
    if (this.selectedPlaces.length === 0) return;
    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>Taste Finder Selection</name>\n`;
    let skipped = 0;
    for (const p of this.selectedPlaces) {
      const score = Math.round(p.score || 0);
      const title = `(${score}) ${p.name}`;
      kml += `<Placemark>\n<name><![CDATA[${title}]]></name>\n`;
      const descBits = [];
      if (p.reason) descBits.push(p.reason);
      if (p.rating != null) descBits.push(`Google: ${p.rating} (${p.user_rating_count || 0})`);
      if (p.address) descBits.push(p.address);
      if (p.google_maps_uri) descBits.push(p.google_maps_uri);
      if (descBits.length) {
        kml += `<description><![CDATA[${descBits.join("\n")}]]></description>\n`;
      }
      if (p.lat != null && p.lng != null) {
        kml += `<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>\n`;
      } else {
        skipped++;
      }
      kml += `</Placemark>\n`;
    }
    kml += `</Document>\n</kml>`;
    this.downloadFile(kml, "taste-finder-places.kml", "application/vnd.google-earth.kml+xml");
    if (skipped > 0) {
      this.addMessage("bot", `⚠️ ${skipped} selected place(s) had no coordinates — KML includes name only for those.`);
    }
  },

  downloadCSV() {
    if (this.selectedPlaces.length === 0) return;
    let csv = "Name,Category,Score,Rating,Reviews,Price,Address,Website,GoogleMaps,Lat,Lng,Id\n";
    for (const p of this.selectedPlaces) {
      const fields = [
        p.name, p.category, p.score, p.rating ?? "", p.user_rating_count ?? "",
        p.price_level, p.address, p.website, p.google_maps_uri, p.lat ?? "", p.lng ?? "", p.id || "",
      ];
      csv += fields.map(f => `"${String(f ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`).join(",") + "\n";
    }
    this.downloadFile(csv, "taste-finder-places.csv", "text/csv");
  },

  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  placeCardHTML(p, index) {
    const score = Math.round(p.score || 0);
    const key = this.placeKey(p);
    const keyAttr = this.escapeAttr(key);
    const isSaved = this.savedPlaces.has(key);
    const isSelected = !!this.selectedPlaces.find(s => this.placeKey(s) === key);

    let meta = [];
    if (p.rating != null) meta.push(`★ ${p.rating} (${p.user_rating_count || 0} reviews)`);
    if (p.price_level) meta.push(`💰 ${p.price_level}`);
    if (p.category) meta.push(`📍 ${p.category}`);
    const metaHTML = meta.map(m => `<span>${this.escapeHtml(m)}</span>`).join("");

    let amenities = [];
    if (p.serves_coffee) amenities.push("☕ coffee");
    if (p.serves_beer) amenities.push("🍺 beer");
    if (p.serves_wine) amenities.push("🍷 wine");
    if (p.serves_cocktails) amenities.push("🍹 cocktails");
    if (p.serves_brunch) amenities.push("🥐 brunch");
    if (p.serves_dessert) amenities.push("🍰 dessert");
    if (p.serves_vegetarian) amenities.push("🥗 vegetarian");
    if (p.outdoor_seating) amenities.push("🌿 outdoor");
    if (p.live_music) amenities.push("🎵 live music");
    const amenHTML = amenities.length
      ? `<div class="place-meta">${amenities.map(a => `<span>${a}</span>`).join("")}</div>`
      : "";

    const mapsHref = p.google_maps_uri
      || (p.lat != null && p.lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.name + " " + (p.address || "")).trim())}`);

    return `
      <div class="place-card" data-place-key="${keyAttr}">
        <div class="card-top-bar">
          <div class="place-name">${index ? `${index}. ` : ""}${this.escapeHtml(p.name)}</div>
          <label class="select-checkbox">
            <input type="checkbox" class="place-select-cb" data-place-key="${keyAttr}" ${isSelected ? "checked" : ""}>
            <span>Select</span>
          </label>
        </div>
        <div class="place-card-header">
          <div></div>
          <div class="place-score">${score}/10</div>
        </div>
        <div class="place-meta">${metaHTML}</div>
        ${amenHTML}
        <div class="place-reason">${this.escapeHtml(p.reason || "")}</div>
        ${p.editorial_summary ? `<div class="place-summary">${this.escapeHtml(p.editorial_summary)}</div>` : ""}
        <div class="place-actions">
          <a href="${this.escapeAttr(mapsHref)}" target="_blank" rel="noopener">🗺️ Open in Maps</a>
          ${p.website ? `<a href="${this.escapeAttr(p.website)}" target="_blank" rel="noopener">🌐 Website</a>` : ""}
          <button type="button" class="star-btn ${isSaved ? "saved" : ""}" data-place-key="${keyAttr}">${isSaved ? "⭐ Saved" : "☆ Save"}</button>
        </div>
      </div>`;
  },

  toggleStarByKey(key, btn) {
    if (!key) return;
    if (this.savedPlaces.has(key)) {
      this.savedPlaces.delete(key);
      btn.classList.remove("saved");
      btn.innerHTML = "☆ Save";
    } else {
      this.savedPlaces.add(key);
      btn.classList.add("saved");
      btn.innerHTML = "⭐ Saved";
    }
  },

  escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  escapeAttr(str) {
    return this.escapeHtml(str).replace(/`/g, "&#96;");
  },

  // contentToHtml: markdown-ish for plain text; raw HTML passthrough when already HTML
  contentToHtml(content) {
    if (content == null) return "";
    const s = String(content);
    // Result shells / already-built HTML
    if (s.includes("<div") || s.includes("<p>") || s.includes("<button")) {
      return s;
    }
    return s
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
  },

  addMessage(role, content, opts = {}) {
    const msg = document.createElement("div");
    msg.className = `message ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "user" ? "👤" : "🤖";

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";
    contentEl.innerHTML = this.contentToHtml(content);

    msg.appendChild(avatar);
    msg.appendChild(contentEl);
    this.els.messages.appendChild(msg);

    if (!opts.skipHistory) {
      // Don't persist huge HTML blobs — only plain-ish text
      const toStore = String(content).includes("results-shell")
        ? "[Results — restored from last search on reload]"
        : content;
      this.saveChatHistory(role, toStore);
    }
    this.scrollToBottom();
  },

  saveResultsSnapshot() {
    try {
      // Cap payload size — keep essentials for rehydrate
      const slim = (this.allRankedResults || []).slice(0, CONFIG.MAX_DISPLAY_RESULTS || 100).map(p => ({
        id: p.id, name: p.name, category: p.category, primary_type: p.primary_type,
        address: p.address, rating: p.rating, user_rating_count: p.user_rating_count,
        price_level: p.price_level, editorial_summary: p.editorial_summary,
        google_maps_uri: p.google_maps_uri, website: p.website,
        lat: p.lat, lng: p.lng, score: p.score, reason: p.reason, tags: p.tags,
        serves_coffee: p.serves_coffee, serves_beer: p.serves_beer, serves_wine: p.serves_wine,
        serves_cocktails: p.serves_cocktails, outdoor_seating: p.outdoor_seating,
        live_music: p.live_music,
      }));
      const snap = {
        allRanked: slim,
        minScore: this.minScore,
        sortBy: this.sortBy,
        city: this.currentCity,
        queryCount: this.queryCount,
        totalRanked: this.totalRanked,
        ts: Date.now(),
      };
      localStorage.setItem("tf_last_results", JSON.stringify(snap));
    } catch (e) {
      try { localStorage.removeItem("tf_last_results"); } catch { /* ignore */ }
    }
  },

  restoreResultsSnapshot() {
    try {
      const raw = localStorage.getItem("tf_last_results");
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap?.allRanked?.length) return false;
      this.allRankedResults = snap.allRanked;
      this.minScore = snap.minScore ?? (CONFIG.DEFAULT_MIN_SCORE || 5);
      this.sortBy = snap.sortBy || "score";
      this.currentCity = snap.city || "";
      this.queryCount = snap.queryCount || 0;
      this.totalRanked = snap.totalRanked || snap.allRanked.length;
      this.selectedPlaces = [];
      this.applyFilters({ resetPage: true });
      this.addMessage("bot", `↻ Restored last search (**${this.currentResults.length}** places in **${this.escapeHtml(this.currentCity || "area")}**).`, { skipHistory: true });
      this.renderResultsMessage();
      return true;
    } catch {
      return false;
    }
  },

  saveChatHistory(role, content) {
    try {
      const history = JSON.parse(localStorage.getItem("tf_chat_history") || "[]");
      const stored = typeof content === "string" ? content.substring(0, 8000) : "";
      // Skip progress noise
      if (stored.startsWith("⏳") || stored.includes("results-shell")) return;
      history.push({ role, content: stored, ts: Date.now() });
      if (history.length > 100) history.splice(0, history.length - 100);
      let serialized = JSON.stringify(history);
      while (serialized.length > 2000000 && history.length > 2) {
        history.splice(0, 1);
        serialized = JSON.stringify(history);
      }
      localStorage.setItem("tf_chat_history", serialized);
    } catch (e) {
      try {
        const history = JSON.parse(localStorage.getItem("tf_chat_history") || "[]");
        history.push({ role, content: String(content).substring(0, 2000), ts: Date.now() });
        while (history.length > 10) history.splice(0, 1);
        localStorage.setItem("tf_chat_history", JSON.stringify(history));
      } catch (e2) { /* give up */ }
    }
  },

  loadChatHistory() {
    try {
      const history = JSON.parse(localStorage.getItem("tf_chat_history") || "[]");
      for (const msg of history) {
        // Skip old broken result HTML dumpes
        if (typeof msg.content === "string" && (
          msg.content.includes("results-toolbar") ||
          msg.content.includes("results-shell") ||
          msg.content.includes("map-container-")
        )) continue;

        const el = document.createElement("div");
        el.className = `message ${msg.role}`;

        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = msg.role === "user" ? "👤" : "🤖";

        const contentEl = document.createElement("div");
        contentEl.className = "message-content";
        contentEl.innerHTML = this.contentToHtml(msg.content);

        el.appendChild(avatar);
        el.appendChild(contentEl);
        this.els.messages.appendChild(el);
      }
      this.scrollToBottom();
    } catch (e) { /* ignore */ }

    // After text history, restore last interactive results if any
    // Delay slightly so DOM is ready
    setTimeout(() => this.restoreResultsSnapshot(), 50);
  },

  clearChatHistory() {
    localStorage.removeItem("tf_chat_history");
    localStorage.removeItem("tf_last_results");
    this.els.messages.innerHTML = "";
    this.allRankedResults = [];
    this.currentResults = [];
    this.selectedPlaces = [];
    if (this.resultMap) {
      this.resultMap.remove();
      this.resultMap = null;
    }
    this.updateSelectionUI();
    this.showWelcome();
  },

  setTyping(show) {
    this.els.typingIndicator.style.display = show ? "flex" : "none";
    if (show) this.scrollToBottom();
  },

  scrollToBottom() {
    const container = document.getElementById("chat-container");
    if (container) container.scrollTop = container.scrollHeight;
  },

  updateProgress(text) {
    let bar = document.getElementById("progress-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "progress-bar";
      bar.className = "progress-bar";
      this.els.messages.appendChild(bar);
    }
    bar.innerHTML = `<div class="step active">⏳ ${this.escapeHtml(text)}</div>`;
    this.scrollToBottom();
  },

  clearProgress() {
    const bar = document.getElementById("progress-bar");
    if (bar) bar.remove();
  },
};

// Boot
document.addEventListener("DOMContentLoaded", () => App.init());

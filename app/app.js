// Taste Finder — Main app logic (Wave 1–3)

const App = {
  savedPlaces: new Set(),
  selectedPlaces: [],
  currentPage: 0,
  pageSize: 10,
  currentResults: [],
  allRankedResults: [],
  minScore: CONFIG.DEFAULT_MIN_SCORE || 5,
  minRating: 0,
  minReviews: 0,
  filterCategory: "all",
  filterPrice: "all",
  filterOutdoor: false,
  sortBy: "score",
  currentCity: "",
  queryCount: 0,
  totalRanked: 0,
  lastIntent: null,
  prefilterStats: null,
  resultMap: null,
  mapMarkers: [], // { key, marker, place }
  markerByKey: {},
  _resultId: null,
  _highlightedKey: null,

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

    this.els.rebuildProfile.addEventListener("click", () => this.buildProfile());
    this.els.sendBtn.addEventListener("click", () => this.sendMessage());
    this.els.chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.sendMessage();
    });

    document.getElementById("open-selected-maps")?.addEventListener("click", () => this.openSelectedInMaps());
    document.getElementById("download-kml")?.addEventListener("click", () => this.downloadKML());
    document.getElementById("download-csv")?.addEventListener("click", () => this.downloadCSV());
    document.getElementById("clear-selection")?.addEventListener("click", () => this.clearSelection());
    document.getElementById("clear-chat")?.addEventListener("click", () => this.clearChatHistory());

    this.els.messages.addEventListener("change", (e) => {
      const t = e.target;
      if (t?.matches?.("input.place-select-cb")) {
        this.toggleSelectByKey(t.getAttribute("data-place-key"), t.checked);
      } else if (t?.matches?.(".filter-control")) {
        this.onFilterControlChange(t);
      }
    });

    this.els.messages.addEventListener("click", (e) => {
      const btn = e.target.closest?.("button.star-btn");
      if (btn) {
        this.toggleStarByKey(btn.getAttribute("data-place-key"), btn);
        return;
      }
      const card = e.target.closest?.(".place-card");
      if (card && !e.target.closest("a,button,label,input,select")) {
        const key = card.getAttribute("data-place-key");
        this.highlightPlace(key, { openPopup: true, scrollCard: false });
      }
      const pageSel = e.target.closest?.("[data-select-scope]");
      if (pageSel) {
        const scope = pageSel.getAttribute("data-select-scope");
        if (scope === "page") this.selectPage();
        if (scope === "all") this.selectAll();
        if (scope === "none") this.selectNone();
      }
    });
  },

  placeKey(p) {
    return p.id || p.name;
  },

  findPlaceByKey(key) {
    return (
      this.currentResults.find((p) => this.placeKey(p) === key) ||
      this.allRankedResults.find((p) => this.placeKey(p) === key) ||
      this.selectedPlaces.find((p) => this.placeKey(p) === key)
    );
  },

  loadFromStorage() {
    const pk = localStorage.getItem("tf_places_key");
    const lk = localStorage.getItem("tf_llm_key");
    const lm = localStorage.getItem("tf_llm_model");
    const places = localStorage.getItem("tf_places_data");

    if (pk) {
      this.els.placesKey.value = pk;
      Engine.state.apiKey_places = pk;
    }
    if (lk) {
      this.els.llmKey.value = lk;
      Engine.state.apiKey_llm = lk;
    }

    // Default model: prefer stored, else CONFIG default; migrate away only if unset
    const defaultModel = CONFIG.DEFAULT_LLM_MODEL || "openai/gpt-4o-mini";
    const model = lm || defaultModel;
    if (this.els.llmModel) {
      // If stored model not in list, still set Engine; select if option exists
      this.els.llmModel.value = model;
      if (this.els.llmModel.value !== model) {
        // option missing — keep engine on stored/default anyway
      }
    }
    Engine.state.llmModel = model;
    if (!lm) localStorage.setItem("tf_llm_model", defaultModel);

    if (places) {
      try {
        Engine.state.places = JSON.parse(places);
        this.els.fileStatus.textContent = `✓ ${Engine.state.places.length} places loaded`;
      } catch {
        Engine.state.places = [];
      }
      const profile = localStorage.getItem("tf_profile");
      if (profile) {
        try {
          Engine.state.profile = JSON.parse(profile);
          this.displayProfile();
        } catch {
          /* ignore */
        }
      } else if (Engine.state.apiKey_llm) {
        this.buildProfile();
      }
    }
    this.checkReady();
  },

  checkReady() {
    const ready =
      Engine.state.apiKey_places &&
      Engine.state.apiKey_llm &&
      Engine.state.profile &&
      Engine.state.places.length > 0;
    this.els.chatInput.disabled = !ready;
    this.els.sendBtn.disabled = !ready;
    if (ready) {
      this.els.chatInput.placeholder = "Ask: 'Find fresh fish in Catania' or 'Craft beer in Berlin'";
    } else if (!Engine.state.profile) {
      this.els.chatInput.placeholder = "Upload your Google Maps export to start...";
    } else {
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
    this.addMessage(
      "bot",
      `🔍 Analyzing ${total} saved places to build your taste profile. This may take a few minutes for large exports...`
    );

    try {
      const profile = await Engine.buildProfile(Engine.state.places, (idx, totalBatches) => {
        if (idx === "merging") {
          this.updateProgress("🧠 Synthesizing final taste profile from all batches...");
        } else {
          const pct = Math.round((idx / totalBatches) * 100);
          this.updateProgress(`📊 Analyzing batch ${idx}/${totalBatches} (${pct}%)...`);
        }
      });
      this.clearProgress();
      Engine.state.profile = profile;
      localStorage.setItem("tf_profile", JSON.stringify(profile));
      this.displayProfile();
      this.checkReady();
      this.addMessage(
        "bot",
        `✅ Taste profile ready! ${profile.summary || ""}\n\nAsk me to find places in any city. Try: *"Find fresh fish in Catania"* or *"Craft beer bars in Berlin"*`
      );
    } catch (err) {
      this.els.profileDisplay.innerHTML = `<p style="color:#ef4444">Error: ${this.escapeHtml(err.message)}</p>`;
      this.addMessage("bot", `❌ Failed to build profile: ${err.message}`);
    }
  },

  displayProfile() {
    const p = Engine.state.profile;
    if (!p) return;
    let html = "";
    if (p.summary) html += `<p class="profile-summary">${this.escapeHtml(p.summary)}</p>`;
    if (p.cuisine_preferences?.length) {
      html += `<div>${p.cuisine_preferences
        .slice(0, 8)
        .map((k) => `<span class="profile-tag">${this.escapeHtml(k)}</span>`)
        .join("")}</div>`;
    }
    if (p.outdoor_interests?.length) {
      html += `<div style="margin-top:6px">${p.outdoor_interests
        .slice(0, 5)
        .map((k) => `<span class="profile-tag">🌿 ${this.escapeHtml(k)}</span>`)
        .join("")}</div>`;
    }
    if (p.drink_preferences?.length) {
      html += `<div style="margin-top:6px">${p.drink_preferences
        .slice(0, 5)
        .map((k) => `<span class="profile-tag">🍹 ${this.escapeHtml(k)}</span>`)
        .join("")}</div>`;
    }
    this.els.profileDisplay.innerHTML = html;
    this.els.profileSection.style.display = "block";
  },

  showWelcome() {
    if (Engine.state.places.length === 0) {
      this.addMessage(
        "bot",
        `Welcome to **Taste Finder**! 🍽️\n\nI learn your taste from your Google Maps saved places and recommend similar spots anywhere.\n\n**To get started:**\n1. Enter your Google Places + OpenRouter API keys (sidebar)\n2. Upload your Google Maps export from [Google Takeout](https://takeout.google.com)\n3. Ask me: *"Find fresh fish in Catania"*\n\nYour keys stay in your browser. No server, no tracking.`
      );
    } else if (Engine.state.profile) {
      this.addMessage(
        "bot",
        `✅ **Ready!** Your taste profile is loaded.\n\n${Engine.state.profile.summary || ""}\n\nTry: *"Find fresh fish in Catania"* or *"Craft beer bars in Berlin"*`
      );
    } else {
      this.addMessage(
        "bot",
        `Welcome back! You have **${Engine.state.places.length} places** loaded. Enter your API keys in the sidebar and I'll build your taste profile.`
      );
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

    // Structured intent (regex) + optional LLM refine for variants
    let intent = Engine.parseUserIntent(text);
    this.updateProgress("🧠 Understanding your request...");
    intent = await Engine.refineIntentWithLLM(intent);
    this.lastIntent = intent;

    const queries = Engine.buildQueries(profile, intent);
    if (queries.length === 0) {
      this.clearProgress();
      this.addMessage("bot", "I couldn't understand that. Try: 'Find fresh fish in Catania'");
      return;
    }

    const city = intent.city || "your area";
    const intentNote =
      intent.mode === "specific"
        ? `intent: **${intent.searchTerm}**${intent.placeType && intent.placeType !== "any" ? ` (${intent.placeType})` : ""}`
        : "open browse from your taste profile";
    this.clearProgress();
    this.addMessage("bot", `🔍 Searching ${queries.length} queries in **${city}** — ${intentNote}`);

    try {
      let locationBias = null;
      if (intent.city) {
        this.updateProgress(`📍 Locating ${intent.city}...`);
        locationBias = await Engine.geocodeCity(intent.city);
      }

      const candidates = await Engine.searchAllQueries(
        queries,
        (idx, total, query) => {
          this.updateProgress(
            `🔎 Query ${idx}/${total}: "${query}" — ${Engine.state._lastCount || 0} unique so far`
          );
        },
        locationBias
      );

      if (candidates.length === 0) {
        this.clearProgress();
        this.addMessage("bot", "No places found. Try a different query or city.");
        return;
      }

      this.clearProgress();
      this.addMessage(
        "bot",
        `Found **${candidates.length}** candidates. Shortlisting + dual-scoring (intent × taste)...`
      );

      const ranked = await Engine.rankCandidates(candidates, profile, (idx, total, stats) => {
        if (idx === 0 && stats) {
          this.updateProgress(
            `🧹 Prefilter: ${stats.input} → ${stats.llmRanked} for LLM` +
              (stats.heuristicOnly ? ` (+${stats.heuristicOnly} heuristic)` : "")
          );
          return;
        }
        const pct = total ? Math.round((idx / total) * 100) : 0;
        this.updateProgress(
          `⏳ Ranking batch ${idx}/${total} (${pct}%) — scored ${Engine.state._scoredCount || 0}`
        );
      }, intent);

      this.clearProgress();
      this.prefilterStats = Engine.state._prefilterStats;

      this.allRankedResults = ranked;
      this.minScore = CONFIG.DEFAULT_MIN_SCORE || 5;
      this.minRating = 0;
      this.minReviews = 0;
      this.filterCategory = "all";
      this.filterPrice = "all";
      this.filterOutdoor = false;
      this.sortBy = "score";
      this.currentCity = city;
      this.queryCount = queries.length;
      this.totalRanked = ranked.length;
      this.selectedPlaces = [];
      this._highlightedKey = null;
      this.updateSelectionUI();

      this.applyFilters({ resetPage: true });
      if (this.currentResults.length === 0) {
        this.minScore = 0;
        this.applyFilters({ resetPage: true });
      }
      this.renderResultsMessage();
    } catch (err) {
      this.clearProgress();
      this.addMessage("bot", `❌ Search error: ${err.message}. Check your API keys and try again.`);
    }
  },

  applyFilters({ resetPage = false } = {}) {
    const maxDisplay = CONFIG.MAX_DISPLAY_RESULTS || 100;
    let list = (this.allRankedResults || []).filter((r) => {
      if ((r.score || 0) < this.minScore) return false;
      if (this.minRating > 0 && (r.rating == null || r.rating < this.minRating)) return false;
      if (this.minReviews > 0 && (r.user_rating_count || 0) < this.minReviews) return false;
      if (this.filterCategory !== "all" && (r.category || "other") !== this.filterCategory) return false;
      if (this.filterPrice !== "all" && (r.price_level || "") !== this.filterPrice) return false;
      if (this.filterOutdoor && !r.outdoor_seating) return false;
      return true;
    });

    if (this.sortBy === "score") {
      list.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.intent_score || 0) - (a.intent_score || 0));
    } else if (this.sortBy === "intent") {
      list.sort((a, b) => (b.intent_score || 0) - (a.intent_score || 0) || (b.score || 0) - (a.score || 0));
    } else if (this.sortBy === "taste") {
      list.sort((a, b) => (b.taste_score || 0) - (a.taste_score || 0) || (b.score || 0) - (a.score || 0));
    } else if (this.sortBy === "rating") {
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

  categoryOptions() {
    const counts = {};
    for (const p of this.allRankedResults || []) {
      const c = p.category || "other";
      counts[c] = (counts[c] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  },

  renderResultsMessage() {
    const places = this.currentResults;
    const totalPages = Math.ceil(places.length / this.pageSize);
    this._resultId = Date.now();
    const city = this.currentCity || "this area";
    const stats = this.prefilterStats;

    let html = `<div class="results-shell" data-result-id="${this._resultId}">`;
    html += `<p>Here are <strong>${places.length} places in ${this.escapeHtml(city)}</strong> matching your filters:</p>`;
    html += `<p class="results-meta">📊 Ranked ${this.totalRanked} (from ${this.queryCount} searches)`;
    if (stats) html += ` · LLM-scored ${stats.llmRanked}`;
    html += ` · dual score = intent×${CONFIG.INTENT_WEIGHT ?? 0.45} + taste×${CONFIG.TASTE_WEIGHT ?? 0.55}</p>`;

    // Toolbar row 1
    html += `<div class="results-toolbar">`;
    html += `<div class="toolbar-left">`;
    html += `<button type="button" data-select-scope="page">☑️ Page</button>`;
    html += `<button type="button" data-select-scope="all">☑️ All results</button>`;
    html += `<button type="button" data-select-scope="none">☐ None</button>`;
    html += `</div>`;
    html += `<div class="toolbar-right">`;
    html += `<button type="button" onclick="App.toggleMap()">🗺️ Toggle Map</button>`;
    html += `</div></div>`;

    // Filters row
    html += `<div class="filters-bar">`;
    html += this.filterSelect(
      "min-score",
      "Score",
      [0, 3, 4, 5, 6, 7, 8].map((n) => [String(n), `${n}+`]),
      String(this.minScore)
    );
    html += this.filterSelect(
      "min-rating",
      "★ Google",
      [
        ["0", "Any"],
        ["3.5", "3.5+"],
        ["4", "4.0+"],
        ["4.3", "4.3+"],
        ["4.5", "4.5+"],
        ["4.7", "4.7+"],
      ],
      String(this.minRating || 0)
    );
    html += this.filterSelect(
      "min-reviews",
      "Reviews",
      [
        ["0", "Any"],
        ["20", "20+"],
        ["50", "50+"],
        ["100", "100+"],
        ["250", "250+"],
      ],
      String(this.minReviews || 0)
    );

    const cats = [["all", "All types"], ...this.categoryOptions().map(([c, n]) => [c, `${c} (${n})`])];
    html += this.filterSelect("category", "Type", cats, this.filterCategory);

    html += this.filterSelect(
      "price",
      "Price",
      [
        ["all", "Any $"],
        ["$", "$"],
        ["$$", "$$"],
        ["$$$", "$$$"],
        ["$$$$", "$$$$"],
      ],
      this.filterPrice
    );

    html += `<label class="filter-check"><input type="checkbox" class="filter-control" data-filter="outdoor" ${
      this.filterOutdoor ? "checked" : ""
    }> Outdoor</label>`;

    html += this.filterSelect(
      "sort",
      "Sort",
      [
        ["score", "Combined"],
        ["intent", "Intent"],
        ["taste", "Taste"],
        ["rating", "Google ★"],
        ["name", "Name"],
      ],
      this.sortBy
    );
    html += `</div>`;

    // Map
    html += `<div class="map-container" id="map-container-${this._resultId}">`;
    html += `<div class="map-header" onclick="App.toggleMap()"><span>🗺️ Map — <span id="map-count-${this._resultId}">0</span> pins · click pin ↔ card</span><span class="toggle-icon">▼</span></div>`;
    html += `<div class="results-map" id="results-map-${this._resultId}"></div>`;
    html += `</div>`;

    html += `<div id="place-cards-${this._resultId}"></div>`;
    html += `<div class="pagination" id="pagination-${this._resultId}" ${totalPages > 1 ? "" : 'style="display:none"'}></div>`;
    html += `</div>`;

    this.addMessage("bot", html, { skipHistory: true });
    this.saveResultsSnapshot();
    this.renderPage();
    setTimeout(() => this.renderMap(), 100);
  },

  filterSelect(key, label, options, selected) {
    let html = `<label class="filter-field"><span>${label}</span><select class="sort-select filter-control" data-filter="${key}">`;
    for (const [val, text] of options) {
      html += `<option value="${this.escapeAttr(val)}" ${String(val) === String(selected) ? "selected" : ""}>${this.escapeHtml(text)}</option>`;
    }
    html += `</select></label>`;
    return html;
  },

  onFilterControlChange(el) {
    const key = el.getAttribute("data-filter");
    if (key === "min-score") this.minScore = Number(el.value) || 0;
    else if (key === "min-rating") this.minRating = Number(el.value) || 0;
    else if (key === "min-reviews") this.minReviews = Number(el.value) || 0;
    else if (key === "category") this.filterCategory = el.value || "all";
    else if (key === "price") this.filterPrice = el.value || "all";
    else if (key === "outdoor") this.filterOutdoor = !!el.checked;
    else if (key === "sort") this.sortBy = el.value || "score";
    else return;

    this.applyFilters({ resetPage: true });
    this.renderPage();
    this.renderMap();
    this.saveResultsSnapshot();
  },

  // kept for inline onchange backward compat if any
  setMinScore(val) {
    this.minScore = Number(val) || 0;
    this.applyFilters({ resetPage: true });
    this.renderPage();
    this.renderMap();
    this.saveResultsSnapshot();
  },
  sortResults(sortBy) {
    this.sortBy = sortBy || "score";
    this.applyFilters({ resetPage: true });
    this.renderPage();
    this.renderMap();
    this.saveResultsSnapshot();
  },

  updateResultsMeta() {
    const mapCount = document.getElementById(`map-count-${this._resultId}`);
    if (mapCount) {
      mapCount.textContent = String(this.currentResults.filter((p) => p.lat != null && p.lng != null).length);
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
    if (!pagePlaces.length) html = `<p class="results-meta">No places match these filters.</p>`;
    container.innerHTML = html;

    // highlight current
    if (this._highlightedKey) {
      const card = container.querySelector(`.place-card[data-place-key="${CSS.escape(this._highlightedKey)}"]`);
      card?.classList.add("highlighted");
    }

    const pagContainer = document.getElementById(`pagination-${this._resultId}`);
    if (pagContainer) {
      if (totalPages > 1 && places.length > 0) {
        pagContainer.style.display = "";
        let pagHtml = `<button type="button" onclick="App.goToPage(${this.currentPage - 1})" ${this.currentPage === 0 ? "disabled" : ""}>← Prev</button>`;
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

  toggleMap() {
    const container = document.getElementById(`map-container-${this._resultId}`);
    if (!container) return;
    container.classList.toggle("collapsed");
    if (!container.classList.contains("collapsed") && this.resultMap) {
      setTimeout(() => this.resultMap.invalidateSize(), 100);
    }
  },

  scoreColor(score) {
    const s = Number(score) || 0;
    if (s >= 8) return "#22c55e";
    if (s >= 6.5) return "#84cc16";
    if (s >= 5) return "#f97316";
    if (s >= 3) return "#eab308";
    return "#71717a";
  },

  renderMap() {
    const mapEl = document.getElementById(`results-map-${this._resultId}`);
    if (!mapEl) return;

    if (this.resultMap) {
      this.resultMap.remove();
      this.resultMap = null;
    }
    this.mapMarkers = [];
    this.markerByKey = {};

    const places = this.currentResults.filter((p) => p.lat != null && p.lng != null);
    if (!places.length) {
      mapEl.innerHTML = `<div class="map-empty">No coordinates for these results</div>`;
      this.updateResultsMeta();
      return;
    }

    this.resultMap = L.map(mapEl, { scrollWheelZoom: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(this.resultMap);

    const bounds = [];
    for (const p of places) {
      const key = this.placeKey(p);
      const score = Math.round(p.score || 0);
      const color = this.scoreColor(p.score);
      const selected = !!this.selectedPlaces.find((s) => this.placeKey(s) === key);
      const icon = L.divIcon({
        className: "custom-marker-wrap",
        html: `<div class="custom-marker${selected ? " selected" : ""}${this._highlightedKey === key ? " active" : ""}" style="background:${color}" title="${this.escapeHtml(p.name)}"><span>${score}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -24],
      });
      const marker = L.marker([p.lat, p.lng], { icon }).addTo(this.resultMap);
      const mapsHref =
        p.google_maps_uri ||
        `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
      const popupHtml = `
        <strong>${this.escapeHtml(p.name)}</strong><br>
        <span style="color:${color}">★ ${score}/10</span>
        ${p.intent_score != null ? ` · I ${Math.round(p.intent_score)}` : ""}
        ${p.taste_score != null ? ` · T ${Math.round(p.taste_score)}` : ""}
        ${p.rating != null ? `<br>⭐ ${p.rating} (${p.user_rating_count || 0})` : ""}
        ${p.reason ? `<br>${this.escapeHtml(p.reason)}` : ""}
        <br><a href="${mapsHref}" target="_blank" rel="noopener">Open in Maps →</a>
      `;
      marker.bindPopup(popupHtml);
      marker.on("click", () => {
        this.highlightPlace(key, { openPopup: false, scrollCard: true });
      });
      this.mapMarkers.push({ key, marker, place: p });
      this.markerByKey[key] = marker;
      bounds.push([p.lat, p.lng]);
    }

    if (bounds.length === 1) this.resultMap.setView(bounds[0], 14);
    else this.resultMap.fitBounds(bounds, { padding: [40, 40] });

    setTimeout(() => this.resultMap?.invalidateSize(), 200);
    this.updateResultsMeta();
  },

  highlightPlace(key, { openPopup = true, scrollCard = true } = {}) {
    if (!key) return;
    this._highlightedKey = key;

    // Cards
    document.querySelectorAll(`#place-cards-${this._resultId} .place-card`).forEach((el) => {
      el.classList.toggle("highlighted", el.getAttribute("data-place-key") === key);
    });

    // Ensure card page visible
    const idx = this.currentResults.findIndex((p) => this.placeKey(p) === key);
    if (idx >= 0) {
      const page = Math.floor(idx / this.pageSize);
      if (page !== this.currentPage) {
        this.currentPage = page;
        this.renderPage();
      }
      if (scrollCard) {
        const card = document.querySelector(
          `#place-cards-${this._resultId} .place-card[data-place-key="${CSS.escape(key)}"]`
        );
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }

    // Map marker
    const marker = this.markerByKey[key];
    if (marker && this.resultMap) {
      if (openPopup) marker.openPopup();
      // refresh icons selection state lightly
      this.refreshMarkerStyles();
    }
  },

  refreshMarkerStyles() {
    for (const { key, marker, place } of this.mapMarkers) {
      const score = Math.round(place.score || 0);
      const color = this.scoreColor(place.score);
      const selected = !!this.selectedPlaces.find((s) => this.placeKey(s) === key);
      const active = this._highlightedKey === key;
      marker.setIcon(
        L.divIcon({
          className: "custom-marker-wrap",
          html: `<div class="custom-marker${selected ? " selected" : ""}${active ? " active" : ""}" style="background:${color}"><span>${score}</span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          popupAnchor: [0, -24],
        })
      );
    }
  },

  // ─── Selection / Export ────────────────────────────────
  toggleSelectByKey(key, checked) {
    const place = this.findPlaceByKey(key);
    if (!place) return;
    if (checked) {
      if (!this.selectedPlaces.find((p) => this.placeKey(p) === key)) this.selectedPlaces.push(place);
    } else {
      this.selectedPlaces = this.selectedPlaces.filter((p) => this.placeKey(p) !== key);
    }
    this.updateSelectionUI();
    this.refreshMarkerStyles();
  },

  selectPage() {
    const start = this.currentPage * this.pageSize;
    const pagePlaces = this.currentResults.slice(start, start + this.pageSize);
    for (const p of pagePlaces) {
      const key = this.placeKey(p);
      if (!this.selectedPlaces.find((s) => this.placeKey(s) === key)) this.selectedPlaces.push(p);
    }
    this.renderPage();
    this.updateSelectionUI();
    this.refreshMarkerStyles();
  },

  selectAll() {
    for (const p of this.currentResults) {
      const key = this.placeKey(p);
      if (!this.selectedPlaces.find((s) => this.placeKey(s) === key)) this.selectedPlaces.push(p);
    }
    this.renderPage();
    this.updateSelectionUI();
    this.refreshMarkerStyles();
  },

  selectNone() {
    const keys = new Set(this.currentResults.map((p) => this.placeKey(p)));
    this.selectedPlaces = this.selectedPlaces.filter((p) => !keys.has(this.placeKey(p)));
    this.renderPage();
    this.updateSelectionUI();
    this.refreshMarkerStyles();
  },

  clearSelection() {
    this.selectedPlaces = [];
    this.renderPage();
    this.updateSelectionUI();
    this.refreshMarkerStyles();
  },

  updateSelectionUI() {
    const section = document.getElementById("selection-section");
    const countEl = document.getElementById("selection-count");
    const btns = ["open-selected-maps", "download-kml", "download-csv"];
    if (!section || !countEl) return;
    if (this.selectedPlaces.length > 0) {
      section.style.display = "block";
      countEl.textContent = `${this.selectedPlaces.length} place${this.selectedPlaces.length > 1 ? "s" : ""} selected`;
      btns.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
      });
    } else {
      section.style.display = "none";
      btns.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      });
    }
  },

  openSelectedInMaps() {
    if (!this.selectedPlaces.length) return;
    const maxStops = CONFIG.MAPS_DIR_MAX_STOPS || 10;
    const stops = this.selectedPlaces.slice(0, maxStops);
    const parts = stops.map((p) => {
      if (p.lat != null && p.lng != null) return `${p.lat},${p.lng}`;
      return encodeURIComponent(`${p.name} ${p.address || ""}`.trim());
    });
    if (this.selectedPlaces.length > maxStops) {
      this.addMessage(
        "bot",
        `⚠️ Directions limited to ~${maxStops} stops. Opening first ${maxStops} of ${this.selectedPlaces.length}. Use **KML** for the full set.`
      );
    }
    window.open(`https://www.google.com/maps/dir/${parts.join("/")}`, "_blank", "noopener");
  },

  downloadKML() {
    if (!this.selectedPlaces.length) return;
    // Sort selected by score for nicer My Maps layers
    const places = [...this.selectedPlaces].sort((a, b) => (b.score || 0) - (a.score || 0));
    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>Taste Finder Selection</name>\n`;
    let skipped = 0;
    for (const p of places) {
      if (p.lat == null || p.lng == null) {
        skipped++;
        continue; // skip blank pins — cleaner My Maps import
      }
      const score = Math.round(p.score || 0);
      const title = `(${score}) ${p.name}`;
      kml += `<Placemark>\n<name><![CDATA[${title}]]></name>\n`;
      const desc = [
        p.reason,
        p.intent_score != null ? `Intent: ${p.intent_score}/10` : "",
        p.taste_score != null ? `Taste: ${p.taste_score}/10` : "",
        p.rating != null ? `Google: ${p.rating} (${p.user_rating_count || 0})` : "",
        p.price_level,
        p.address,
        p.google_maps_uri,
      ]
        .filter(Boolean)
        .join("\n");
      if (desc) kml += `<description><![CDATA[${desc}]]></description>\n`;
      kml += `<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>\n</Placemark>\n`;
    }
    kml += `</Document>\n</kml>`;
    this.downloadFile(kml, "taste-finder-places.kml", "application/vnd.google-earth.kml+xml");
    if (skipped > 0) {
      this.addMessage("bot", `⚠️ Skipped ${skipped} place(s) with no coordinates in KML.`);
    }
  },

  downloadCSV() {
    if (!this.selectedPlaces.length) return;
    const places = [...this.selectedPlaces].sort((a, b) => (b.score || 0) - (a.score || 0));
    let csv =
      "Name,Category,Score,IntentScore,TasteScore,Rating,Reviews,Price,Address,Website,GoogleMaps,Lat,Lng,Id,Outdoor\n";
    for (const p of places) {
      const fields = [
        p.name,
        p.category,
        p.score,
        p.intent_score ?? "",
        p.taste_score ?? "",
        p.rating ?? "",
        p.user_rating_count ?? "",
        p.price_level,
        p.address,
        p.website,
        p.google_maps_uri,
        p.lat ?? "",
        p.lng ?? "",
        p.id || "",
        p.outdoor_seating ? "yes" : "",
      ];
      csv +=
        fields.map((f) => `"${String(f ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`).join(",") +
        "\n";
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
    const isSelected = !!this.selectedPlaces.find((s) => this.placeKey(s) === key);
    const color = this.scoreColor(p.score);

    const meta = [];
    if (p.rating != null) meta.push(`★ ${p.rating} (${p.user_rating_count || 0})`);
    if (p.price_level) meta.push(`💰 ${p.price_level}`);
    if (p.category) meta.push(`📍 ${p.category}`);
    if (p.intent_score != null) meta.push(`I ${Math.round(p.intent_score)}`);
    if (p.taste_score != null) meta.push(`T ${Math.round(p.taste_score)}`);

    const amenities = [];
    if (p.serves_coffee) amenities.push("☕ coffee");
    if (p.serves_beer) amenities.push("🍺 beer");
    if (p.serves_wine) amenities.push("🍷 wine");
    if (p.serves_cocktails) amenities.push("🍹 cocktails");
    if (p.serves_brunch) amenities.push("🥐 brunch");
    if (p.serves_vegetarian) amenities.push("🥗 veg");
    if (p.outdoor_seating) amenities.push("🌿 outdoor");
    if (p.live_music) amenities.push("🎵 live");

    const mapsHref =
      p.google_maps_uri ||
      (p.lat != null
        ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.name + " " + (p.address || "")).trim())}`);

    return `
      <div class="place-card${this._highlightedKey === key ? " highlighted" : ""}" data-place-key="${keyAttr}" onclick="App.highlightPlace(this.getAttribute('data-place-key'))">
        <div class="card-top-bar">
          <div class="place-name">${index ? `${index}. ` : ""}${this.escapeHtml(p.name)}</div>
          <label class="select-checkbox" onclick="event.stopPropagation()">
            <input type="checkbox" class="place-select-cb" data-place-key="${keyAttr}" ${isSelected ? "checked" : ""}>
            <span>Select</span>
          </label>
        </div>
        <div class="place-card-header">
          <div></div>
          <div class="place-score" style="background:${color}">${score}/10</div>
        </div>
        <div class="place-meta">${meta.map((m) => `<span>${this.escapeHtml(m)}</span>`).join("")}</div>
        ${
          amenities.length
            ? `<div class="place-meta">${amenities.map((a) => `<span>${a}</span>`).join("")}</div>`
            : ""
        }
        <div class="place-reason">${this.escapeHtml(p.reason || "")}</div>
        ${p.editorial_summary ? `<div class="place-summary">${this.escapeHtml(p.editorial_summary)}</div>` : ""}
        <div class="place-actions" onclick="event.stopPropagation()">
          <a href="${this.escapeAttr(mapsHref)}" target="_blank" rel="noopener">🗺️ Maps</a>
          ${p.website ? `<a href="${this.escapeAttr(p.website)}" target="_blank" rel="noopener">🌐 Web</a>` : ""}
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

  contentToHtml(content) {
    if (content == null) return "";
    const s = String(content);
    if (s.includes("<div") || s.includes("<p>") || s.includes("<button") || s.includes("<label")) return s;
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
      const toStore = String(content).includes("results-shell")
        ? "[Results — restored from last search on reload]"
        : content;
      this.saveChatHistory(role, toStore);
    }
    this.scrollToBottom();
  },

  saveResultsSnapshot() {
    try {
      const slim = (this.allRankedResults || []).slice(0, CONFIG.MAX_DISPLAY_RESULTS || 100).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        primary_type: p.primary_type,
        address: p.address,
        rating: p.rating,
        user_rating_count: p.user_rating_count,
        price_level: p.price_level,
        editorial_summary: p.editorial_summary,
        google_maps_uri: p.google_maps_uri,
        website: p.website,
        lat: p.lat,
        lng: p.lng,
        score: p.score,
        intent_score: p.intent_score,
        taste_score: p.taste_score,
        reason: p.reason,
        tags: p.tags,
        serves_coffee: p.serves_coffee,
        serves_beer: p.serves_beer,
        serves_wine: p.serves_wine,
        serves_cocktails: p.serves_cocktails,
        outdoor_seating: p.outdoor_seating,
        live_music: p.live_music,
        serves_vegetarian: p.serves_vegetarian,
      }));
      localStorage.setItem(
        "tf_last_results",
        JSON.stringify({
          allRanked: slim,
          minScore: this.minScore,
          minRating: this.minRating,
          minReviews: this.minReviews,
          filterCategory: this.filterCategory,
          filterPrice: this.filterPrice,
          filterOutdoor: this.filterOutdoor,
          sortBy: this.sortBy,
          city: this.currentCity,
          queryCount: this.queryCount,
          totalRanked: this.totalRanked,
          ts: Date.now(),
        })
      );
    } catch {
      try {
        localStorage.removeItem("tf_last_results");
      } catch {
        /* ignore */
      }
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
      this.minRating = snap.minRating || 0;
      this.minReviews = snap.minReviews || 0;
      this.filterCategory = snap.filterCategory || "all";
      this.filterPrice = snap.filterPrice || "all";
      this.filterOutdoor = !!snap.filterOutdoor;
      this.sortBy = snap.sortBy || "score";
      this.currentCity = snap.city || "";
      this.queryCount = snap.queryCount || 0;
      this.totalRanked = snap.totalRanked || snap.allRanked.length;
      this.selectedPlaces = [];
      this.applyFilters({ resetPage: true });
      this.addMessage(
        "bot",
        `↻ Restored last search (**${this.currentResults.length}** in **${this.escapeHtml(this.currentCity || "area")}**).`,
        { skipHistory: true }
      );
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
      if (stored.startsWith("⏳") || stored.includes("results-shell")) return;
      history.push({ role, content: stored, ts: Date.now() });
      if (history.length > 100) history.splice(0, history.length - 100);
      let serialized = JSON.stringify(history);
      while (serialized.length > 2000000 && history.length > 2) {
        history.splice(0, 1);
        serialized = JSON.stringify(history);
      }
      localStorage.setItem("tf_chat_history", serialized);
    } catch {
      try {
        const history = JSON.parse(localStorage.getItem("tf_chat_history") || "[]");
        history.push({ role, content: String(content).substring(0, 2000), ts: Date.now() });
        while (history.length > 10) history.splice(0, 1);
        localStorage.setItem("tf_chat_history", JSON.stringify(history));
      } catch {
        /* ignore */
      }
    }
  },

  loadChatHistory() {
    try {
      const history = JSON.parse(localStorage.getItem("tf_chat_history") || "[]");
      for (const msg of history) {
        if (
          typeof msg.content === "string" &&
          (msg.content.includes("results-toolbar") ||
            msg.content.includes("results-shell") ||
            msg.content.includes("map-container-"))
        ) {
          continue;
        }
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
    } catch {
      /* ignore */
    }
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
    document.getElementById("progress-bar")?.remove();
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());

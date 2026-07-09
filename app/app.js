// Taste Finder — Main app logic

const App = {
  savedPlaces: new Set(), // starred places (session only)
  selectedPlaces: [], // checkbox-selected places for export
  currentPage: 0,
  pageSize: 10,
  currentResults: [],
  resultMap: null,
  mapMarkers: [],

  init() {
    this.cacheElements();
    this.bindEvents();
    this.loadFromStorage();
    this.showWelcome();
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
      Engine.state.places = JSON.parse(places);
      this.els.fileStatus.textContent = `✓ ${Engine.state.places.length} places loaded`;
      const profile = localStorage.getItem("tf_profile");
      if (profile) {
        Engine.state.profile = JSON.parse(profile);
        this.displayProfile();
        this.checkReady();
      } else {
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

      // Build profile automatically
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
      const profile = await Engine.buildProfile(Engine.state.places, (idx, total) => {
        if (idx === "merging") {
          this.updateProgress("🧠 Synthesizing final taste profile from all batches...");
        } else {
          const pct = Math.round((idx / total) * 100);
          this.updateProgress(`📊 Analyzing batch ${idx}/${total} (${pct}%) — processing your saved places...`);
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
    if (p.summary) html += `<p class="profile-summary">${p.summary}</p>`;
    if (p.cuisine_preferences?.length) {
      html += `<div>${p.cuisine_preferences.slice(0, 8).map(k => `<span class="profile-tag">${k}</span>`).join("")}</div>`;
    }
    if (p.outdoor_interests?.length) {
      html += `<div style="margin-top:6px">${p.outdoor_interests.slice(0, 5).map(k => `<span class="profile-tag">🌿 ${k}</span>`).join("")}</div>`;
    }
    if (p.drink_preferences?.length) {
      html += `<div style="margin-top:6px">${p.drink_preferences.slice(0, 5).map(k => `<span class="profile-tag">🍹 ${k}</span>`).join("")}</div>`;
    }
    this.els.profileDisplay.innerHTML = html;
  },

  showWelcome() {
    if (Engine.state.places.length === 0) {
      this.addMessage("bot", `Welcome to **Taste Finder**! 🍽️\n\nI learn your taste from your Google Maps saved places and recommend similar spots anywhere.\n\n**To get started:**\n1. Enter your Google Places + OpenRouter API keys (sidebar)\n2. Upload your Google Maps export from [Google Takeout](https://takeout.google.com)\n3. Ask me: *"Find fresh fish in Catania"*\n\nYour keys stay in your browser. No server, no tracking.`);
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

    // Build search queries
    const queries = Engine.buildQueries(profile, text);
    if (queries.length === 0) {
      this.addMessage("bot", "I couldn't understand that. Try: 'Find fresh fish in Catania'");
      return;
    }

    // Show what we're searching
    const cityMatch = text.match(/(?:in|near|around)\s+([A-Z][a-zA-Z\s,]+?)(?:\?|$|\.|,)/);
    const city = cityMatch ? cityMatch[1].trim() : "your area";
    this.addMessage("bot", `🔍 Searching ${queries.length} queries for places in **${city}**...`);

    try {
      // Search
      const candidates = await Engine.searchAllQueries(queries, (idx, total, query) => {
        this.updateProgress(`🔎 Searching query ${idx}/${total}: "${query}" — found ${Engine.state._lastCount || 0} places so far...`);
      });

      if (candidates.length === 0) {
        this.clearProgress();
        this.addMessage("bot", `No places found. Try a different query or city.`);
        return;
      }

      this.clearProgress();
      this.addMessage("bot", `Found **${candidates.length} candidates** across ${queries.length} searches. Now ranking ALL of them against your taste profile...`);

      // Rank all candidates — pass the user's search term so the LLM
      // prioritizes places matching what they asked for
      const searchTerm = text.replace(/(?:in|near|around)\s+[A-Z][a-zA-Z\s,]+/gi, "")
        .replace(/(?:find|recommend|suggest|show|looking for|i want|places?|similar|like|good|best|restaurants?|food|spots?)\s+/gi, " ")
        .replace(/\s+/g, " ").trim();
      const numBatches = Math.ceil(Math.min(candidates.length, 9999) / CONFIG.RANK_BATCH_SIZE);
      const ranked = await Engine.rankCandidates(candidates, profile, (idx, total) => {
        const pct = Math.round((idx / total) * 100);
        this.updateProgress(`⏳ Ranking batch ${idx}/${total} (${pct}%) — scored ${Engine.state._scoredCount || 0} places so far...`);
      }, searchTerm);

      this.clearProgress();

      // Display top results
      const top = ranked.filter(r => r.score >= 5).slice(0, 15);
      if (top.length === 0) {
        this.addMessage("bot", "No strong matches found. Try adjusting your query.");
        return;
      }

      // Display results with map + pagination
      this.currentResults = top;
      this.currentPage = 0;
      this.renderResultsMessage(top, city, queries, ranked.length);
    } catch (err) {
      this.addMessage("bot", `❌ Search error: ${err.message}. Please check your API keys and try again.`);
    }
  },

  renderResultsMessage(places, city, queries, totalRanked) {
    const totalPages = Math.ceil(places.length / this.pageSize);
    // Unique ID suffix so multiple result sets don't clash
    this._resultId = Date.now();

    let html = `<p>Here are **${places.length} places in ${city}** that match your taste:</p>`;
    html += `<p style="color:var(--text-muted);font-size:12px">📊 Ranked ${totalRanked} candidates from ${queries.length} searches. Showing ${places.length} with score ≥ 5/10.</p>`;

    // Results toolbar
    html += `<div class="results-toolbar">`;
    html += `<div class="toolbar-left">`;
    html += `<button onclick="App.selectAll()">☑️ Select All</button>`;
    html += `<button onclick="App.selectNone()">☐ Unselect All</button>`;
    html += `<span style="font-size:12px;color:var(--text-muted)">Sort:</span>`;
    html += `<select class="sort-select" onchange="App.sortResults(this.value)">`;
    html += `<option value="score">Taste Score</option>`;
    html += `<option value="rating">Rating</option>`;
    html += `<option value="name">Name</option>`;
    html += `</select>`;
    html += `</div>`;
    html += `<div class="toolbar-right">`;
    html += `<button onclick="App.toggleMap()">🗺️ Toggle Map</button>`;
    html += `</div>`;
    html += `</div>`;

    // Map container
    html += `<div class="map-container" id="map-container-${this._resultId}">`;
    html += `<div class="map-header" onclick="App.toggleMap()"><span>🗺️ Map View — ${places.length} places</span><span class="toggle-icon">▼</span></div>`;
    html += `<div id="results-map-${this._resultId}"></div>`;
    html += `</div>`;

    // Place cards container
    html += `<div id="place-cards-${this._resultId}"></div>`;

    // Pagination
    if (totalPages > 1) {
      html += `<div class="pagination" id="pagination-${this._resultId}"></div>`;
    }

    this.addMessage("bot", html);

    // Render first page
    this.renderPage();

    // Render map
    setTimeout(() => this.renderMap(), 100);
  },

  renderPage() {
    const places = this.currentResults;
    const totalPages = Math.ceil(places.length / this.pageSize);
    const start = this.currentPage * this.pageSize;
    const end = start + this.pageSize;
    const pagePlaces = places.slice(start, end);

    const container = document.getElementById(`place-cards-${this._resultId}`);
    if (!container) return;

    let html = "";
    for (const p of pagePlaces) {
      html += this.placeCardHTML(p, start + pagePlaces.indexOf(p) + 1);
    }
    container.innerHTML = html;

    // Render pagination
    const pagContainer = document.getElementById(`pagination-${this._resultId}`);
    if (pagContainer && totalPages > 1) {
      let pagHtml = "";
      pagHtml += `<button onclick="App.goToPage(${this.currentPage - 1})" ${this.currentPage === 0 ? "disabled" : ""}>← Prev</button>`;
      for (let i = 0; i < totalPages; i++) {
        pagHtml += `<button onclick="App.goToPage(${i})" class="${i === this.currentPage ? "active" : ""}">${i + 1}</button>`;
      }
      pagHtml += `<button onclick="App.goToPage(${this.currentPage + 1})" ${this.currentPage >= totalPages - 1 ? "disabled" : ""}>Next →</button>`;
      pagHtml += `<span class="page-info">${start + 1}-${Math.min(end, places.length)} of ${places.length}</span>`;
      pagContainer.innerHTML = pagHtml;
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
    if (sortBy === "score") {
      this.currentResults.sort((a, b) => b.score - a.score);
    } else if (sortBy === "rating") {
      this.currentResults.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === "name") {
      this.currentResults.sort((a, b) => a.name.localeCompare(b.name));
    }
    this.currentPage = 0;
    this.renderPage();
    this.renderMap();
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

    const places = this.currentResults.filter(p => p.lat && p.lng);
    if (places.length === 0) return;

    this.resultMap = L.map(mapEl, { scrollWheelZoom: false });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(this.resultMap);

    this.mapMarkers = [];
    const bounds = [];

    for (const p of places) {
      const marker = L.marker([p.lat, p.lng]).addTo(this.resultMap);
      const score = Math.round(p.score);
      const popupHtml = `
        <strong>${p.name}</strong><br>
        <span style="color:#f97316">★ ${score}/10</span> |
        ${p.rating ? `⭐ ${p.rating} (${p.user_rating_count || 0})` : ""}<br>
        ${p.reason || ""}<br>
        <a href="${p.google_maps_uri || "https://www.google.com/maps/search/" + encodeURIComponent(p.name)}" target="_blank">Open in Maps →</a>
      `;
      marker.bindPopup(popupHtml);
      this.mapMarkers.push(marker);
      bounds.push([p.lat, p.lng]);
    }

    if (bounds.length > 0) {
      this.resultMap.fitBounds(bounds, { padding: [40, 40] });
    }

    setTimeout(() => this.resultMap.invalidateSize(), 200);
  },

  // ─── Selection / Export ───────────────────────────────

  toggleSelect(name, checkbox) {
    const place = this.currentResults.find(p => p.name === name);
    if (!place) return;

    if (checkbox.checked) {
      if (!this.selectedPlaces.find(p => p.name === name)) {
        this.selectedPlaces.push(place);
      }
    } else {
      this.selectedPlaces = this.selectedPlaces.filter(p => p.name !== name);
    }
    this.updateSelectionUI();
  },

  selectAll() {
    for (const p of this.currentResults) {
      if (!this.selectedPlaces.find(s => s.name === p.name)) {
        this.selectedPlaces.push(p);
      }
    }
    this.renderPage();
    this.updateSelectionUI();
  },

  selectNone() {
    const currentNames = new Set(this.currentResults.map(p => p.name));
    this.selectedPlaces = this.selectedPlaces.filter(p => !currentNames.has(p.name));
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

    if (this.selectedPlaces.length > 0) {
      section.style.display = "block";
      countEl.textContent = `${this.selectedPlaces.length} place${this.selectedPlaces.length > 1 ? "s" : ""} selected`;
      btns.forEach(id => { document.getElementById(id).disabled = false; });
    } else {
      section.style.display = "none";
      btns.forEach(id => { document.getElementById(id).disabled = true; });
    }
  },

  openSelectedInMaps() {
    if (this.selectedPlaces.length === 0) return;
    // Google Maps multi-destination URL
    const names = this.selectedPlaces.map(p => encodeURIComponent(p.name + " " + (p.address || "")));
    const url = `https://www.google.com/maps/dir/${names.join("/")}`;
    window.open(url, "_blank");
  },

  downloadKML() {
    if (this.selectedPlaces.length === 0) return;
    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>Taste Finder Selection</name>\n`;
    for (const p of this.selectedPlaces) {
      kml += `<Placemark>\n<name><![CDATA[${p.name}]]></name>\n`;
      if (p.reason) kml += `<description><![CDATA[Score: ${p.score}/10. ${p.reason}]]></description>\n`;
      if (p.lat && p.lng) {
        kml += `<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>\n`;
      }
      kml += `</Placemark>\n`;
    }
    kml += `</Document>\n</kml>`;
    this.downloadFile(kml, "taste-finder-places.kml", "application/vnd.google-earth.kml+xml");
  },

  downloadCSV() {
    if (this.selectedPlaces.length === 0) return;
    let csv = "Name,Category,Score,Rating,Reviews,Price,Address,Website,GoogleMaps,Lat,Lng\n";
    for (const p of this.selectedPlaces) {
      const fields = [
        p.name, p.category, p.score, p.rating || "", p.user_rating_count || "",
        p.price_level, p.address, p.website, p.google_maps_uri, p.lat || "", p.lng || ""
      ];
      csv += fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(",") + "\n";
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
    const score = Math.round(p.score);
    const isSaved = this.savedPlaces.has(p.name);
    const isSelected = this.selectedPlaces.find(s => s.name === p.name);

    let meta = [];
    if (p.rating) meta.push(`★ ${p.rating} (${p.user_rating_count || 0} reviews)`);
    if (p.price_level) meta.push(`💰 ${p.price_level}`);
    if (p.category) meta.push(`📍 ${p.category}`);
    const metaHTML = meta.map(m => `<span>${m}</span>`).join("");

    let amenities = [];
    if (p.serves_coffee) amenities.push("☕ coffee");
    if (p.serves_beer) amenities.push("🍺 beer");
    if (p.serves_wine) amenities.push("🍷 wine");
    if (p.serves_cocktails) amenities.push("🍹 cocktails");
    if (p.outdoor_seating) amenities.push("🌿 outdoor");
    if (p.live_music) amenities.push("🎵 live music");
    const amenHTML = amenities.length ? `<div class="place-meta">${amenities.map(a => `<span>${a}</span>`).join("")}</div>` : "";

    return `
      <div class="place-card">
        <div class="card-top-bar">
          <div class="place-name">${index ? `${index}. ` : ""}${p.name}</div>
          <label class="select-checkbox">
            <input type="checkbox" ${isSelected ? "checked" : ""} onchange="App.toggleSelect('${p.name.replace(/'/g, "\\'")}', this)">
            <span>Select</span>
          </label>
        </div>
        <div class="place-card-header">
          <div></div>
          <div class="place-score">${score}/10</div>
        </div>
        <div class="place-meta">${metaHTML}</div>
        ${amenHTML}
        <div class="place-reason">${p.reason || ""}</div>
        ${p.editorial_summary ? `<div class="place-summary">${p.editorial_summary}</div>` : ""}
        <div class="place-actions">
          <a href="${p.google_maps_uri || `https://www.google.com/maps/search/${encodeURIComponent(p.name + " " + p.address)}`}" target="_blank">🗺️ Open in Maps</a>
          ${p.website ? `<a href="${p.website}" target="_blank">🌐 Website</a>` : ""}
          <button class="star-btn ${isSaved ? "saved" : ""}" onclick="App.toggleStar('${p.name.replace(/'/g, "\\'")}', this)">${isSaved ? "⭐ Saved" : "☆ Save"}</button>
        </div>
      </div>`;
  },

  toggleStar(name, btn) {
    if (this.savedPlaces.has(name)) {
      this.savedPlaces.delete(name);
      btn.classList.remove("saved");
      btn.innerHTML = "☆ Save";
    } else {
      this.savedPlaces.add(name);
      btn.classList.add("saved");
      btn.innerHTML = "⭐ Saved";
    }
  },

  addMessage(role, content) {
    const msg = document.createElement("div");
    msg.className = `message ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "user" ? "👤" : "🤖";

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";

    // Parse markdown-ish: **bold**, [text](url), *italic*
    let html = content
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");

    contentEl.innerHTML = html;

    msg.appendChild(avatar);
    msg.appendChild(contentEl);
    this.els.messages.appendChild(msg);
    this.scrollToBottom();
  },

  setTyping(show) {
    this.els.typingIndicator.style.display = show ? "flex" : "none";
    if (show) this.scrollToBottom();
  },

  scrollToBottom() {
    const container = document.getElementById("chat-container");
    container.scrollTop = container.scrollHeight;
  },

  updateProgress(text) {
    let bar = document.getElementById("progress-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "progress-bar";
      bar.className = "progress-bar";
      this.els.messages.appendChild(bar);
    }
    bar.innerHTML = `<div class="step active">⏳ ${text}</div>`;
    this.scrollToBottom();
  },

  clearProgress() {
    const bar = document.getElementById("progress-bar");
    if (bar) bar.remove();
  },
};

// Boot
document.addEventListener("DOMContentLoaded", () => App.init());

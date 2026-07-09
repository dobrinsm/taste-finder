// Taste Finder — Main app logic

const App = {
  savedPlaces: new Set(), // starred places (session only)

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

      // Rank all candidates
      const numBatches = Math.ceil(Math.min(candidates.length, 9999) / CONFIG.RANK_BATCH_SIZE);
      const ranked = await Engine.rankCandidates(candidates, profile, (idx, total) => {
        const pct = Math.round((idx / total) * 100);
        this.updateProgress(`⏳ Ranking batch ${idx}/${total} (${pct}%) — scored ${Engine.state._scoredCount || 0} places so far...`);
      });

      this.clearProgress();

      // Display top results
      const top = ranked.filter(r => r.score >= 5).slice(0, 15);
      if (top.length === 0) {
        this.addMessage("bot", "No strong matches found. Try adjusting your query.");
        return;
      }

      // Build place cards
      let html = `<p>Here are **${top.length} places in ${city}** that match your taste:</p>`;
      for (const p of top) {
        html += this.placeCardHTML(p);
      }
      html += `<p style="color:var(--text-muted);font-size:12px;margin-top:12px">📊 Ranked ${ranked.length} candidates from ${queries.length} searches. Showing top ${top.length} with score ≥ 5/10.</p>`;

      this.addMessage("bot", html);
    } catch (err) {
      this.addMessage("bot", `❌ Search error: ${err.message}. Please check your API keys and try again.`);
    }
  },

  placeCardHTML(p) {
    const score = Math.round(p.score);
    const stars = "★".repeat(score) + "☆".repeat(10 - score);
    const isSaved = this.savedPlaces.has(p.name);

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
        <div class="place-card-header">
          <div class="place-name">${p.name}</div>
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

// Taste Finder — Core engine: LLM calls, profile building, search, ranking

const Engine = {
  state: {
    places: [],
    profile: null,
    apiKey_places: "",
    apiKey_llm: "",
    llmModel: "z-ai/glm-4.5",
  },

  // ─── LLM Call ──────────────────────────────────────────
  async llmCall(messages, temperature = 0.5, maxTokens = 4000) {
    if (!this.state.apiKey_llm) throw new Error("OpenRouter API key required");

    const res = await fetch(CONFIG.OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.state.apiKey_llm}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.state.llmModel,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LLM error ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  },

  // ─── JSON extraction from LLM response ─────────────────
  extractJSON(text) {
    if (!text) return null;
    text = text.trim();
    if (text.startsWith("```")) {
      const lines = text.split("\n");
      const start = 1;
      let end = lines.length;
      if (lines[lines.length - 1].trim().startsWith("```")) end = -1;
      text = lines.slice(start, end).join("\n").trim();
    }
    // Find JSON object or array
    for (const [open, close] of [["{", "}"], ["[", "]"]]) {
      const s = text.indexOf(open);
      if (s !== -1) {
        const e = text.lastIndexOf(close);
        if (e !== -1) {
          try { return JSON.parse(text.substring(s, e + 1)); }
          catch { /* try next */ }
        }
      }
    }
    return null;
  },

  // ─── Build Taste Profile (chunked for large datasets) ──
  async buildProfile(places, onProgress) {
    const total = places.length;
    if (total === 0) throw new Error("No places to analyze");

    // Single batch for small datasets
    if (total <= CONFIG.CHUNK_SIZE) {
      const result = await this.analyzeChunk(places, 1, 1);
      const profile = await this.mergeProfiles([result], total);
      return profile;
    }

    // Chunked for large datasets
    const numChunks = Math.ceil(total / CONFIG.CHUNK_SIZE);
    const results = [];

    for (let i = 0; i < numChunks; i++) {
      const chunk = places.slice(i * CONFIG.CHUNK_SIZE, (i + 1) * CONFIG.CHUNK_SIZE);
      if (onProgress) onProgress(i + 1, numChunks);
      const result = await this.analyzeChunk(chunk, i + 1, numChunks);
      results.push(result);
    }

    if (onProgress) onProgress("merging", numChunks);
    const profile = await this.mergeProfiles(results, total);
    return profile;
  },

  async analyzeChunk(chunk, idx, total) {
    const placesText = chunk.map(p => {
      const parts = [p.name];
      if (p.category) parts.push(`[${p.category}]`);
      if (p.address) parts.push(`@ ${p.address}`);
      if (p.note) parts.push(`note: ${p.note}`);
      return `- ${parts.join(" ")}`;
    }).join("\n");

    const system = `You are a taste analyst. Analyze places and identify patterns in cuisine, vibe, design, drinks, outdoor activities, nature, cultural interests, and travel style. Places may include restaurants, beaches, trails, museums, landmarks, and more.`;

    const user = `Here are ${chunk.length} places (batch ${idx}/${total}):\n\n${placesText}\n\nAnalyze and return JSON:\n{"cuisine_patterns":[],"vibe_patterns":[],"drink_patterns":[],"outdoor_nature_patterns":[],"cultural_patterns":[],"activity_patterns":[],"travel_style":[],"keywords":["search keywords for finding similar places — include food AND non-food"],"notable_categories":[]}\n\nReturn ONLY valid JSON.`;

    const response = await this.llmCall(
      [{ role: "system", content: system }, { role: "user", content: user }],
      0.4, 2000
    );

    return this.extractJSON(response) || {
      cuisine_patterns: [], vibe_patterns: [], drink_patterns: [],
      outdoor_nature_patterns: [], cultural_patterns: [], activity_patterns: [],
      travel_style: [], keywords: [], notable_categories: []
    };
  },

  async mergeProfiles(chunks, totalPlaces) {
    // Aggregate all patterns
    const all = {};
    const fields = ["cuisine_patterns", "vibe_patterns", "drink_patterns",
      "outdoor_nature_patterns", "cultural_patterns", "activity_patterns",
      "travel_style", "keywords", "notable_categories"];

    for (const field of fields) {
      all[field] = [];
      for (const c of chunks) all[field].push(...(c[field] || []));
    }

    // Count frequency and take top items
    const topItems = (items, n = 15) => {
      const counts = {};
      for (const item of items) {
        const k = item.toLowerCase().trim();
        if (k) counts[k] = (counts[k] || 0) + 1;
      }
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([item]) => item);
    };

    const aggregated = {
      total_places: totalPlaces,
      batches: chunks.length,
      top_cuisines: topItems(all.cuisine_patterns, 15),
      top_vibes: topItems(all.vibe_patterns, 15),
      top_drinks: topItems(all.drink_patterns, 10),
      top_outdoor: topItems(all.outdoor_nature_patterns, 15),
      top_cultural: topItems(all.cultural_patterns, 10),
      top_activities: topItems(all.activity_patterns, 10),
      top_travel: topItems(all.travel_style, 10),
      top_keywords: topItems(all.keywords, 30),
      top_categories: topItems(all.notable_categories, 10),
    };

    const system = `You are a master taste analyst. Synthesize aggregated analysis from multiple batches into a single unified taste profile. The search_keywords are the most important output — they'll be used for Google Places search.`;

    const user = `## Aggregated Analysis (${chunks.length} batches, ${totalPlaces} places)\n\n${JSON.stringify(aggregated, null, 2)}\n\nSynthesize into a final taste profile. Return JSON:\n{"summary":"2-3 sentence taste description","cuisine_preferences":[],"vibe_preferences":[],"design_sensibility":"","price_range":"","drink_preferences":[],"outdoor_interests":[],"cultural_interests":[],"travel_style":[],"avoid":[],"key_patterns":[],"search_keywords":["15-25 keywords for Google Places search"]}\n\nReturn ONLY valid JSON.`;

    const response = await this.llmCall(
      [{ role: "system", content: system }, { role: "user", content: user }],
      0.5, 4000
    );

    let profile = this.extractJSON(response);
    if (!profile) {
      profile = {
        summary: `Person with ${totalPlaces} saved places`,
        search_keywords: aggregated.top_keywords.slice(0, 20),
      };
    }

    profile.source_places_count = totalPlaces;
    return profile;
  },

  // ─── Google Places Text Search ──────────────────────────
  async searchPlaces(query, pageToken) {
    if (!this.state.apiKey_places) throw new Error("Google Places API key required");

    const body = { textQuery: query, languageCode: "en" };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(CONFIG.PLACES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.state.apiKey_places,
        "X-Goog-FieldMask": CONFIG.PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Places API error ${res.status}: ${err.substring(0, 200)}`);
    }

    return await res.json();
  },

  async searchAllQueries(queries, onProgress) {
    const allPlaces = [];
    const seen = new Set();

    for (let i = 0; i < queries.length; i++) {
      if (onProgress) onProgress(i + 1, queries.length, queries[i]);
      let page = 1;
      let token = null;

      while (page <= 2) {
        const result = await this.searchPlaces(queries[i], token);
        const places = result.places || [];
        if (!places.length) break;

        for (const p of places) {
          const parsed = this.parsePlace(p);
          if (!parsed) continue;
          if (parsed.business_status === "CLOSED_PERMANENTLY") continue;
          const key = parsed.name.toLowerCase() + "|" + parsed.address.substring(0, 30).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          allPlaces.push(parsed);
        }

        token = result.nextPageToken;
        if (!token) break;
        page++;
        await new Promise(r => setTimeout(r, 1000));
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return allPlaces;
  },

  parsePlace(p) {
    const name = p.displayName?.text || "";
    if (!name) return null;

    const priceMap = {
      PRICE_LEVEL_FREE: "free", PRICE_LEVEL_INEXPENSIVE: "$",
      PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$",
      PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
    };

    const types = p.types || [];
    const primaryType = p.primaryTypeDisplayName?.text || "";

    let category;
    if (types.includes("coffee_shop") || types.includes("cafe")) category = "coffee";
    else if (types.includes("restaurant")) category = "restaurant";
    else if (types.includes("bar")) category = "bar";
    else if (types.includes("bakery")) category = "bakery";
    else if (types.includes("beach")) category = "beach";
    else if (types.includes("park")) category = "park";
    else if (types.includes("tourist_attraction")) category = "attraction";
    else if (types.includes("museum")) category = "museum";
    else if (types.includes("lodging")) category = "hotel";
    else category = primaryType || "other";

    const loc = p.location || {};
    return {
      name,
      category,
      primary_type: primaryType,
      types,
      address: p.formattedAddress || "",
      rating: p.rating || null,
      user_rating_count: p.userRatingCount || null,
      price_level: priceMap[p.priceLevel] || "",
      editorial_summary: p.editorialSummary?.text || "",
      google_maps_uri: p.googleMapsUri || "",
      website: p.websiteUri || "",
      lat: loc.latitude || null,
      lng: loc.longitude || null,
      serves_coffee: p.servesCoffee || false,
      serves_beer: p.servesBeer || false,
      serves_wine: p.servesWine || false,
      serves_cocktails: p.servesCocktails || false,
      serves_brunch: p.servesBrunch || false,
      outdoor_seating: p.outdoorSeating || false,
      live_music: p.liveMusic || false,
      business_status: p.businessStatus || "",
    };
  },

  // ─── Build queries from profile + user message ─────────
  buildQueries(profile, userMessage) {
    // Extract city from user message (e.g., "fresh fish in Catania")
    const cityMatch = userMessage.match(/(?:in|near|around)\s+([A-Z][a-zA-Z\s,]+?)(?:\?|$|\.|,)/);
    const city = cityMatch ? cityMatch[1].trim() : "";

    // Extract custom keyword from user message
    const cleaned = userMessage
      .replace(/(?:find|recommend|suggest|show|looking for|i want|places?|similar|like|good|best)\s+/gi, "")
      .replace(/(?:in|near|around)\s+[A-Z][a-zA-Z\s,]+/gi, "")
      .trim();

    const keywords = profile?.search_keywords || [];

    // If user specified something specific, prioritize it
    let queries = [];
    if (cleaned && cleaned.length > 2) {
      if (city) {
        queries.push(`${cleaned} in ${city}`);
      }
      // Add profile keywords + city
      for (const kw of keywords.slice(0, 15)) {
        if (city) queries.push(`${kw} in ${city}`);
        else queries.push(kw);
      }
    } else {
      // Use profile keywords + city
      for (const kw of keywords.slice(0, 15)) {
        if (city) queries.push(`${kw} in ${city}`);
        else queries.push(kw);
      }
    }

    // Deduplicate
    return [...new Set(queries)];
  },

  // ─── Rank candidates ────────────────────────────────────
  async rankCandidates(candidates, profile, onProgress) {
    // Filter + cap
    let filtered = candidates.filter(c => c.name.length >= 3);
    if (filtered.length > CONFIG.MAX_CANDIDATES) filtered = filtered.slice(0, CONFIG.MAX_CANDIDATES);

    const batchSize = CONFIG.RANK_BATCH_SIZE;
    const numBatches = Math.ceil(filtered.length / batchSize);
    const allScores = [];

    const profileSummary = JSON.stringify({
      summary: profile?.summary || "",
      cuisine_preferences: profile?.cuisine_preferences || [],
      vibe_preferences: profile?.vibe_preferences || [],
      drink_preferences: profile?.drink_preferences || [],
      outdoor_interests: profile?.outdoor_interests || [],
      cultural_interests: profile?.cultural_interests || [],
      travel_style: profile?.travel_style || [],
      design_sensibility: profile?.design_sensibility || "",
      price_range: profile?.price_range || "",
      avoid: profile?.avoid || [],
      key_patterns: profile?.key_patterns || [],
    }, null, 2);

    for (let i = 0; i < numBatches; i++) {
      const batch = filtered.slice(i * batchSize, (i + 1) * batchSize);
      if (onProgress) onProgress(i + 1, numBatches);

      try {
        const placesText = batch.map(p => this.formatPlace(p)).join("\n");

        const system = `You are a taste-matching engine. Score each place 0-10 on how well it matches the person's taste profile. Consider cuisine, vibe, design, outdoor interests, and whether this person would love this place. Be discerning.`;

        const user = `## Taste Profile\n${profileSummary}\n\n## Candidate Places\n${placesText}\n\nScore each place 0-10. Return JSON array:\n[{"name":"","score":0,"reason":"","tags":[]}]\n\nReturn ONLY valid JSON array.`;

        const response = await this.llmCall(
          [{ role: "system", content: system }, { role: "user", content: user }],
          0.2, 8000
        );

        const scores = this.extractJSON(response);
        if (Array.isArray(scores)) allScores.push(...scores);
        else console.warn(`Batch ${i+1}: No valid JSON scores parsed`);
      } catch (batchErr) {
        console.warn(`Batch ${i+1} failed: ${batchErr.message}`);
      }
      // Small delay between batches to avoid rate limits
      if (i < numBatches - 1) await new Promise(r => setTimeout(r, 500));
    }

    // Merge scores with place data
    const scoreMap = {};
    for (const s of allScores) {
      if (s.name) scoreMap[s.name.toLowerCase()] = s;
    }

    const ranked = filtered
      .map(p => {
        const s = scoreMap[p.name.toLowerCase()] || {};
        return { ...p, score: s.score || 0, reason: s.reason || "", tags: s.tags || [] };
      })
      .sort((a, b) => b.score - a.score);

    return ranked;
  },

  formatPlace(p) {
    const parts = [`  ${p.name}`];
    if (p.category) parts.push(`[${p.category}]`);
    if (p.primary_type) parts.push(`type:${p.primary_type}`);
    if (p.rating) parts.push(`★${p.rating}(${p.user_rating_count || 0})`);
    if (p.price_level) parts.push(`price:${p.price_level}`);
    if (p.address) parts.push(`@ ${p.address.substring(0, 60)}`);
    if (p.editorial_summary) parts.push(`\n     desc: ${p.editorial_summary.substring(0, 200)}`);
    const flags = [];
    for (const [flag, label] of [
      ["serves_coffee", "coffee"], ["serves_beer", "beer"], ["serves_wine", "wine"],
      ["serves_cocktails", "cocktails"], ["serves_brunch", "brunch"],
      ["outdoor_seating", "outdoor"], ["live_music", "live music"]
    ]) {
      if (p[flag]) flags.push(label);
    }
    if (flags.length) parts.push(`\n     amenities: ${flags.join(", ")}`);
    return parts.join(" ");
  },
};

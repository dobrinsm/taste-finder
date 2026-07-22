// Taste Finder — Core engine: LLM calls, profile building, search, ranking

const Engine = {
  state: {
    places: [],
    profile: null,
    apiKey_places: "",
    apiKey_llm: "",
    llmModel: "z-ai/glm-4.5",
    _lastCount: 0,
    _scoredCount: 0,
    _locationBias: null, // { lat, lng, city }
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
    const msg = data.choices?.[0]?.message || {};
    // Some models (e.g. GLM-4.5) put the answer in reasoning instead of content
    return msg.content || msg.reasoning || "";
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
    const CONCURRENCY = 5;

    for (let i = 0; i < numChunks; i += CONCURRENCY) {
      const promises = [];
      for (let j = 0; j < CONCURRENCY && i + j < numChunks; j++) {
        const idx = i + j;
        const chunk = places.slice(idx * CONFIG.CHUNK_SIZE, (idx + 1) * CONFIG.CHUNK_SIZE);
        if (onProgress) onProgress(idx + 1, numChunks);
        promises.push(this.analyzeChunk(chunk, idx + 1, numChunks));
      }
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
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

    const user = `Here are ${chunk.length} places (batch ${idx}/${total}):\n\n${placesText}\n\nAnalyze and return JSON:\n{"cuisine_patterns":[],"vibe_patterns":[],"drink_patterns":[],"outdoor_nature_patterns":[],"cultural_patterns":[],"activity_patterns":[],"travel_style":[],"keywords":["search keywords for finding similar places — include food AND non-food"],"notable_categories":[]}\n\nCRITICAL: Return ONLY the JSON object. No explanations, no reasoning, no markdown, no code fences. Start with { and end with }.`;

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

    const user = `## Aggregated Analysis (${chunks.length} batches, ${totalPlaces} places)\n\n${JSON.stringify(aggregated, null, 2)}\n\nSynthesize into a final taste profile. Return JSON:\n{"summary":"2-3 sentence taste description","cuisine_preferences":[],"vibe_preferences":[],"design_sensibility":"","price_range":"","drink_preferences":[],"outdoor_interests":[],"cultural_interests":[],"travel_style":[],"avoid":[],"key_patterns":[],"search_keywords":["15-25 keywords for Google Places search"]}\n\nCRITICAL: Return ONLY the JSON object. No explanations, no reasoning, no markdown, no code fences. Start with { and end with }.`;

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

  // ─── Intent parsing (city + search term, case-insensitive) ──
  parseUserIntent(userMessage) {
    const text = (userMessage || "").trim();

    // City: "in/near/around/at <City[, Region]>" — allow commas; stop at ?!. or EOL
    const cityMatch = text.match(
      /\b(?:in|near|around|at)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.',\-\s]{1,80}?)(?=\s*[?!.]|$)/i
    );
    let city = cityMatch ? cityMatch[1].trim() : "";
    // Drop trailing filler; collapse whitespace
    city = city
      .replace(/\s+(please|thanks|for me)$/i, "")
      .replace(/\s+/g, " ")
      .replace(/,+$/g, "")
      .trim();

    // Search term = message minus location + command filler
    let cleaned = text;
    if (cityMatch) {
      cleaned = cleaned.replace(cityMatch[0], " ");
    } else {
      cleaned = cleaned.replace(
        /\b(?:in|near|around|at)\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.',\-\s]{1,80}?(?=\s*[?!.]|$)/gi,
        " "
      );
    }
    cleaned = cleaned
      .replace(/\b(?:find|recommend|suggest|show(?:\s+me)?|looking\s+for|i\s+want|i'?m\s+looking\s+for|search(?:\s+for)?|get|give\s+me)\b/gi, " ")
      .replace(/\b(?:places?|spots?|options?|recommendations?|similar|like|good|best)\b/gi, " ")
      .replace(/[?!.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const foodIntent = this.isFoodIntent(cleaned, text);

    return { city, searchTerm: cleaned, foodIntent, raw: text };
  },

  isFoodIntent(searchTerm, raw) {
    const s = `${searchTerm} ${raw}`.toLowerCase();
    // Non-food first — beaches/museums shouldn't get "restaurant" suffix
    const nonFood = /\b(beaches?|trails?|hikes?|hiking|parks?|museums?|galleries?|viewpoints?|lookouts?|waterfalls?|temples?|churches?|ruins?|markets?(?!\s*food)|hotels?|hostels?|airbnb|clubs?|nightlife|concerts?|festivals?)\b/;
    const food = /\b(restaurants?|food|eat|dining|dinner|lunch|brunch|breakfast|seafood|fish|sushi|pizza|pasta|ramen|bbq|steak|vegan|vegetarian|cafes?|coffee|baker(?:y|ies)|bars?|pubs?|brewer(?:y|ies)|wine|cocktails?|tapas|cuisine|kitchen|bistros?|trattorias?|osterias?|tavernas?|pescado|pesce)\b/;
    if (nonFood.test(s) && !food.test(s)) return false;
    if (!searchTerm || searchTerm.length < 2) return false;
    // Explicit food → true; free-text dish (e.g. "fresh fish") → true; pure nonfood already false
    return food.test(s) || !nonFood.test(s);
  },

  // True when term already names a venue type — skip redundant "… restaurant"
  hasVenueType(searchTerm) {
    return /\b(restaurants?|cafes?|coffee|bars?|pubs?|brewer(?:y|ies)|baker(?:y|ies)|bistros?|trattorias?|osterias?|tavernas?|hotels?|museums?|galleries?|beaches?|trails?|parks?)\b/i.test(searchTerm || "");
  },

  // ─── Geocode city via Places Text Search (bias center) ──
  async geocodeCity(city) {
    if (!city || !this.state.apiKey_places) return null;
    try {
      const body = {
        textQuery: city,
        languageCode: "en",
        pageSize: 1,
      };
      const res = await fetch(CONFIG.PLACES_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.state.apiKey_places,
          "X-Goog-FieldMask": "places.location,places.displayName,places.formattedAddress",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const p = (data.places || [])[0];
      const loc = p?.location;
      if (!loc?.latitude || !loc?.longitude) return null;
      return {
        lat: loc.latitude,
        lng: loc.longitude,
        city,
        label: p.displayName?.text || city,
      };
    } catch {
      return null;
    }
  },

  // ─── Google Places Text Search ──────────────────────────
  async searchPlaces(query, pageToken, locationBias) {
    if (!this.state.apiKey_places) throw new Error("Google Places API key required");

    const body = {
      textQuery: query,
      languageCode: "en",
      rankPreference: "RELEVANCE",
    };
    if (pageToken) body.pageToken = pageToken;
    if (locationBias?.lat != null && locationBias?.lng != null) {
      body.locationBias = {
        circle: {
          center: {
            latitude: locationBias.lat,
            longitude: locationBias.lng,
          },
          radius: CONFIG.LOCATION_BIAS_RADIUS_M || 25000,
        },
      };
    }

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

  async searchAllQueries(queries, onProgress, locationBias) {
    const allPlaces = [];
    const seen = new Set();
    this.state._lastCount = 0;
    this.state._locationBias = locationBias || null;
    const maxPages = CONFIG.SEARCH_PAGES || 2;

    for (let i = 0; i < queries.length; i++) {
      if (onProgress) onProgress(i + 1, queries.length, queries[i]);
      let page = 1;
      let token = null;

      while (page <= maxPages) {
        const result = await this.searchPlaces(queries[i], token, locationBias);
        const places = result.places || [];
        if (!places.length) break;

        for (const p of places) {
          const parsed = this.parsePlace(p);
          if (!parsed) continue;
          if (parsed.business_status === "CLOSED_PERMANENTLY") continue;
          if (parsed.business_status === "CLOSED_TEMPORARILY") continue;

          // Prefer Places id; fall back to name+address key
          const key = parsed.id
            || (parsed.name.toLowerCase() + "|" + (parsed.address || "").substring(0, 40).toLowerCase());
          if (seen.has(key)) continue;
          seen.add(key);
          allPlaces.push(parsed);
        }

        this.state._lastCount = allPlaces.length;

        token = result.nextPageToken;
        if (!token) break;
        page++;
        await new Promise(r => setTimeout(r, 1200));
      }

      await new Promise(r => setTimeout(r, 400));
    }

    return allPlaces;
  },

  parsePlace(p) {
    // Places API (New) returns resource name like "places/ChIJ..." — prefer short id
    const rawId = p.id || p.name || "";
    const id = String(rawId).replace(/^places\//, "");

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
      id: id || null,
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
      serves_coffee: !!p.servesCoffee,
      serves_beer: !!p.servesBeer,
      serves_wine: !!p.servesWine,
      serves_cocktails: !!p.servesCocktails,
      serves_brunch: !!p.servesBrunch,
      serves_dessert: !!p.servesDessert,
      serves_vegetarian: !!p.servesVegetarianFood,
      outdoor_seating: !!p.outdoorSeating,
      dine_in: !!p.dineIn,
      takeout: !!p.takeout,
      good_for_groups: !!p.goodForGroups,
      live_music: !!p.liveMusic,
      business_status: p.businessStatus || "",
    };
  },

  // ─── Build queries from profile + user message ─────────
  // Profile influences ranking, NOT search terms, when the user gave a specific intent.
  buildQueries(profile, userMessage) {
    const intent = this.parseUserIntent(userMessage);
    const { city, searchTerm, foodIntent } = intent;
    const keywords = profile?.search_keywords || [];
    const queries = [];

    const withCity = (q) => (city ? `${q} in ${city}` : q);

    if (searchTerm && searchTerm.length > 2) {
      // Specific intent — ONLY expand the search term (no profile keyword mixing)
      queries.push(withCity(searchTerm));

      if (foodIntent) {
        // Add "restaurant" only when the term is a dish/cuisine, not already a venue type
        // ("fresh fish" → yes; "craft beer bars" / "coffee" → no)
        if (!this.hasVenueType(searchTerm) && !/\brestaurant/i.test(searchTerm)) {
          queries.push(withCity(`${searchTerm} restaurant`));
        }
        // Light type variations for common cases
        if (/\bfish|seafood|pesce|pescado\b/i.test(searchTerm)) {
          queries.push(withCity("seafood restaurant"));
          queries.push(withCity("fresh seafood"));
        }
      } else {
        // Non-food: never force "restaurant"
        if (/\bbeach/i.test(searchTerm)) {
          if (!/^beaches?$/i.test(searchTerm.trim())) queries.push(withCity("beach"));
          queries.push(withCity("beach access"));
        } else if (/\bhike|trail|hiking\b/i.test(searchTerm)) {
          queries.push(withCity("hiking trail"));
          queries.push(withCity("nature trail"));
        } else if (/\bmuseum|galler/i.test(searchTerm)) {
          queries.push(withCity("museum"));
          queries.push(withCity("art museum"));
        }
      }
    } else {
      // Open browse — use taste profile keywords only
      for (const kw of keywords.slice(0, 15)) {
        const k = String(kw).trim();
        if (!k) continue;
        // Abstract vibe words need a place type for Google to cooperate
        if (/^(artisanal|minimal design|design-forward|cozy|aesthetic)$/i.test(k)) {
          queries.push(withCity(`${k} restaurant`));
        } else {
          queries.push(withCity(k));
        }
      }
      if (city && queries.length === 0) {
        queries.push(`best places in ${city}`);
      }
    }

    // Deduplicate normalized
    const seen = new Set();
    const out = [];
    for (const q of queries) {
      const n = q.toLowerCase().replace(/\s+/g, " ").trim();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(q.trim());
    }
    return out;
  },

  // ─── Rank candidates ────────────────────────────────────
  async rankCandidates(candidates, profile, onProgress, searchQuery) {
    // Filter + cap
    let filtered = candidates.filter(c => c.name.length >= 3);
    if (filtered.length > CONFIG.MAX_CANDIDATES) filtered = filtered.slice(0, CONFIG.MAX_CANDIDATES);

    const batchSize = CONFIG.RANK_BATCH_SIZE;
    const numBatches = Math.ceil(filtered.length / batchSize);
    const allScores = [];
    this.state._scoredCount = 0;
    const CONCURRENCY = 5; // parallel LLM calls

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

    // Process batches in parallel chunks
    for (let i = 0; i < numBatches; i += CONCURRENCY) {
      const promises = [];
      for (let j = 0; j < CONCURRENCY && i + j < numBatches; j++) {
        const batchIdx = i + j;
        const batch = filtered.slice(batchIdx * batchSize, (batchIdx + 1) * batchSize);
        if (onProgress) onProgress(batchIdx + 1, numBatches);
        promises.push(this.rankBatch(batch, profileSummary, batchIdx, numBatches, searchQuery));
      }
      const results = await Promise.all(promises);
      for (const scores of results) {
        if (Array.isArray(scores)) {
          allScores.push(...scores);
          this.state._scoredCount += scores.length;
        }
      }
    }

    // Merge scores by id first, then exact name (case-insensitive)
    const scoreById = {};
    const scoreByName = {};
    for (const s of allScores) {
      if (!s || s.score == null) continue;
      if (s.id) scoreById[String(s.id)] = s;
      if (s.name) scoreByName[s.name.toLowerCase()] = s;
    }

    const ranked = filtered
      .map(p => {
        const s = (p.id && scoreById[p.id]) || scoreByName[p.name.toLowerCase()] || {};
        return {
          ...p,
          score: typeof s.score === "number" ? s.score : 0,
          reason: s.reason || "",
          tags: s.tags || [],
        };
      })
      .sort((a, b) => b.score - a.score);

    return ranked;
  },

  async rankBatch(batch, profileSummary, batchIdx, totalBatches, searchQuery) {
    try {
      const placesText = batch.map(p => this.formatPlace(p)).join("\n");
      const system = `You are a taste-matching engine. Score each place 0-10 on how well it matches the person's taste profile. Consider cuisine, vibe, design, outdoor interests, and whether this person would love this place. Be discerning. When a search intent is provided, places that do not match the intent MUST score 0-3 even if taste would otherwise fit.`;
      const searchContext = searchQuery
        ? `\n\n## User search intent: "${searchQuery}"\n- Intent match is REQUIRED for scores above 3.\n- Places matching intent AND taste: 7-10.\n- Places matching intent only: 4-6.\n- Places not matching intent: 0-3.`
        : "";
      const user = `## Taste Profile\n${profileSummary}${searchContext}\n\n## Candidate Places\n${placesText}\n\nScore each place 0-10. Return JSON array with the same names (and id when given):\n[{"id":"","name":"","score":0,"reason":"","tags":[]}]\n\nCRITICAL: Return ONLY the JSON array. No explanations, no reasoning, no markdown, no code fences. Start with [ and end with ].`;
      const response = await this.llmCall(
        [{ role: "system", content: system }, { role: "user", content: user }],
        0.2, 8000
      );
      const scores = this.extractJSON(response);
      if (Array.isArray(scores)) return scores;
      console.warn(`Batch ${batchIdx + 1}: No valid JSON scores parsed`);
      return [];
    } catch (err) {
      console.warn(`Batch ${batchIdx + 1} failed: ${err.message}`);
      return [];
    }
  },

  formatPlace(p) {
    const parts = [];
    if (p.id) parts.push(`id:${p.id}`);
    parts.push(p.name);
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
      ["serves_dessert", "dessert"], ["serves_vegetarian", "vegetarian"],
      ["outdoor_seating", "outdoor"], ["dine_in", "dine-in"], ["takeout", "takeout"],
      ["good_for_groups", "groups"], ["live_music", "live music"],
    ]) {
      if (p[flag]) flags.push(label);
    }
    if (flags.length) parts.push(`\n     amenities: ${flags.join(", ")}`);
    return "  " + parts.join(" ");
  },
};

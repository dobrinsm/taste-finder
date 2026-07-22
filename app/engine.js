// Taste Finder — Core engine: LLM, profile, search, rank (Wave 1–3)

const Engine = {
  state: {
    places: [],
    profile: null,
    apiKey_places: "",
    apiKey_llm: "",
    llmModel: (typeof CONFIG !== "undefined" && CONFIG.DEFAULT_LLM_MODEL) || "openai/gpt-4o-mini",
    _lastCount: 0,
    _scoredCount: 0,
    _locationBias: null,
    _lastIntent: null,
    _prefilterStats: null,
  },

  // ─── LLM Call ──────────────────────────────────────────
  async llmCall(messages, temperature = 0.5, maxTokens = 4000) {
    if (!this.state.apiKey_llm) throw new Error("OpenRouter API key required");

    const res = await fetch(CONFIG.OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.state.apiKey_llm}`,
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
    return msg.content || msg.reasoning || "";
  },

  extractJSON(text) {
    if (!text) return null;
    text = text.trim();
    if (text.startsWith("```")) {
      const lines = text.split("\n");
      let end = lines.length;
      if (lines[lines.length - 1].trim().startsWith("```")) end = -1;
      text = lines.slice(1, end).join("\n").trim();
    }
    for (const [open, close] of [
      ["{", "}"],
      ["[", "]"],
    ]) {
      const s = text.indexOf(open);
      if (s === -1) continue;
      const e = text.lastIndexOf(close);
      if (e === -1) continue;
      try {
        return JSON.parse(text.substring(s, e + 1));
      } catch {
        /* try next */
      }
    }
    return null;
  },

  // ─── Profile ───────────────────────────────────────────
  async buildProfile(places, onProgress) {
    const total = places.length;
    if (total === 0) throw new Error("No places to analyze");

    if (total <= CONFIG.CHUNK_SIZE) {
      const result = await this.analyzeChunk(places, 1, 1);
      return this.mergeProfiles([result], total);
    }

    const numChunks = Math.ceil(total / CONFIG.CHUNK_SIZE);
    const results = [];
    const CONCURRENCY = CONFIG.LLM_CONCURRENCY || 5;

    for (let i = 0; i < numChunks; i += CONCURRENCY) {
      const promises = [];
      for (let j = 0; j < CONCURRENCY && i + j < numChunks; j++) {
        const idx = i + j;
        const chunk = places.slice(idx * CONFIG.CHUNK_SIZE, (idx + 1) * CONFIG.CHUNK_SIZE);
        if (onProgress) onProgress(idx + 1, numChunks);
        promises.push(this.analyzeChunk(chunk, idx + 1, numChunks));
      }
      results.push(...(await Promise.all(promises)));
    }

    if (onProgress) onProgress("merging", numChunks);
    return this.mergeProfiles(results, total);
  },

  async analyzeChunk(chunk, idx, total) {
    const placesText = chunk
      .map((p) => {
        const parts = [p.name];
        if (p.category) parts.push(`[${p.category}]`);
        if (p.address) parts.push(`@ ${p.address}`);
        if (p.note) parts.push(`note: ${p.note}`);
        return `- ${parts.join(" ")}`;
      })
      .join("\n");

    const system = `You are a taste analyst. Analyze places and identify patterns in cuisine, vibe, design, drinks, outdoor activities, nature, cultural interests, and travel style.`;
    const user = `Here are ${chunk.length} places (batch ${idx}/${total}):\n\n${placesText}\n\nAnalyze and return JSON:\n{"cuisine_patterns":[],"vibe_patterns":[],"drink_patterns":[],"outdoor_nature_patterns":[],"cultural_patterns":[],"activity_patterns":[],"travel_style":[],"keywords":["search keywords for finding similar places — include food AND non-food"],"notable_categories":[]}\n\nCRITICAL: Return ONLY the JSON object. No explanations, no markdown, no code fences. Start with { and end with }.`;

    const response = await this.llmCall(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      0.4,
      2000
    );

    return (
      this.extractJSON(response) || {
        cuisine_patterns: [],
        vibe_patterns: [],
        drink_patterns: [],
        outdoor_nature_patterns: [],
        cultural_patterns: [],
        activity_patterns: [],
        travel_style: [],
        keywords: [],
        notable_categories: [],
      }
    );
  },

  async mergeProfiles(chunks, totalPlaces) {
    const all = {};
    const fields = [
      "cuisine_patterns",
      "vibe_patterns",
      "drink_patterns",
      "outdoor_nature_patterns",
      "cultural_patterns",
      "activity_patterns",
      "travel_style",
      "keywords",
      "notable_categories",
    ];
    for (const field of fields) {
      all[field] = [];
      for (const c of chunks) all[field].push(...(c[field] || []));
    }

    const topItems = (items, n = 15) => {
      const counts = {};
      for (const item of items) {
        const k = String(item).toLowerCase().trim();
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

    const system = `You are a master taste analyst. Synthesize aggregated analysis into a unified taste profile. search_keywords are critical for open-ended discovery searches.`;
    const user = `## Aggregated Analysis (${chunks.length} batches, ${totalPlaces} places)\n\n${JSON.stringify(aggregated, null, 2)}\n\nReturn JSON:\n{"summary":"2-3 sentence taste description","cuisine_preferences":[],"vibe_preferences":[],"design_sensibility":"","price_range":"","drink_preferences":[],"outdoor_interests":[],"cultural_interests":[],"travel_style":[],"avoid":[],"key_patterns":[],"search_keywords":["15-25 keywords for Google Places search"]}\n\nCRITICAL: Return ONLY the JSON object. No explanations, no markdown, no code fences. Start with { and end with }.`;

    const response = await this.llmCall(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      0.5,
      4000
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

  // ─── Structured intent ─────────────────────────────────
  parseUserIntent(userMessage) {
    const text = (userMessage || "").trim();
    const cityMatch = text.match(
      /\b(?:in|near|around|at)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.',\-\s]{1,80}?)(?=\s*[?!.]|$)/i
    );
    let city = cityMatch ? cityMatch[1].trim() : "";
    city = city
      .replace(/\s+(please|thanks|for me)$/i, "")
      .replace(/\s+/g, " ")
      .replace(/,+$/g, "")
      .trim();

    let cleaned = text;
    if (cityMatch) cleaned = cleaned.replace(cityMatch[0], " ");
    cleaned = cleaned
      .replace(
        /\b(?:find|recommend|suggest|show(?:\s+me)?|looking\s+for|i\s+want|i'?m\s+looking\s+for|search(?:\s+for)?|get|give\s+me)\b/gi,
        " "
      )
      .replace(/\b(?:places?|spots?|options?|recommendations?|similar|like|good|best)\b/gi, " ")
      .replace(/[?!.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const lower = `${cleaned} ${text}`.toLowerCase();
    const modifiers = [];
    const modMap = [
      [/\b(cheap|budget|inexpensive|affordable)\b/, "budget"],
      [/\b(expensive|fine dining|upscale|fancy|luxury)\b/, "upscale"],
      [/\b(outdoor|terrace|patio|al fresco|alfresco)\b/, "outdoor"],
      [/\b(romantic|date night)\b/, "romantic"],
      [/\b(family|kid[s]?-friendly|with kids)\b/, "family"],
      [/\b(vegan|vegetarian)\b/, "vegetarian"],
      [/\b(late night|nightlife)\b/, "late_night"],
      [/\b(quiet|cozy|chill)\b/, "cozy"],
    ];
    for (const [re, tag] of modMap) {
      if (re.test(lower)) modifiers.push(tag);
    }

    const foodIntent = this.isFoodIntent(cleaned, text);
    const placeType = this.inferPlaceType(cleaned, text, foodIntent);
    const mode = cleaned && cleaned.length > 2 ? "specific" : "browse";

    return {
      city,
      searchTerm: cleaned,
      foodIntent,
      placeType,
      modifiers,
      mode,
      raw: text,
    };
  },

  isFoodIntent(searchTerm, raw) {
    const s = `${searchTerm} ${raw}`.toLowerCase();
    const nonFood =
      /\b(beaches?|trails?|hikes?|hiking|parks?|museums?|galleries?|viewpoints?|lookouts?|waterfalls?|temples?|churches?|ruins?|markets?(?!\s*food)|hotels?|hostels?|airbnb|clubs?|nightlife|concerts?|festivals?)\b/;
    const food =
      /\b(restaurants?|food|eat|dining|dinner|lunch|brunch|breakfast|seafood|fish|sushi|pizza|pasta|ramen|bbq|steak|vegan|vegetarian|cafes?|coffee|baker(?:y|ies)|bars?|pubs?|brewer(?:y|ies)|wine|cocktails?|tapas|cuisine|kitchen|bistros?|trattorias?|osterias?|tavernas?|pescado|pesce)\b/;
    if (nonFood.test(s) && !food.test(s)) return false;
    if (!searchTerm || searchTerm.length < 2) return false;
    return food.test(s) || !nonFood.test(s);
  },

  hasVenueType(searchTerm) {
    return /\b(restaurants?|cafes?|coffee|bars?|pubs?|brewer(?:y|ies)|baker(?:y|ies)|bistros?|trattorias?|osterias?|tavernas?|hotels?|museums?|galleries?|beaches?|trails?|parks?)\b/i.test(
      searchTerm || ""
    );
  },

  inferPlaceType(searchTerm, raw, foodIntent) {
    const s = `${searchTerm} ${raw}`.toLowerCase();
    if (/\b(coffee|cafe|café)\b/.test(s)) return "cafe";
    if (/\b(bar|pub|cocktail|brewery|wine bar)\b/.test(s)) return "bar";
    if (/\b(bakery|pastry)\b/.test(s)) return "bakery";
    if (/\bbeach/.test(s)) return "beach";
    if (/\b(hike|trail|hiking)\b/.test(s)) return "trail";
    if (/\b(museum|galler)/.test(s)) return "museum";
    if (/\b(hotel|hostel|lodging)\b/.test(s)) return "hotel";
    if (/\b(park)\b/.test(s)) return "park";
    if (foodIntent) return "restaurant";
    if (!searchTerm) return "any";
    return "any";
  },

  // Optional LLM polish: expands query variants + local synonyms (non-blocking fallback)
  async refineIntentWithLLM(intent) {
    if (!this.state.apiKey_llm) return intent;
    if (intent.mode !== "specific" || !intent.searchTerm) return intent;

    try {
      const system =
        "Extract travel search intent. Return ONLY JSON. No markdown.";
      const user = `User message: "${intent.raw}"
Parsed so far: ${JSON.stringify({
        city: intent.city,
        searchTerm: intent.searchTerm,
        placeType: intent.placeType,
        modifiers: intent.modifiers,
      })}

Return JSON:
{"city":"","search_term":"","place_type":"restaurant|cafe|bar|bakery|beach|trail|museum|hotel|park|any","modifiers":[],"query_variants":["3-6 Google Places text queries WITHOUT the city name"],"local_synonyms":["optional local language terms"]}

CRITICAL: Start with { end with }. query_variants must match user intent only — never add coffee/beer unless asked.`;

      const response = await this.llmCall(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        0.2,
        800
      );
      const parsed = this.extractJSON(response);
      if (!parsed || typeof parsed !== "object") return intent;

      if (parsed.city && String(parsed.city).trim()) intent.city = String(parsed.city).trim();
      if (parsed.search_term && String(parsed.search_term).trim()) {
        intent.searchTerm = String(parsed.search_term).trim();
      }
      if (parsed.place_type) intent.placeType = String(parsed.place_type).toLowerCase();
      if (Array.isArray(parsed.modifiers) && parsed.modifiers.length) {
        intent.modifiers = [...new Set([...(intent.modifiers || []), ...parsed.modifiers.map(String)])];
      }
      if (Array.isArray(parsed.query_variants)) {
        intent.queryVariants = parsed.query_variants
          .map((q) => String(q).trim())
          .filter((q) => q.length > 1 && q.length < 80)
          .slice(0, 8);
      }
      if (Array.isArray(parsed.local_synonyms)) {
        intent.localSynonyms = parsed.local_synonyms
          .map((q) => String(q).trim())
          .filter(Boolean)
          .slice(0, 6);
      }
      // Recompute food intent from refined term
      intent.foodIntent = this.isFoodIntent(intent.searchTerm, intent.raw);
    } catch (err) {
      console.warn("refineIntentWithLLM failed:", err.message);
    }
    return intent;
  },

  async geocodeCity(city) {
    if (!city || !this.state.apiKey_places) return null;
    try {
      const res = await fetch(CONFIG.PLACES_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.state.apiKey_places,
          "X-Goog-FieldMask": "places.location,places.displayName,places.formattedAddress",
        },
        body: JSON.stringify({ textQuery: city, languageCode: "en", pageSize: 1 }),
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

  // ─── Places search ─────────────────────────────────────
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
          center: { latitude: locationBias.lat, longitude: locationBias.lng },
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
    return res.json();
  },

  async searchAllQueries(queries, onProgress, locationBias) {
    const allPlaces = [];
    const seen = new Set();
    this.state._lastCount = 0;
    this.state._locationBias = locationBias || null;
    const maxPages = CONFIG.SEARCH_PAGES || 3;

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

          const key =
            parsed.id ||
            parsed.name.toLowerCase() + "|" + (parsed.address || "").substring(0, 40).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          allPlaces.push(parsed);
        }

        this.state._lastCount = allPlaces.length;
        token = result.nextPageToken;
        if (!token) break;
        page++;
        await new Promise((r) => setTimeout(r, 1200));
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return allPlaces;
  },

  parsePlace(p) {
    const rawId = p.id || p.name || "";
    const id = String(rawId).replace(/^places\//, "");
    const name = p.displayName?.text || "";
    if (!name) return null;

    const priceMap = {
      PRICE_LEVEL_FREE: "free",
      PRICE_LEVEL_INEXPENSIVE: "$",
      PRICE_LEVEL_MODERATE: "$$",
      PRICE_LEVEL_EXPENSIVE: "$$$",
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

  // ─── Query building ────────────────────────────────────
  // Profile keywords ONLY on open browse. Specific intent → intent expansions only.
  buildQueries(profile, userMessageOrIntent) {
    const intent =
      typeof userMessageOrIntent === "string"
        ? this.parseUserIntent(userMessageOrIntent)
        : userMessageOrIntent || {};

    const city = intent.city || "";
    const searchTerm = intent.searchTerm || "";
    const foodIntent = !!intent.foodIntent;
    const placeType = intent.placeType || "any";
    const keywords = profile?.search_keywords || [];
    const queries = [];
    const withCity = (q) => (city ? `${q} in ${city}` : q);

    const pushUnique = (list, q) => {
      const n = String(q).toLowerCase().replace(/\s+/g, " ").trim();
      if (!n || list._seen.has(n)) return;
      list._seen.add(n);
      list.push(String(q).trim());
    };
    queries._seen = new Set();

    if (searchTerm && searchTerm.length > 2) {
      // LLM variants first if present
      if (Array.isArray(intent.queryVariants)) {
        for (const v of intent.queryVariants) pushUnique(queries, withCity(v));
      }
      if (Array.isArray(intent.localSynonyms)) {
        for (const v of intent.localSynonyms) pushUnique(queries, withCity(v));
      }

      pushUnique(queries, withCity(searchTerm));

      if (foodIntent) {
        if (!this.hasVenueType(searchTerm) && !/\brestaurant/i.test(searchTerm)) {
          pushUnique(queries, withCity(`${searchTerm} restaurant`));
        }
        if (/\bfish|seafood|pesce|pescado\b/i.test(searchTerm)) {
          pushUnique(queries, withCity("seafood restaurant"));
          pushUnique(queries, withCity("fresh seafood"));
          pushUnique(queries, withCity("pescheria"));
          pushUnique(queries, withCity("fish market restaurant"));
        }
        if (/\bpizza\b/i.test(searchTerm)) {
          pushUnique(queries, withCity("pizzeria"));
          pushUnique(queries, withCity("wood fired pizza"));
        }
        if (/\bsushi|japanese\b/i.test(searchTerm)) {
          pushUnique(queries, withCity("sushi restaurant"));
        }
        if (/\bcoffee|cafe|café\b/i.test(searchTerm)) {
          pushUnique(queries, withCity("specialty coffee"));
          pushUnique(queries, withCity("coffee shop"));
        }
        if (/\bbeer|brewery\b/i.test(searchTerm)) {
          pushUnique(queries, withCity("craft beer"));
          pushUnique(queries, withCity("brewery"));
        }
        if (/\bwine\b/i.test(searchTerm)) {
          pushUnique(queries, withCity("natural wine bar"));
          pushUnique(queries, withCity("wine bar"));
        }
      } else {
        if (placeType === "beach" || /\bbeach/i.test(searchTerm)) {
          pushUnique(queries, withCity("beach"));
          pushUnique(queries, withCity("beach club"));
        } else if (placeType === "trail" || /\bhike|trail|hiking\b/i.test(searchTerm)) {
          pushUnique(queries, withCity("hiking trail"));
          pushUnique(queries, withCity("nature trail"));
          pushUnique(queries, withCity("scenic hike"));
        } else if (placeType === "museum" || /\bmuseum|galler/i.test(searchTerm)) {
          pushUnique(queries, withCity("museum"));
          pushUnique(queries, withCity("art museum"));
          pushUnique(queries, withCity("gallery"));
        } else if (placeType === "park") {
          pushUnique(queries, withCity("park"));
          pushUnique(queries, withCity("public garden"));
        }
      }

      // Modifier-aware extras (still intent-scoped)
      if ((intent.modifiers || []).includes("outdoor")) {
        pushUnique(queries, withCity(`${searchTerm} outdoor seating`));
      }
      if ((intent.modifiers || []).includes("budget")) {
        pushUnique(queries, withCity(`cheap ${searchTerm}`));
      }
    } else {
      // Open browse — profile keywords only
      for (const kw of keywords.slice(0, 15)) {
        const k = String(kw).trim();
        if (!k) continue;
        if (/^(artisanal|minimal design|design-forward|cozy|aesthetic)$/i.test(k)) {
          pushUnique(queries, withCity(`${k} restaurant`));
        } else {
          pushUnique(queries, withCity(k));
        }
      }
      if (city && queries.length === 0) pushUnique(queries, `best places in ${city}`);
    }

    delete queries._seen;
    this.state._lastIntent = intent;
    return queries;
  },

  // ─── Heuristic prefilter + shortlist ───────────────────
  intentTypeMatchScore(place, intent) {
    if (!intent || intent.mode === "browse" || !intent.searchTerm) return 1; // neutral

    const types = (place.types || []).map((t) => String(t).toLowerCase());
    const cat = (place.category || "").toLowerCase();
    const blob = [
      place.name,
      place.primary_type,
      place.editorial_summary,
      cat,
      types.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    const term = (intent.searchTerm || "").toLowerCase();
    const tokens = term.split(/\s+/).filter((t) => t.length > 2);
    let score = 0;

    // Type alignment
    const pt = intent.placeType || "any";
    const typeMap = {
      restaurant: ["restaurant", "seafood_restaurant", "meal_takeaway", "meal_delivery"],
      cafe: ["cafe", "coffee_shop"],
      bar: ["bar", "wine_bar", "night_club"],
      bakery: ["bakery"],
      beach: ["beach"],
      trail: ["park", "tourist_attraction", "hiking_area"],
      museum: ["museum", "art_gallery"],
      hotel: ["lodging"],
      park: ["park"],
    };
    if (pt !== "any" && typeMap[pt]) {
      if (typeMap[pt].some((t) => types.includes(t) || cat.includes(t.split("_")[0]))) score += 0.45;
      else score -= 0.25;
    }

    // Token hits
    let hits = 0;
    for (const t of tokens) {
      if (blob.includes(t)) hits++;
    }
    if (tokens.length) score += 0.4 * (hits / tokens.length);

    // Seafood special case
    if (/\bfish|seafood|pesce|pescado\b/.test(term)) {
      if (/\b(fish|seafood|pesce|marin|sea|oyster|caught)\b/.test(blob) || types.includes("seafood_restaurant")) {
        score += 0.35;
      }
      if (types.includes("coffee_shop") || types.includes("cafe") || cat === "coffee") score -= 0.5;
      if (types.includes("bar") && !/\bwine|cocktail/.test(term)) score -= 0.15;
    }

    // Modifiers
    if ((intent.modifiers || []).includes("outdoor") && place.outdoor_seating) score += 0.1;
    if ((intent.modifiers || []).includes("vegetarian") && place.serves_vegetarian) score += 0.1;

    return Math.max(0, Math.min(1, score));
  },

  heuristicPlaceScore(place, intent) {
    const rating = place.rating != null ? place.rating : 3.8;
    const reviews = place.user_rating_count != null ? place.user_rating_count : 20;
    const ratingN = Math.max(0, Math.min(1, (rating - 3) / 2)); // 3→0, 5→1
    const reviewsN = Math.max(0, Math.min(1, Math.log10(reviews + 1) / 3)); // ~1000 → ~1
    const intentN = this.intentTypeMatchScore(place, intent);
    // Prefer intent match heavily in shortlist
    return intentN * 0.55 + ratingN * 0.3 + reviewsN * 0.15;
  },

  prefilterCandidates(candidates, intent) {
    const minRating = CONFIG.PREFILTER_MIN_RATING ?? 3.5;
    const minReviews = CONFIG.PREFILTER_MIN_REVIEWS ?? 5;
    const llmCap = CONFIG.LLM_RANK_CAP || 150;

    let softDropped = 0;
    const kept = [];

    for (const c of candidates) {
      if (!c.name || c.name.length < 3) {
        softDropped++;
        continue;
      }
      // Soft quality gate: only drop when rating AND reviews both look weak
      if (
        c.rating != null &&
        c.rating < minRating &&
        (c.user_rating_count == null || c.user_rating_count < minReviews * 4)
      ) {
        softDropped++;
        continue;
      }
      // Strong intent mismatch drop for specific searches
      if (intent && intent.mode === "specific" && intent.searchTerm) {
        const im = this.intentTypeMatchScore(c, intent);
        if (im < 0.12 && c.rating != null && c.rating < 4.6) {
          softDropped++;
          continue;
        }
      }
      kept.push(c);
    }

    // Shortlist for LLM
    const scored = kept
      .map((p) => ({ p, h: this.heuristicPlaceScore(p, intent) }))
      .sort((a, b) => b.h - a.h);

    const forLlm = scored.slice(0, llmCap).map((x) => x.p);
    const rest = scored.slice(llmCap).map((x) => x.p); // ranked later with heuristic-only tons

    const stats = {
      input: candidates.length,
      afterQuality: kept.length,
      softDropped,
      llmRanked: forLlm.length,
      heuristicOnly: rest.length,
    };
    this.state._prefilterStats = stats;
    return { forLlm, heuristicOnly: rest, stats };
  },

  // ─── Rank (dual intent × taste) ────────────────────────
  async rankCandidates(candidates, profile, onProgress, searchQueryOrIntent) {
    const intent =
      typeof searchQueryOrIntent === "string"
        ? { ...this.parseUserIntent(searchQueryOrIntent), searchTerm: searchQueryOrIntent }
        : searchQueryOrIntent || this.state._lastIntent || {};

    const searchLabel = intent.searchTerm || intent.raw || "";
    const { forLlm, heuristicOnly, stats } = this.prefilterCandidates(candidates, intent);

    if (onProgress) onProgress(0, Math.max(1, Math.ceil(forLlm.length / (CONFIG.RANK_BATCH_SIZE || 10))), stats);

    const batchSize = CONFIG.RANK_BATCH_SIZE || 10;
    const numBatches = Math.ceil(forLlm.length / batchSize) || 0;
    const allScores = [];
    this.state._scoredCount = 0;
    const CONCURRENCY = CONFIG.LLM_CONCURRENCY || 5;

    const profileSummary = JSON.stringify(
      {
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
      },
      null,
      2
    );

    for (let i = 0; i < numBatches; i += CONCURRENCY) {
      const promises = [];
      for (let j = 0; j < CONCURRENCY && i + j < numBatches; j++) {
        const batchIdx = i + j;
        const batch = forLlm.slice(batchIdx * batchSize, (batchIdx + 1) * batchSize);
        if (onProgress) onProgress(batchIdx + 1, numBatches, stats);
        promises.push(this.rankBatch(batch, profileSummary, batchIdx, numBatches, intent, searchLabel));
      }
      const results = await Promise.all(promises);
      for (const scores of results) {
        if (Array.isArray(scores)) {
          allScores.push(...scores);
          this.state._scoredCount += scores.length;
        }
      }
    }

    const scoreById = {};
    const scoreByName = {};
    for (const s of allScores) {
      if (!s || s.taste_score == null && s.score == null) continue;
      if (s.id) scoreById[String(s.id)] = s;
      if (s.name) scoreByName[String(s.name).toLowerCase()] = s;
    }

    const iw = CONFIG.INTENT_WEIGHT ?? 0.45;
    const tw = CONFIG.TASTE_WEIGHT ?? 0.55;

    const mergeOne = (p, s, heuristicFallback = false) => {
      let intentScore;
      let tasteScore;
      if (s && (s.intent_score != null || s.taste_score != null || s.score != null)) {
        intentScore =
          typeof s.intent_score === "number"
            ? s.intent_score
            : intent.mode === "browse"
              ? 8
              : typeof s.score === "number"
                ? s.score
                : 5;
        tasteScore =
          typeof s.taste_score === "number"
            ? s.taste_score
            : typeof s.score === "number"
              ? s.score
              : 0;
      } else if (heuristicFallback) {
        // Scale heuristic 0-1 → dual scores
        const h = this.heuristicPlaceScore(p, intent);
        const im = this.intentTypeMatchScore(p, intent);
        intentScore = Math.round(im * 10 * 10) / 10;
        tasteScore = Math.round((h * 6 + (p.rating != null ? ((p.rating - 3) / 2) * 4 : 3)) * 10) / 10;
        tasteScore = Math.max(0, Math.min(10, tasteScore));
      } else {
        intentScore = 0;
        tasteScore = 0;
      }

      intentScore = Math.max(0, Math.min(10, Number(intentScore) || 0));
      tasteScore = Math.max(0, Math.min(10, Number(tasteScore) || 0));
      // Hard rule: failed intent cannot keep high combined
      if (intent.mode === "specific" && intent.searchTerm && intentScore <= 3) {
        tasteScore = Math.min(tasteScore, 4);
      }
      const combined = Math.round((intentScore * iw + tasteScore * tw) * 10) / 10;

      return {
        ...p,
        intent_score: intentScore,
        taste_score: tasteScore,
        score: combined,
        reason: (s && s.reason) || (heuristicFallback ? "Heuristic shortlist (not LLM-scored)" : ""),
        tags: (s && s.tags) || [],
      };
    };

    const rankedLlm = forLlm.map((p) => {
      const s = (p.id && scoreById[p.id]) || scoreByName[p.name.toLowerCase()] || null;
      return mergeOne(p, s, !s);
    });

    const rankedRest = heuristicOnly.map((p) => mergeOne(p, null, true));

    return [...rankedLlm, ...rankedRest].sort((a, b) => b.score - a.score);
  },

  async rankBatch(batch, profileSummary, batchIdx, totalBatches, intent, searchLabel) {
    const retries = CONFIG.RANK_BATCH_RETRIES ?? 2;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const placesText = batch.map((p) => this.formatPlace(p)).join("\n");
        const system = `You score places for a taste-matching engine. Always return dual scores.
intent_score 0-10: how well the place matches the user's search intent (dish/type/activity).
taste_score 0-10: how well it matches the person's long-term taste profile.
If intent is specific and the place does not match intent, intent_score MUST be 0-3.`;

        const intentBlock =
          intent && intent.mode === "specific" && (intent.searchTerm || searchLabel)
            ? `\n## User search intent
- query: "${intent.searchTerm || searchLabel}"
- place_type: ${intent.placeType || "any"}
- modifiers: ${(intent.modifiers || []).join(", ") || "none"}
Rules:
- intent_score 7-10 only if place clearly matches the search intent
- intent_score 0-3 if wrong category (e.g. cafe when user asked for seafood)
- taste_score independent of intent, but final usefulness needs both`
            : `\n## Open browse (no specific dish)
- intent_score: set 7-9 for generally recommendable places, lower for tourist traps`;

        const user = `## Taste Profile
${profileSummary}
${intentBlock}

## Candidate Places
${placesText}

Return JSON array (same names/ids):
[{"id":"","name":"","intent_score":0,"taste_score":0,"reason":"short","tags":[]}]

CRITICAL: ONLY the JSON array. No markdown, no code fences. Start with [ end with ].`;

        const response = await this.llmCall(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          0.15,
          8000
        );
        const scores = this.extractJSON(response);
        if (Array.isArray(scores) && scores.length) {
          // normalize legacy `score` field
          return scores.map((s) => {
            if (s.taste_score == null && s.score != null) s.taste_score = s.score;
            if (s.intent_score == null && s.score != null) {
              s.intent_score = intent?.mode === "specific" ? s.score : 8;
            }
            return s;
          });
        }
        lastErr = new Error("empty/invalid JSON");
        console.warn(`Batch ${batchIdx + 1} attempt ${attempt + 1}: bad JSON`);
      } catch (err) {
        lastErr = err;
        console.warn(`Batch ${batchIdx + 1} attempt ${attempt + 1}: ${err.message}`);
      }
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    console.warn(`Batch ${batchIdx + 1} failed after retries:`, lastErr?.message);
    return [];
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
      ["serves_coffee", "coffee"],
      ["serves_beer", "beer"],
      ["serves_wine", "wine"],
      ["serves_cocktails", "cocktails"],
      ["serves_brunch", "brunch"],
      ["serves_dessert", "dessert"],
      ["serves_vegetarian", "vegetarian"],
      ["outdoor_seating", "outdoor"],
      ["dine_in", "dine-in"],
      ["takeout", "takeout"],
      ["good_for_groups", "groups"],
      ["live_music", "live music"],
    ]) {
      if (p[flag]) flags.push(label);
    }
    if (flags.length) parts.push(`\n     amenities: ${flags.join(", ")}`);
    return "  " + parts.join(" ");
  },
};

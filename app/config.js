// Taste Finder — Configuration constants

const CONFIG = {
  PLACES_API_URL: "https://places.googleapis.com/v1/places:searchText",
  OPENROUTER_URL: "https://openrouter.ai/api/v1/chat/completions",
  PLACES_FIELD_MASK: [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.priceLevel",
    "places.primaryTypeDisplayName",
    "places.editorialSummary",
    "places.googleMapsUri",
    "places.websiteUri",
    "places.location",
    "places.types",
    "places.servesCoffee",
    "places.servesBeer",
    "places.servesWine",
    "places.servesCocktails",
    "places.servesBrunch",
    "places.servesDessert",
    "places.servesVegetarianFood",
    "places.outdoorSeating",
    "places.dineIn",
    "places.takeout",
    "places.reservable",
    "places.liveMusic",
    "places.goodForGroups",
    "places.businessStatus",
    "nextPageToken",
  ].join(","),
  CHUNK_SIZE: 100,
  RANK_BATCH_SIZE: 10,
  MAX_CANDIDATES: 9999,

  // Defaults
  DEFAULT_LLM_MODEL: "openai/gpt-4o-mini",
  DEFAULT_MIN_SCORE: 5,
  MAX_DISPLAY_RESULTS: 100,

  // Search
  SEARCH_PAGES: 3,                // API max 3
  LOCATION_BIAS_RADIUS_M: 25000,  // 25km circle when city is geocoded
  MAPS_DIR_MAX_STOPS: 10,

  // Wave 2 — prefilter before expensive LLM rank
  PREFILTER_MIN_RATING: 3.5,      // soft floor (places with null rating still pass)
  PREFILTER_MIN_REVIEWS: 5,       // soft floor when rating present
  LLM_RANK_CAP: 150,              // max places sent to LLM after heuristic shortlist
  INTENT_WEIGHT: 0.45,            // combined = intent*w + taste*(1-w)
  TASTE_WEIGHT: 0.55,

  // Wave 3 — reliability
  RANK_BATCH_RETRIES: 2,
  LLM_CONCURRENCY: 5,
};

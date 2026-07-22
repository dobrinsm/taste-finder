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
  // Wave 1
  DEFAULT_MIN_SCORE: 5,
  MAX_DISPLAY_RESULTS: 100,       // show more than old hardcap of 15
  SEARCH_PAGES: 2,                // 1-3; API max 3
  LOCATION_BIAS_RADIUS_M: 25000,  // 25km circle when city is geocoded
  MAPS_DIR_MAX_STOPS: 10,         // Google dir URL practical limit
};

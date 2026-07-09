# Taste Finder

> Turn your Google Maps saved places into a taste profile and discover similar spots anywhere.

![Taste Finder](https://img.shields.io/badge/Taste-Finder-f97316)

## What it does

1. **Upload** your Google Maps saved places export (from Google Takeout)
2. **AI analyzes** your 5000+ saved places to build a taste profile (cuisine, vibe, design, outdoor interests, travel style)
3. **Chat** naturally: "Find fresh fish in Catania" or "Craft beer bars in Berlin"
4. **Get ranked recommendations** with ratings, reviews, prices, and Google Maps links

## Features

- 🤖 **Chatbot interface** — ask naturally, get personalized results
- 🎯 **Taste profile** — learns from ALL your saved places (restaurants, beaches, trails, museums, landmarks)
- 🔍 **Google Places API** — real ratings, reviews, price levels, editorial summaries
- 🗺️ **Direct Maps integration** — one click to open in Google Maps, star to save
- 🔒 **Privacy-first** — your API keys never leave your browser. No server, no tracking.
- 📦 **Handles 5000+ places** — chunked LLM analysis with synthesis

## Quick Start

### 1. Get API keys

- **Google Places API key**: [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials) → Enable "Places API (New)" → Create API key
- **OpenRouter API key**: [openrouter.ai/keys](https://openrouter.ai/keys) → Create key

### 2. Export your Google Maps saved places

Go to [Google Takeout](https://takeout.google.com):
- Deselect all → check **Maps (your places)**
- Export as JSON

### 3. Use Taste Finder

- Open the app
- Paste your API keys in the sidebar
- Upload your Google Maps export
- Ask: *"Find fresh fish in Catania"*

## Deploy

### Netlify

```bash
# Drag and drop the /app folder to Netlify
# Or connect this repo — Netlify auto-detects static site
```

The app is 100% static — no backend needed. All API calls go directly from the browser.

```bash
# Local development — just serve the folder
cd app && python3 -m http.server 8000
# Open http://localhost:8000
```

## How it works

```
Google Maps Export (5000 places)
    ↓
Chunked LLM Analysis (100 places/batch × 50 batches)
    ↓
Taste Profile (cuisines, vibes, outdoor interests, keywords)
    ↓
Google Places Text Search (15-25 keyword queries per city)
    ↓
LLM Taste Scoring (batched, 10 places/call)
    ↓
Ranked Recommendations with Maps links
```

## Tech

- **Frontend**: Vanilla JS, no framework, no build step
- **APIs**: Google Places API (New), OpenRouter (LLM)
- **Hosting**: Static site — Netlify, GitHub Pages, Vercel, anywhere
- **Privacy**: Keys stored in localStorage, all calls from browser

## Cost

- Google Places: ~$0.035/search × ~20 queries = **~$0.18 per city**
- OpenRouter: ~$0.30 for profile build (5000 places) + ~$0.20 for ranking
- **Total: ~$0.70 per city search**
- Google gives $200/month free credit, OpenRouter has free models too

## License

MIT

# Taste Finder — Collaborative Partner Agent
### Submission for the *All Things Agentic Hackathon* (Collaborative Partner Track)

[![Google GenAI SDK](https://img.shields.io/badge/Google%20GenAI%20SDK-Gemini%202.5%2F3.5-4285F4)](https://cloud.google.com/vertex-ai)
[![Google Cloud Run](https://img.shields.io/badge/Google%20Cloud-Cloud%20Run-34A853)](https://cloud.google.com/run)
[![Google Cloud Firestore](https://img.shields.io/badge/Database-Cloud%20Firestore-EA4335)](https://cloud.google.com/firestore)
[![Places API New](https://img.shields.io/badge/Google%20Maps-Places%20API%20(New)-FBBC05)](https://developers.google.com/maps/documentation/places/web-service)

---

## 🎯 Track: Collaborative Partner
> **Track Goal**: *Build an agent that leads the way and takes notes. It should ask clarifying questions, guide the user step-by-step, and have a clear way to capture feedback, so it constantly adapts to the user's unique way of thinking.*

**Taste Finder** turns passive search into an interactive, collaborative co-discovery journey:
1. **Leads the Way Step-by-Step**: Proactively guides the user from high-level destination discovery down to specific spot recommendations.
2. **Asks Clarifying Questions**: Detects ambiguities in ambiance, occasion, and budget to narrow down candidate places before jumping to conclusions.
3. **Takes Notes (Agent Notebook)**: Autonomously curates confirmed preferences, itinerary notes, and shortlisted spots into a live, structured notebook.
4. **Adaptive Feedback Loop**: Every user interaction (👍 *Love it*, 🚩 *Touristy*, 🎭 *Wrong vibe*) immediately updates the user's continuous Taste Vector in Google Cloud Firestore.

---

## 🏗️ System Architecture

```
                                  ┌────────────────────────────────┐
                                  │   User / Web Client (SPA)      │
                                  └───────────────┬────────────────┘
                                                  │
                                                  ▼
                               ┌─────────────────────────────────────┐
                               │  Google Cloud Run: FastAPI Agent    │
                               │  (Google GenAI SDK on Vertex AI)    │
                               └──────┬───────────────────────┬──────┘
                                      │                       │
                ┌─────────────────────┴───────┐       ┌───────┴────────────────────┐
                ▼                             ▼       ▼                            ▼
   ┌───────────────────────────┐ ┌──────────────────────────┐ ┌───────────────────────────────┐
   │ Gemini 2.5/3.5 Flash      │ │ Google Places API (New)  │ │ Google Cloud Firestore Native │
   │ • Proactive Guidance      │ │ • Live Text Search       │ │ • User Taste Profiles         │
   │ • Clarifying Questions    │ │ • Ratings & Reviews      │ │ • Real-time Session Memory    │
   │ • Intent × Taste Matching │ │ • Geo Coordinates        │ │ • Agent Notebook (Itineraries)│
   │ • Continuous Adaptation   │ │ • Price Levels & Maps URL│ │ • Continuous Feedback Logs    │
   └───────────────────────────┘ └──────────────────────────┘ └───────────────────────────────┘
```

---

## 🚀 Hackathon Mandatory Requirements Checklist

- [x] **Gemini 2.5/3.5 Flash / Pro** accessed via Vertex AI & Google GenAI SDK.
- [x] **Google Agent Framework**: Built with the **Google GenAI SDK** with structured output schemas, dynamic tools, and continuous feedback loops.
- [x] **Google Cloud Infrastructure**:
  - **Cloud Run**: Serverless containerized backend.
  - **Cloud Firestore**: Native NoSQL database for taste vectors, sessions, and notebooks.
  - **Vertex AI**: Enterprise-grade model hosting and inference.
  - **Google Places API (New)**: Live geocoding and venue data.

---

## ⚡ Quick Start & Spin-Up Instructions

### Prerequisites
- Python 3.11+
- Google Cloud Service Account JSON with Vertex AI & Firestore permissions
- Google Places API Key

### 1. Clone & Setup Environment
```bash
git clone https://github.com/dobrinsm/taste-finder.git
cd taste-finder

# Install dependencies
pip install -r backend/requirements.txt
```

### 2. Configure Environment Variables
Create a `.env` file or export your credentials:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/gcp-key.json"
export GOOGLE_CLOUD_PROJECT="taste-finder-506205"
export GOOGLE_PLACES_API_KEY="AIzaSy..."
```

### 3. Run Locally
```bash
cd backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```
Open **`http://localhost:8000`** in your browser.

---

## 🐳 Deploying to Google Cloud Run

```bash
# Build and deploy container directly to Cloud Run
gcloud run deploy taste-finder-agent \
  --source . \
  --project taste-finder-506205 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=taste-finder-506205,GOOGLE_PLACES_API_KEY="AIzaSy..."
```

---

## 💡 Key Accomplishments
- **True Agentic Collaboration**: Rather than a static search box, the agent engages in a multi-turn dialogue, clarifying desires before querying.
- **Dual Intent × Taste Profiling**: Eliminates the common trade-off between search relevance and personal taste bias by computing hybrid ranking scores.
- **Persistent Agent Memory**: Real-time Firestore synchronization of user vectors, feedback history, and itinerary notebooks across sessions.

---

## 📄 License
MIT License. Built with ❤️ for the **All Things Agentic Hackathon**.

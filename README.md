# Taste Finder — Collaborative Partner Agent
### Submission for the *All Things Agentic Hackathon* (Collaborative Partner Track)

[![Google GenAI SDK](https://img.shields.io/badge/Google%20GenAI%20SDK-Gemini%203.5%20Flash-4285F4)](https://cloud.google.com/vertex-ai)
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

- [x] **Gemini 3.5 Flash / Pro (or newer)** accessed via Vertex AI & Google GenAI SDK.
- [x] **Google Agent Framework**: Built with the **Google GenAI SDK (`google-genai`)** with structured Pydantic/JSON schemas, multi-turn reasoning loops, proactive clarification triggers, and real-time state adaptation.
- [x] **Google Cloud Infrastructure**:
  - **Cloud Run**: Serverless containerized backend execution.
  - **Cloud Firestore**: Native NoSQL document store for persistent taste vectors, session state, feedback logs, and agent notebooks.
  - **Vertex AI**: Enterprise-grade model execution endpoint.
  - **Google Places API (New)**: Live venue & geo-search integration.

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

## ☁️ Deploying to Google Cloud Run

The live deployment uses Docker → Artifact Registry → Cloud Run v2 (the `--source` / Cloud Build flow isn't available with the SA's permissions, so the image is built and pushed locally).

**Service account** (`taste-finder-agent@taste-finder-506205.iam.gserviceaccount.com`) needs at minimum: Cloud Run Admin, Artifact Registry Admin (or Storage Admin), Datastore/Firestore User, and Vertex AI User. It becomes the runtime identity — config must come from env vars, **never** a baked-in `.env` (the Dockerfile strips `backend/.env` for this reason).

```bash
export PATH=/opt/google-cloud-sdk/bin:$PATH      # or wherever gcloud lives
export GCLOUD_PROJECT=taste-finder-506205
export REGION=europe-west1
export GCP_REGISTRY=europe-west1-docker.pkg.dev/taste-finder-506205/taste-finder

# 1. Auth as the SA (or a user with the roles above)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/gcp-key.json gcloud auth application-default login --brief

# 2. Build + push image to Artifact Registry (Cloud Build needs perms the SA lacks)
docker build -t "$GCP_REGISTRY/app:v3" /path/to/taste-finder
docker push "$GCP_REGISTRY/app:v3"

# 3. Deploy/redeploy the service via the Cloud Run v2 API, with env vars (no .env baked in)
TOKEN=$(gcloud auth print-access-token)
curl -s -X PATCH \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://europe-west1-run.googleapis.com/v2/projects/$GCLOUD_PROJECT/locations/$REGION/services/taste-finder" \
  -d '{
    "template": {"containers": [{
      "image": "'"$GCP_REGISTRY"'/app:v2",
      "env": [
        {"name":"GOOGLE_CLOUD_PROJECT","value":"taste-finder-506205"},
        {"name":"GEMINI_MODEL","value":"gemini-2.5-flash"},
        {"name":"GOOGLE_PLACES_API_KEY","value":"AIzaSy..."}
      ]
    }]}
  }'
# Poll the returned long-running operation until "done": {"response": {"uri": "https://taste-finder-<hash>-ew.a.run.app"}}

# 4. Make it public (skip if you locked down auth) — grants roles/run.invoker to allUsers
TOKEN=$(gcloud auth print-access-token)
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://europe-west1-run.googleapis.com/v2/projects/$GCLOUD_PROJECT/locations/$REGION/services/taste-finder:setIamPolicy" \
  -d '{"policy": {"bindings": [{"role":"roles/run.invoker","members":["allUsers"]}]}}'
```

> If runtime Firestore/Vertex calls fail, the SA is missing `roles/datastore.user` and/or Vertex AI user roles — add them in IAM & Admin → Service Accounts.

---

## 💡 Key Accomplishments
- **True Agentic Collaboration**: Rather than a static search box, the agent engages in a multi-turn dialogue, clarifying desires before querying.
- **Dual Intent × Taste Profiling**: Eliminates the common trade-off between search relevance and personal taste bias by computing hybrid ranking scores.
- **Persistent Agent Memory**: Real-time Firestore synchronization of user vectors, feedback history, and itinerary notebooks across sessions.

---

## 📄 License
MIT License. Built with ❤️ for the **All Things Agentic Hackathon**.

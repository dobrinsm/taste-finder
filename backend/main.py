import os
import json
import logging
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from db import TasteDB
from agent import CollaborativeTasteAgent

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("taste-finder-api")

app = FastAPI(
    title="Taste Finder - Collaborative Partner Agent",
    description="Autonomous travel discovery agent that guides step-by-step, keeps an agent notebook, and learns your unique taste profile.",
    version="2.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "taste-finder-506205")
db = TasteDB(project_id=PROJECT_ID)
agent = CollaborativeTasteAgent(project_id=PROJECT_ID)

# Pydantic Request Models
class ChatRequest(BaseModel):
    user_id: str = "user_default"
    session_id: str = "session_default"
    message: str

class FeedbackRequest(BaseModel):
    user_id: str = "user_default"
    session_id: str = "session_default"
    place_id: str
    place_name: str
    feedback_type: str  # 'like', 'dislike', 'too_touristy', 'wrong_vibe', 'saved_to_itinerary'
    comment: Optional[str] = None

class ProfileUpdateRequest(BaseModel):
    user_id: str = "user_default"
    taste_profile: Dict[str, Any]

# API Endpoints
@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "project": PROJECT_ID,
        "engine": "Gemini 2.5/3.5 on Vertex AI",
        "database": "Google Cloud Firestore Native",
        "track": "Collaborative Partner"
    }

@app.get("/api/profile/{user_id}")
def get_profile(user_id: str):
    return db.get_user_profile(user_id)

@app.post("/api/profile/update")
def update_profile(req: ProfileUpdateRequest):
    return db.update_taste_profile(req.user_id, req.taste_profile)

@app.get("/api/session/{session_id}")
def get_session(session_id: str, user_id: str = "user_default"):
    return db.get_session(session_id, user_id)

@app.post("/api/chat")
def chat(req: ChatRequest):
    try:
        response = agent.collaborate(
            user_id=req.user_id,
            session_id=req.session_id,
            user_message=req.message
        )
        return response
    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/feedback")
def feedback(req: FeedbackRequest):
    try:
        res = db.record_feedback(
            user_id=req.user_id,
            session_id=req.session_id,
            place_id=req.place_id,
            place_name=req.place_name,
            feedback_type=req.feedback_type,
            comment=req.comment
        )
        return res
    except Exception as e:
        logger.error(f"Feedback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload-takeout")
async def upload_takeout(user_id: str = "user_default", file: UploadFile = File(...)):
    try:
        content = await file.read()
        data = json.loads(content.decode("utf-8"))
        
        # Handle various Google Takeout formats (GeoJSON, Features list, or plain list)
        places = []
        if isinstance(data, list):
            places = data
        elif isinstance(data, dict):
            if "features" in data:
                for f in data["features"]:
                    props = f.get("properties", {})
                    places.append({
                        "name": props.get("Title") or props.get("name") or "Place",
                        "address": props.get("Address") or "",
                        "comment": props.get("Comment") or ""
                    })
            elif "saved_places" in data:
                places = data["saved_places"]
            else:
                # Top level object keys or generic
                places = [data]
        
        logger.info(f"Extracted {len(places)} places from takeout file for user {user_id}")
        profile = agent.build_taste_profile_from_places(user_id, places)
        return {"status": "success", "count": len(places), "profile": profile}
    except Exception as e:
        logger.error(f"Upload processing failed: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to process takeout export: {str(e)}")

# Mount frontend static files if available
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

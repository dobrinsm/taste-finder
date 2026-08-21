import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from google.cloud import firestore

logger = logging.getLogger("taste-finder-db")

class TasteDB:
    def __init__(self, project_id: Optional[str] = None):
        self.project_id = project_id or os.getenv("GOOGLE_CLOUD_PROJECT", "taste-finder-506205")
        self.client = firestore.Client(project=self.project_id)
        self.users_col = self.client.collection("users")
        self.sessions_col = self.client.collection("sessions")
        self.feedback_col = self.client.collection("feedback")

    # User / Taste Profile Operations
    def get_user_profile(self, user_id: str) -> Dict[str, Any]:
        doc = self.users_col.document(user_id).get()
        if doc.exists:
            data = doc.to_dict()
            if data is not None:
                return data
        default_profile: Dict[str, Any] = {
            "user_id": user_id,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "taste_profile": {
                "summary": "Explorer seeking local, authentic experiences with distinct atmosphere and high culinary standards.",
                "cuisines": ["Seafood", "Local / Regional", "Authentic Bistro", "Artisanal Bakery"],
                "vibes": ["Cozy & Intimate", "Scenic Views", "Lively Neighborhood Gem", "Historic Charm"],
                "price_preference": "$$ - Mid-range / Quality focus",
                "avoid": ["Mass tourist traps", "Generic global chains", "Overly noisy nightclubs"],
                "weights": {
                    "authenticity": 0.9,
                    "culinary_quality": 0.85,
                    "scenic_ambiance": 0.8,
                    "value_for_money": 0.75
                }
            },
            "saved_places_count": 0
        }
        self.users_col.document(user_id).set(default_profile)
        return default_profile

    def update_taste_profile(self, user_id: str, taste_profile: Dict[str, Any], saved_places_count: Optional[int] = None) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "taste_profile": taste_profile,
            "updated_at": datetime.utcnow().isoformat()
        }
        if saved_places_count is not None:
            data["saved_places_count"] = saved_places_count
        self.users_col.document(user_id).set(data, merge=True)
        return self.get_user_profile(user_id)

    # Session & Notebook Operations (Collaborative Partner State)
    def get_session(self, session_id: str, user_id: str) -> Dict[str, Any]:
        doc = self.sessions_col.document(session_id).get()
        if doc.exists:
            data = doc.to_dict()
            if data is not None:
                return data
        default_session: Dict[str, Any] = {
            "session_id": session_id,
            "user_id": user_id,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "messages": [],
            "notebook": {
                "destination": None,
                "clarified_preferences": {},
                "itinerary_notes": [],
                "shortlist": []
            }
        }
        self.sessions_col.document(session_id).set(default_session)
        return default_session

    def save_session_message(self, session_id: str, message: Dict[str, Any]):
        session_ref = self.sessions_col.document(session_id)
        session_doc = session_ref.get()
        if session_doc.exists:
            doc_data = session_doc.to_dict() or {}
            messages = doc_data.get("messages", [])
            messages.append(message)
            session_ref.update({
                "messages": messages,
                "updated_at": datetime.utcnow().isoformat()
            })
        else:
            session_ref.set({
                "session_id": session_id,
                "messages": [message],
                "notebook": {
                    "destination": None,
                    "clarified_preferences": {},
                    "itinerary_notes": [],
                    "shortlist": []
                },
                "updated_at": datetime.utcnow().isoformat()
            })

    def update_notebook(self, session_id: str, notebook_data: Dict[str, Any]):
        session_ref = self.sessions_col.document(session_id)
        session_ref.set({
            "notebook": notebook_data,
            "updated_at": datetime.utcnow().isoformat()
        }, merge=True)

    # Collaborative Feedback Loop
    def record_feedback(self, user_id: str, session_id: str, place_id: str, place_name: str, feedback_type: str, comment: Optional[str] = None) -> Dict[str, Any]:
        """
        Records thumbs up/down, updates feedback collection, and mutates user's taste profile.
        feedback_type: 'like', 'dislike', 'too_touristy', 'wrong_vibe', 'saved_to_itinerary'
        """
        feedback_entry = {
            "user_id": user_id,
            "session_id": session_id,
            "place_id": place_id,
            "place_name": place_name,
            "feedback_type": feedback_type,
            "comment": comment,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.feedback_col.add(feedback_entry)
        
        # Incrementally refine profile
        user_profile = self.get_user_profile(user_id)
        tp = user_profile.get("taste_profile", {})
        weights = tp.get("weights", {"authenticity": 0.8, "culinary_quality": 0.8, "scenic_ambiance": 0.7, "value_for_money": 0.7})
        
        if feedback_type in ("like", "saved_to_itinerary"):
            weights["authenticity"] = min(1.0, round(weights.get("authenticity", 0.8) + 0.02, 2))
        elif feedback_type == "too_touristy":
            weights["authenticity"] = min(1.0, round(weights.get("authenticity", 0.8) + 0.08, 2))
            avoids = set(tp.get("avoid", []))
            avoids.add("Crowded tourist hubs")
            tp["avoid"] = list(avoids)
        elif feedback_type == "wrong_vibe":
            weights["scenic_ambiance"] = min(1.0, round(weights.get("scenic_ambiance", 0.7) + 0.05, 2))

        tp["weights"] = weights
        self.update_taste_profile(user_id, tp)
        return {"status": "success", "updated_weights": weights}

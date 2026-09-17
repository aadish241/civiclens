"""
CivicLens Backend — AI Multimodal Service (Phase 3)
Uses Google Gemini (gemini-3.6-flash) for automated complaint categorization,
severity assessment, municipal description generation, and spam/authenticity filtering.
"""

import base64
import json
import logging
from typing import Any, Dict, Optional
import httpx

from config import get_settings

logger = logging.getLogger("civiclens.ai")

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent"

SYSTEM_PROMPT = """You are CivicLens AI, an expert municipal civil engineering and public works inspection system.
Analyze the provided photo of a citizen-reported issue along with any user notes.

You must categorize and assess the complaint accurately for municipal dispatch in Patiala, Punjab.

Allowed Categories (pick exactly one):
- "pothole" : Road damage, craters, broken asphalt, sunken utility cuts
- "garbage" : Overflowing dumpsters, roadside trash heaps, uncollected waste
- "streetlight" : Non-functioning street lamp, broken light fixture, dangling wires
- "water_leak" : Burst water pipe, pooling municipal water, overflowing sewage/drain
- "other" : Park maintenance, fallen branches, signage issues, non-civic objects

Allowed Severities (pick exactly one):
- "low" : Minor cosmetic or localized issue with minimal public disruption
- "medium" : Impairs normal usage or pedestrian/vehicular flow, moderate concern
- "high" : Serious hazard to public safety, major traffic impediment, or immediate damage risk

Output JSON format strictly with these exact keys:
{
  "category": "pothole | garbage | streetlight | water_leak | other",
  "severity": "low | medium | high",
  "confidence_score": <float between 0.0 and 1.0>,
  "ai_description": "<concise 1-2 sentence formal municipal assessment summarizing the visible issue, defect type, and physical state>",
  "hazard_assessment": "<brief note on public risk, e.g. accident risk, water contamination, or None>",
  "is_civic_issue": <boolean: true if this is a legitimate public infrastructure or sanitation defect; false if the photo is unrelated (e.g. selfie, keyboard, indoor item, animal, spam)>
}
"""


async def analyze_complaint_image(
    photo_url: str,
    user_description: Optional[str] = None
) -> Dict[str, Any]:
    """
    Downloads the complaint photo from Supabase and passes it to Gemini 3.6 Flash
    along with the user's description. Returns structured classification dictionary.
    """
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY is not configured in environment.")

    # 1. Fetch the image bytes
    async with httpx.AsyncClient(timeout=20.0) as client:
        img_resp = await client.get(photo_url)
        if img_resp.status_code != 200:
            raise RuntimeError(f"Failed to fetch image from {photo_url}: HTTP {img_resp.status_code}")
        img_bytes = img_resp.content
        content_type = img_resp.headers.get("content-type", "image/jpeg").split(";")[0]

    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    # 2. Build Gemini prompt
    user_text = f"Citizen Description: {user_description}" if user_description else "No citizen description provided."
    full_prompt = f"{SYSTEM_PROMPT}\n\nCitizen Submission Context:\n{user_text}\n\nProvide the required JSON assessment:"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": full_prompt},
                    {
                        "inline_data": {
                            "mime_type": content_type,
                            "data": img_b64
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.2
        }
    }

    # 3. Call Gemini API with automatic model fallback for 503 / high-demand spikes
    candidate_models = [
        "gemini-3.1-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
    ]

    resp_json = None
    last_error = None

    async with httpx.AsyncClient(timeout=15.0) as client:
        for model in candidate_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.gemini_api_key}"
            try:
                logger.info(f"Calling Gemini model: {model}")
                resp = await client.post(url, json=payload)

                if resp.status_code == 400 and "Unable to process input image" in resp.text:
                    logger.warning(f"Corrupted or invalid image at {photo_url}: Gemini returned 400")
                    return {
                        "category": "other",
                        "severity": "low",
                        "confidence_score": 0.1,
                        "ai_description": "Image could not be decoded by AI vision model (unsupported format or corrupted photo). Routed for manual review.",
                        "hazard_assessment": "None",
                        "is_civic_issue": False,
                        "raw_response": {"error": "Unable to process input image"}
                    }

                if resp.status_code in (429, 503, 404):
                    logger.warning(f"Model {model} returned {resp.status_code}, trying next candidate...")
                    last_error = f"{model} returned HTTP {resp.status_code}"
                    continue

                if resp.status_code != 200:
                    logger.warning(f"Model {model} returned unexpected status {resp.status_code}: {resp.text[:200]}")
                    last_error = f"{model} returned HTTP {resp.status_code}"
                    continue

                resp_json = resp.json()
                logger.info(f"Model {model} successfully responded with 200 OK")
                break

            except Exception as e:
                logger.warning(f"Model {model} call error: {e}")
                last_error = str(e)
                continue

    if resp_json is None:
        raise RuntimeError(f"All Gemini models failed. Last error: {last_error}")

    # 4. Extract generated content
    try:
        candidates = resp_json.get("candidates", [])
        if not candidates:
            raise ValueError("No candidates returned from Gemini.")
        text_content = candidates[0]["content"]["parts"][0]["text"]
        result = json.loads(text_content)
    except Exception as e:
        logger.error(f"Failed to parse Gemini response: {e}, raw: {resp_json}")
        # Graceful fallback
        return {
            "category": "other",
            "severity": "low",
            "confidence_score": 0.5,
            "ai_description": user_description or "Unclassified municipal issue.",
            "hazard_assessment": "None",
            "is_civic_issue": True,
            "raw_response": resp_json
        }

    # Validate & normalize fields
    valid_categories = {"pothole", "garbage", "streetlight", "water_leak", "other"}
    valid_severities = {"low", "medium", "high"}

    cat = str(result.get("category", "other")).lower()
    if cat not in valid_categories:
        cat = "other"

    sev = str(result.get("severity", "low")).lower()
    if sev not in valid_severities:
        sev = "low"

    conf = float(result.get("confidence_score", 0.7))
    conf = max(0.0, min(1.0, conf))

    is_civic = bool(result.get("is_civic_issue", True))

    return {
        "category": cat,
        "severity": sev,
        "confidence_score": conf,
        "ai_description": result.get("ai_description", "").strip(),
        "hazard_assessment": result.get("hazard_assessment", "None"),
        "is_civic_issue": is_civic,
        "raw_response": result
    }

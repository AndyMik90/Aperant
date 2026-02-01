"""
Profiles Router
===============

API endpoints for Claude API profile management.
Stores API profiles with baseUrl, apiKey, and optional model mappings.
"""

import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))

from ..utils.security import get_secure_logger

router = APIRouter()
logger = get_secure_logger("auto-claude-api")


class APIProfile(BaseModel):
    """API Profile model matching frontend types."""

    id: str
    name: str
    baseUrl: str
    apiKey: str
    models: dict[str, str] | None = None
    createdAt: int  # Unix timestamp (ms)
    updatedAt: int  # Unix timestamp (ms)


class ProfilesFile(BaseModel):
    """Profiles file structure."""

    profiles: list[APIProfile]
    activeProfileId: str | None = None
    version: int = 1


def get_profiles_file() -> Path:
    """Get the path to the profiles file."""
    config_dir = Path.home() / ".auto-claude"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "api-profiles.json"


def load_profiles() -> dict:
    """Load profiles from file."""
    profiles_file = get_profiles_file()
    if not profiles_file.exists():
        return {"profiles": [], "activeProfileId": None, "version": 1}
    try:
        with open(profiles_file) as f:
            data = json.load(f)
            # Ensure version field exists
            if "version" not in data:
                data["version"] = 1
            return data
    except (json.JSONDecodeError, OSError):
        return {"profiles": [], "activeProfileId": None, "version": 1}


def save_profiles(data: dict) -> None:
    """Save profiles to file."""
    profiles_file = get_profiles_file()
    with open(profiles_file, "w") as f:
        json.dump(data, f, indent=2)


@router.get("")
async def get_profiles() -> dict:
    """Get all API profiles."""
    data = load_profiles()
    logger.info(f"📋 Returning {len(data.get('profiles', []))} profiles")
    return {"success": True, "data": data}


@router.post("")
async def create_profile(profile: dict[str, Any]) -> dict:
    """Create a new API profile."""
    data = load_profiles()

    now = int(time.time() * 1000)  # Unix timestamp in ms
    new_profile = {
        "id": str(uuid.uuid4()),
        "name": profile.get("name", "New Profile"),
        "baseUrl": profile.get("baseUrl", ""),
        "apiKey": profile.get("apiKey", ""),
        "models": profile.get("models"),
        "createdAt": now,
        "updatedAt": now,
    }

    data["profiles"].append(new_profile)

    # If this is the first profile, make it active
    if len(data["profiles"]) == 1:
        data["activeProfileId"] = new_profile["id"]

    save_profiles(data)
    logger.info(f"✅ Created profile: {new_profile['name']} (id: {new_profile['id']})")

    return {"success": True, "data": new_profile}


@router.put("/{profile_id}")
async def update_profile(profile_id: str, profile: dict[str, Any]) -> dict:
    """Update an existing API profile."""
    data = load_profiles()

    for i, p in enumerate(data["profiles"]):
        if p.get("id") == profile_id:
            now = int(time.time() * 1000)
            updated_profile = {
                **p,
                "name": profile.get("name", p.get("name")),
                "baseUrl": profile.get("baseUrl", p.get("baseUrl")),
                "apiKey": profile.get("apiKey", p.get("apiKey")),
                "models": profile.get("models", p.get("models")),
                "updatedAt": now,
            }
            data["profiles"][i] = updated_profile
            save_profiles(data)
            logger.info(f"✅ Updated profile: {updated_profile['name']}")
            return {"success": True, "data": updated_profile}

    raise HTTPException(status_code=404, detail="Profile not found")


@router.delete("/{profile_id}")
async def delete_profile(profile_id: str) -> dict:
    """Delete an API profile."""
    data = load_profiles()

    original_count = len(data["profiles"])
    data["profiles"] = [p for p in data["profiles"] if p.get("id") != profile_id]

    if len(data["profiles"]) == original_count:
        raise HTTPException(status_code=404, detail="Profile not found")

    if data.get("activeProfileId") == profile_id:
        data["activeProfileId"] = None

    save_profiles(data)
    logger.info(f"🗑️ Deleted profile: {profile_id}")
    return {"success": True}


@router.put("/{profile_id}/activate")
async def activate_profile(profile_id: str) -> dict:
    """Set a profile as active."""
    data = load_profiles()

    found = False
    for profile in data["profiles"]:
        if profile.get("id") == profile_id:
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail="Profile not found")

    data["activeProfileId"] = profile_id
    save_profiles(data)
    logger.info(f"✅ Activated profile: {profile_id}")

    return {"success": True}


@router.put("/active")
async def set_active_profile(request: dict[str, Any]) -> dict:
    """Set the active profile by ID (can be null to deactivate)."""
    data = load_profiles()
    profile_id = request.get("profileId")

    if profile_id is not None:
        found = any(p.get("id") == profile_id for p in data["profiles"])
        if not found:
            raise HTTPException(status_code=404, detail="Profile not found")

    data["activeProfileId"] = profile_id
    save_profiles(data)
    logger.info(f"✅ Set active profile: {profile_id}")

    return {"success": True}

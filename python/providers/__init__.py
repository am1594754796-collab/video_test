"""Pluggable providers for cloud/local AI backends.

Face:     providers.face
Semantic: providers.semantic

See docs/API-PROVIDERS.md for how to add a new vendor.
"""

from providers.face.factory import get_face_detector, face_provider_name, face_provider_status
from providers.semantic.factory import (
    get_semantic_judge,
    semantic_provider_name,
    semantic_provider_status,
)

__all__ = [
    "get_face_detector",
    "face_provider_name",
    "face_provider_status",
    "get_semantic_judge",
    "semantic_provider_name",
    "semantic_provider_status",
]

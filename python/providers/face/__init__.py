"""Face detector providers."""

from providers.face.factory import get_face_detector, face_provider_name, face_provider_status

__all__ = ["get_face_detector", "face_provider_name", "face_provider_status"]

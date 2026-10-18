"""Pluggable providers for cloud/local AI backends.

Semantic: providers.semantic

See docs/API-PROVIDERS.md for how to add a new vendor.
"""

from providers.semantic.factory import (
    get_semantic_judge,
    semantic_provider_name,
    semantic_provider_status,
)

__all__ = [
    "get_semantic_judge",
    "semantic_provider_name",
    "semantic_provider_status",
]

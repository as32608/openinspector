"""OpenInspector shared DB layer: pluggable adapter + repository.

Usage (both services):

    from shared.oidb import make_adapter, Repository

    repo = Repository(make_adapter())
    await repo.connect()
    await repo.ensure_schema()
"""

from .adapter import Adapter, make_adapter
from .repository import Repository, DuplicateSlug

__all__ = ["Adapter", "make_adapter", "Repository", "DuplicateSlug"]

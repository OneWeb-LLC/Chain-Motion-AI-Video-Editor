"""Workspace-scoped library roots for OWeb satellite API deployments."""
import os
import threading
from contextvars import ContextVar
from pathlib import Path

from .store import Store

_default_store = None
_store_ctx: ContextVar[Store | None] = ContextVar('frameforge_store', default=None)
_store_cache: dict[str, Store] = {}
_store_cache_lock = threading.Lock()


class StoreProxy:
    """Delegates to the per-request store when satellite mode is active."""

    def __getattr__(self, name):
        return getattr(active_store(), name)


def configure_default_store(store: Store) -> None:
    global _default_store
    _default_store = store


def active_store() -> Store:
    bound = _store_ctx.get()
    if bound is not None:
        return bound
    if _default_store is None:
        raise RuntimeError('Frameforge store is not configured')
    return _default_store


def satellite_enabled() -> bool:
    return os.environ.get('FRAMEFORGE_SATELLITE', '').lower() in ('1', 'true', 'yes')


def proxy_secret() -> str:
    return os.environ.get('FRAMEFORGE_PROXY_SECRET', '')


def data_root() -> Path:
    root = os.environ.get('FRAMEFORGE_DATA_ROOT') or os.environ.get('FRAMEFORGE_DATA')
    if not root:
        root = str(Path(__file__).resolve().parent.parent / 'data')
    return Path(root).resolve()


def store_for_workspace(workspace_id: str) -> Store:
    safe = ''.join(c for c in workspace_id if c.isalnum() or c in '-_')
    if not safe or safe != workspace_id:
        raise ValueError('Invalid workspace id')
    with _store_cache_lock:
        cached = _store_cache.get(workspace_id)
        if cached:
            return cached
        path = data_root() / 'workspaces' / workspace_id
        cached = Store(str(path))
        _store_cache[workspace_id] = cached
        return cached


def bind_request_store(workspace_id: str):
    return _store_ctx.set(store_for_workspace(workspace_id))


def reset_request_store(token) -> None:
    _store_ctx.reset(token)

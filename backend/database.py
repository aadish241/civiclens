"""
CivicLens Backend — Supabase Client
Provides two clients:
  - `supabase_admin`  : uses service_role key, bypasses RLS (for backend operations)
  - `supabase_public` : uses anon key, respects RLS (rarely needed server-side)
"""

from supabase import create_client, Client
from config import get_settings

_settings = get_settings()

# Admin client — bypasses RLS. Used for all backend DB operations.
supabase_admin: Client = create_client(
    _settings.supabase_url,
    _settings.supabase_service_role_key,
)

# Public client — respects RLS. Useful for testing or citizen-scoped queries.
supabase_public: Client = create_client(
    _settings.supabase_url,
    _settings.supabase_anon_key,
)

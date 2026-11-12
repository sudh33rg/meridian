-- Fix RLS policy evaluation permission on page_ydoc_updates for DELETE operations
GRANT SELECT ON page_ydoc_updates TO meridian_app;

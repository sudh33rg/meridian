-- Phase K5 (localisation). The workspace language: en (English) or es (Spanish). Dates and numbers follow it.
ALTER TABLE workspace_settings ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'es'));

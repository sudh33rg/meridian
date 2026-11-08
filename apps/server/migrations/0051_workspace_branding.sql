-- Workspace branding (Phase J5 leftover): a display name for the workspace and an accent colour.
ALTER TABLE workspace_settings ADD COLUMN brand_name text CHECK (brand_name IS NULL OR char_length(brand_name) BETWEEN 1 AND 60);
ALTER TABLE workspace_settings ADD COLUMN brand_color text CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$');

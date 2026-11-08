-- Storage accounting RPC functions for atomic increment/decrement
-- Called by Edge Functions to prevent race conditions on quota tracking

CREATE OR REPLACE FUNCTION increment_storage_usage(
  p_company_id UUID,
  p_bytes BIGINT,
  p_column TEXT DEFAULT 'photo_count'
)
RETURNS VOID AS $$
BEGIN
  UPDATE storage_usage
  SET
    total_bytes = total_bytes + p_bytes,
    file_count = file_count + 1,
    photo_count = CASE WHEN p_column = 'photo_count' THEN photo_count + 1 ELSE photo_count END,
    avatar_count = CASE WHEN p_column = 'avatar_count' THEN avatar_count + 1 ELSE avatar_count END,
    document_count = CASE WHEN p_column = 'document_count' THEN document_count + 1 ELSE document_count END,
    last_updated_at = now()
  WHERE company_id = p_company_id;

  IF NOT FOUND THEN
    INSERT INTO storage_usage (company_id, total_bytes, file_count, photo_count, avatar_count, document_count)
    VALUES (
      p_company_id,
      p_bytes,
      1,
      CASE WHEN p_column = 'photo_count' THEN 1 ELSE 0 END,
      CASE WHEN p_column = 'avatar_count' THEN 1 ELSE 0 END,
      CASE WHEN p_column = 'document_count' THEN 1 ELSE 0 END
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_storage_usage(
  p_company_id UUID,
  p_bytes BIGINT,
  p_column TEXT DEFAULT 'photo_count'
)
RETURNS VOID AS $$
BEGIN
  UPDATE storage_usage
  SET
    total_bytes = GREATEST(0, total_bytes - p_bytes),
    file_count = GREATEST(0, file_count - 1),
    photo_count = CASE WHEN p_column = 'photo_count' THEN GREATEST(0, photo_count - 1) ELSE photo_count END,
    avatar_count = CASE WHEN p_column = 'avatar_count' THEN GREATEST(0, avatar_count - 1) ELSE avatar_count END,
    document_count = CASE WHEN p_column = 'document_count' THEN GREATEST(0, document_count - 1) ELSE document_count END,
    last_updated_at = now()
  WHERE company_id = p_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

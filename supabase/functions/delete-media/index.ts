/**
 * Edge Function: delete-media
 *
 * Deletes a file from R2 and updates storage accounting.
 * Only the uploader or an owner/admin can delete.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { authenticateRequest, getServiceClient, AuthError } from '../_shared/auth.ts';
import { deleteR2Object } from '../_shared/r2.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  try {
    const auth = await authenticateRequest(req);
    const { fileKey, source } = await req.json();

    if (!fileKey) {
      return jsonError('Missing required field: fileKey', 400);
    }

    const db = getServiceClient();

    // Look up the upload log to get file size for accounting
    const { data: logEntry } = await db
      .from('upload_log')
      .select('file_size_bytes, person_id, purpose')
      .eq('file_key', fileKey)
      .eq('action', 'upload')
      .single();

    // Authorization: uploader or owner/admin
    if (logEntry && logEntry.person_id !== auth.userId) {
      if (auth.role !== 'owner' && auth.role !== 'admin') {
        return jsonError('You can only delete your own uploads', 403);
      }
    }

    // Delete from R2
    const deleted = await deleteR2Object(fileKey);
    if (!deleted) {
      return jsonError('Failed to delete file from storage', 500);
    }

    // Update storage accounting
    const fileSize = logEntry?.file_size_bytes ?? 0;
    if (fileSize > 0) {
      const purposeColumn = logEntry?.purpose === 'avatar'
        ? 'avatar_count'
        : logEntry?.purpose?.includes('photo')
          ? 'photo_count'
          : 'document_count';

      await db.rpc('decrement_storage_usage', {
        p_company_id: auth.companyId,
        p_bytes: fileSize,
        p_column: purposeColumn,
      });
    }

    // Log the deletion
    await db.from('upload_log').insert({
      company_id: auth.companyId,
      person_id: auth.userId,
      action: 'delete',
      file_key: fileKey,
      file_size_bytes: fileSize,
      purpose: logEntry?.purpose ?? 'unknown',
    });

    // Clean up references in photo tables
    if (source === 'project_photos') {
      await db.from('project_photos').delete().eq('file_key', fileKey);
    } else if (source === 'worker_photos') {
      await db.from('worker_photos').delete().eq('file_key', fileKey);
    } else if (source === 'avatar') {
      await db
        .from('people')
        .update({ avatar_url: null, avatar_file_key: null, avatar_file_size_bytes: null })
        .eq('id', logEntry?.person_id ?? auth.userId);
    }

    return jsonResponse({ success: true, freedBytes: fileSize });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error('delete-media error:', err);
    return jsonError('Internal server error', 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}

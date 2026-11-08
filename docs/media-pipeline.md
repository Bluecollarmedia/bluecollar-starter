# Photos and videos: one pipeline

Every photo and video that leaves the phone goes through the same steps. Rules live in `src/lib/mediaPlan.ts` (tested without a phone).

**Photos** are compressed before upload: JPEG at quality 0.5, long side at most 1600 px, never enlarged, orientation and aspect ratio kept
(expo-image-manipulator). A JPEG/WebP that is already small (<= 250 KB, <= 1600 px) is not recompressed; HEIC/PNG is converted. The picker
hands over the original (quality 1) so there is only one lossy step.

**Videos** are compressed to at most 854x480 (480x854 portrait), ratio kept, even sizes, 0.6 - 1.5 Mbps, audio kept, using
`react-native-compressor` 1.19.4 (added to package.json and the lockfile; the 1.x line, which supports the new architecture and does not need
Nitro; requires Node 22.11+ to install). It is a native library: **it takes effect only in a new app build** (`npm ci` then an EAS build, which
needs the owner's go-ahead), and it has not yet been run on any device. A build made without it, or a failed compression, shows a clear message and
the person chooses Retry or "Original" (uploads the large original); nothing is skipped silently. The 50 MB / 60 s limits in the pickers still
apply BEFORE compression; move them after compression once video compression has been verified on devices.

**The queue** (`src/lib/mediaQueue.ts`, phone wiring `mediaQueueRuntime.ts`) is used by project progress photos, maintenance stop photos
and task photos/videos: pick several at once, the local file is shown immediately, and each item moves Preparing -> Uploading -> Uploaded
(storage AND the database record confirmed) or Failed (Retry / Original / Remove). At most 3 run at once (1 video). Pending work is saved
in AsyncStorage and resumes after leaving a screen or restarting the app. Network trouble retries automatically (4 tries, growing delay), then shows
Failed. If the file is stored but the record fails, only the record is retried; cancelling then deletes the stored file. Double taps make one job.
Honest limits: iOS/Android can suspend the app, and uploads pause until it is opened again; an interrupted upload restarts from the
beginning; there is no upload while the app is closed.

**Not in the queue, by design:**
- Required start/finish photos for timed visits (`timePhotos.ts`): the visit step must wait for the saved photo, so they upload and save in one
  step; they are compressed by `uploadImage` like everything else.
- Snow media (`snowMedia.ts`): different storage model (stand-in object + private bucket decided by database rules, records created by
  Snow functions). Photos are compressed there too; moving Snow into the queue is a separate piece of work.
- Avatars, ID photos, truck documents, issue photos, project header, private notes: single uploads through `uploadImage` (photos compressed).

Sharing: a maintenance photo is always saved internal; compression and uploading never change who can see it.

## Private files (ID photos only)

Only `ids/...` (worker ID photos) are private. They live in a second R2 bucket with no public address (secret `R2_PRIVATE_BUCKET_NAME`,
the private bucket (e.g. `yourcompany-private`)) and are opened through short-lived signed links from the `media` function (`id-sign`: the person themself, or
the owner of a company they belong to). Everything else — maintenance, Snow reference/completion, projects, avatars, trucks, issues — is a
normal public file in the one public bucket, opened straight from its stored address. `R2_PRIVATE_BUCKET_NAME` is REQUIRED for ID photos:
without it the `media` function refuses every `ids/...` upload with a clear "ID photo storage is not set up yet" error. There is no fallback
to the public bucket, so an ID photo can never end up at a public address. Set it for every client (per-client setup list).

## R2 is required (no Supabase Storage fallback)

Every upload goes to R2 through the `media` function. A build without `EXPO_PUBLIC_R2_PUBLIC_URL` cannot save files: `uploadImage` fails with
"Photo storage is not set up" and `removeMedia` does nothing. The app never writes to the old Supabase "media" bucket any more, and update 200
closes that bucket to uploads, changes and deletes from signed-in people (listing is limited to your own company's folders).

## Who may delete a file

New company files are named `{uploaderPersonId}_{random}.{ext}`, so the `media` function knows who uploaded them. Delete is allowed for the
company's owner/admin (any file in the company folder), or for the person who uploaded that file. `avatars/{personId}/...` and
`ids/{personId}/...` can be deleted only by that person. Workers and customers can never delete other people's files.

History: maintenance and Snow photos were briefly treated as private (a second bucket + signed links). They are just pictures of properties
and work, so they were made public again on 2026-10-23. The one-time `private-migrate` tool for moving files into the private bucket was removed.
After this change, redeploy the `media` function so the server stops routing maintenance/Snow uploads to the private bucket.

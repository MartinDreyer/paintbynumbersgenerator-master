import "dotenv/config";
import { PUZZLES_BUCKET, supabase } from "./supabaseClient";
import { createThumbnail } from "./publish";

// One-time backfill for puzzles published before reference_thumbnail_storage_path
// and/or reference_width/reference_height existed: those rows have the columns'
// defaults ('' / 0) even though a reference photo already exists in storage, so the
// app has no small preview to show (a blank history/archive tile — see index.html's
// setMenuThumb, which deliberately has no fallback to the full reference image, a
// prior fallback having reproduced a real-device rendering crash) and no known aspect
// ratio to size a loading/reveal placeholder against (see .finalImageGhost/
// #menuTodayThumb). Both come from the same decode of the existing reference image,
// so one pass over any row missing either fills in whichever is missing.
async function main(): Promise<void> {
    const { data: puzzles, error } = await supabase
        .from("puzzles")
        .select("id, reference_png_storage_path, reference_thumbnail_storage_path, reference_width, reference_height")
        .or("reference_thumbnail_storage_path.eq.,reference_width.eq.0");
    if (error) throw error;

    if (!puzzles || puzzles.length === 0) {
        console.log("No puzzles missing a thumbnail or reference dimensions. Nothing to do.");
        return;
    }

    console.log(`Backfilling reference metadata for ${puzzles.length} puzzle(s)...`);

    let succeeded = 0;
    let failed = 0;

    for (const puzzle of puzzles) {
        const puzzleId = puzzle.id as string;
        const refPath = puzzle.reference_png_storage_path as string;
        const needsThumbnail = !puzzle.reference_thumbnail_storage_path;
        const needsDimensions = !puzzle.reference_width;

        if (!refPath) {
            console.error(`  [${puzzleId}] skipped: no reference image on file either`);
            failed++;
            continue;
        }

        try {
            const { data: refBlob, error: downloadError } = await supabase.storage.from(PUZZLES_BUCKET).download(refPath);
            if (downloadError) throw downloadError;

            const referenceBuffer = Buffer.from(await refBlob.arrayBuffer());
            const { buffer: thumbnailBuffer, sourceWidth, sourceHeight } = await createThumbnail(referenceBuffer);

            const update: Record<string, unknown> = {};

            if (needsThumbnail) {
                const thumbPath = `${puzzleId}/thumbnail.jpg`;
                const { error: uploadError } = await supabase.storage
                    .from(PUZZLES_BUCKET)
                    .upload(thumbPath, thumbnailBuffer, { contentType: "image/jpeg", upsert: true });
                if (uploadError) throw uploadError;
                update.reference_thumbnail_storage_path = thumbPath;
            }

            if (needsDimensions) {
                update.reference_width = sourceWidth;
                update.reference_height = sourceHeight;
            }

            const { error: updateError } = await supabase.from("puzzles").update(update).eq("id", puzzleId);
            if (updateError) throw updateError;

            console.log(`  [${puzzleId}] OK -> ${JSON.stringify(update)}`);
            succeeded++;
        } catch (err) {
            console.error(`  [${puzzleId}] FAILED:`, err instanceof Error ? err.message : err);
            failed++;
        }
    }

    console.log(`Done. ${succeeded} succeeded, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
    console.error("Backfill aborted:", err);
    process.exitCode = 1;
});

import * as canvas from "canvas";
import { PUZZLES_BUCKET, supabase } from "./supabaseClient";
import { SmkArtwork } from "./smkClient";
import { GenerateResult } from "./generate";
import { generatePaintingBlurb } from "./enrichment";
import { Settings } from "../../src/settings";

// Longest edge of the generated reference thumbnail, in px. SMK originals run up to
// several thousand px (and ~19MB); this only needs to be big enough for the app's
// history/archive grid tiles, which are a few hundred CSS px square at most.
const THUMBNAIL_MAX_DIMENSION = 320;
const THUMBNAIL_JPEG_QUALITY = 0.82;

// Also returns the source image's own pixel dimensions (reference_width/height —
// see pnb-database's puzzle_reference_dimensions migration) as a side effect of the
// decode this already has to do, rather than making callers decode the image a second
// time just to learn its aspect ratio.
export async function createThumbnail(imageBuffer: Buffer): Promise<{ buffer: Buffer; sourceWidth: number; sourceHeight: number }> {
    const img = await canvas.loadImage(imageBuffer);
    const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const c = canvas.createCanvas(width, height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, width, height);

    const buffer = c.toBuffer("image/jpeg", { quality: THUMBNAIL_JPEG_QUALITY });
    return { buffer, sourceWidth: img.width, sourceHeight: img.height };
}

/**
 * Paintings whose puzzle has actually been scheduled into rotation (i.e. shown, or
 * guaranteed to be shown, to end users). A painting that was only generated/previewed as
 * a draft and never scheduled is still fair game and won't show up here.
 */
export async function listUsedSmkObjectNumbers(): Promise<Set<string>> {
    const { data, error } = await supabase.from("paintings").select("smk_object_number").not("used_at", "is", null);
    if (error) throw error;
    return new Set((data || []).map((row) => row.smk_object_number as string));
}

export async function ensurePainting(artwork: SmkArtwork): Promise<{ id: string }> {
    const { data: existing, error: selectError } = await supabase
        .from("paintings")
        .select("id")
        .eq("smk_object_number", artwork.objectNumber)
        .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return existing;

    const { data, error } = await supabase
        .from("paintings")
        .insert({
            smk_object_number: artwork.objectNumber,
            title: artwork.title,
            artist: artwork.artist,
            production_date: artwork.productionDate,
            source_image_url: artwork.imageUrl,
            license: "public_domain",
        })
        .select("id")
        .single();
    if (error) throw error;

    // Best-effort, non-fatal: a new painting is worth enriching once, but a missing
    // ANTHROPIC_API_KEY or a failed request must never block publishing the puzzle
    // (generatePaintingBlurb already catches its own errors and returns null).
    const blurb = await generatePaintingBlurb(artwork.title, artwork.artist);
    if (blurb) {
        const { error: blurbError } = await supabase.from("paintings").update({ ai_summary: blurb }).eq("id", data.id);
        if (blurbError) console.error("Failed to save painting blurb (non-fatal):", blurbError);
    }

    return data;
}

function inferExtension(contentType: string): string {
    if (contentType.includes("png")) return "png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
    if (contentType.includes("webp")) return "webp";
    return "jpg";
}

export interface PublishPuzzleInput {
    paintingId: string;
    settings: Settings;
    generated: GenerateResult;
    referenceImage: { buffer: Buffer; contentType: string };
    status: "draft" | "published";
}

export async function publishPuzzle(
    input: PublishPuzzleInput,
): Promise<{ id: string; svgStoragePath: string; referencePngStoragePath: string; referenceThumbnailStoragePath: string }> {
    const { data: puzzleRow, error: insertError } = await supabase
        .from("puzzles")
        .insert({
            painting_id: input.paintingId,
            settings: input.settings,
            palette: input.generated.palette.map((p) => ({ num: p.index, rgb: p.color })),
            svg_storage_path: "",
            reference_png_storage_path: "",
            reference_thumbnail_storage_path: "",
            status: input.status,
        })
        .select("id")
        .single();
    if (insertError) throw insertError;

    const puzzleId = puzzleRow.id as string;
    const svgPath = `${puzzleId}/puzzle.svg`;
    const refExt = inferExtension(input.referenceImage.contentType);
    const refPath = `${puzzleId}/reference.${refExt}`;
    const thumbPath = `${puzzleId}/thumbnail.jpg`;

    const { buffer: thumbnailBuffer, sourceWidth, sourceHeight } = await createThumbnail(input.referenceImage.buffer);

    const { error: svgUploadError } = await supabase.storage
        .from(PUZZLES_BUCKET)
        .upload(svgPath, input.generated.svg, { contentType: "image/svg+xml", upsert: true });
    if (svgUploadError) throw svgUploadError;

    const { error: refUploadError } = await supabase.storage
        .from(PUZZLES_BUCKET)
        .upload(refPath, input.referenceImage.buffer, { contentType: input.referenceImage.contentType, upsert: true });
    if (refUploadError) throw refUploadError;

    const { error: thumbUploadError } = await supabase.storage
        .from(PUZZLES_BUCKET)
        .upload(thumbPath, thumbnailBuffer, { contentType: "image/jpeg", upsert: true });
    if (thumbUploadError) throw thumbUploadError;

    const { error: updateError } = await supabase
        .from("puzzles")
        .update({
            svg_storage_path: svgPath,
            reference_png_storage_path: refPath,
            reference_thumbnail_storage_path: thumbPath,
            reference_width: sourceWidth,
            reference_height: sourceHeight,
        })
        .eq("id", puzzleId);
    if (updateError) throw updateError;

    return { id: puzzleId, svgStoragePath: svgPath, referencePngStoragePath: refPath, referenceThumbnailStoragePath: thumbPath };
}

export interface ScheduleInput {
    puzzleId: string;
    paintingId: string;
    cadence: "daily" | "weekly" | "custom";
    activeFrom: string;
    activeUntil: string;
}

export async function scheduleRotation(input: ScheduleInput): Promise<{ id: string }> {
    const { data, error } = await supabase
        .from("rotation_schedule")
        .insert({
            puzzle_id: input.puzzleId,
            cadence: input.cadence,
            active_from: input.activeFrom,
            active_until: input.activeUntil,
        })
        .select("id")
        .single();
    if (error) throw error;

    // Scheduling is what actually commits a painting to being shown to end users, so
    // that's the moment it should stop being offered as a candidate for new puzzles.
    const { error: usedError } = await supabase
        .from("paintings")
        .update({ used_at: new Date().toISOString() })
        .eq("id", input.paintingId);
    if (usedError) throw usedError;

    return data;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the next rotation slot should start: right after the latest scheduled window's
 * end, or now if nothing is scheduled (or the schedule has already lapsed). Window
 * length is `cadenceDays` (7 = weekly, 1 = daily, or any other configured interval).
 * `coversNow` tells the caller whether a puzzle is currently live, so a startup/interval
 * check can skip preparing a new one when one's already showing.
 */
export async function getNextRotationWindow(cadenceDays: number): Promise<{ activeFrom: Date; activeUntil: Date; coversNow: boolean }> {
    const { data, error } = await supabase
        .from("rotation_schedule")
        .select("active_until")
        .order("active_until", { ascending: false })
        .limit(1);
    if (error) throw error;

    const now = new Date();
    const latestEnd = data && data[0] ? new Date(data[0].active_until as string) : null;
    const coversNow = latestEnd !== null && latestEnd > now;
    const activeFrom = coversNow ? (latestEnd as Date) : now;
    const activeUntil = new Date(activeFrom.getTime() + cadenceDays * DAY_MS);
    return { activeFrom, activeUntil, coversNow };
}

export async function listSchedule() {
    // Newest first: the row an admin cares most about (what's active now, what's
    // coming up next) is always near the top instead of buried below months of past
    // history — the UI itself marks each row past/active/upcoming (see app.js).
    const { data, error } = await supabase
        .from("rotation_schedule")
        .select("id, cadence, active_from, active_until, puzzles(id, status, paintings(title, artist))")
        .order("active_from", { ascending: false });
    if (error) throw error;
    return data;
}

/**
 * Every painting pulled from SMK so far, newest first, with its usage status —
 * "used" (used_at set, i.e. actually scheduled into rotation at some point) vs still
 * available as a candidate for a future puzzle.
 */
export async function listPaintings() {
    const { data, error } = await supabase
        .from("paintings")
        .select("id, title, artist, smk_object_number, used_at, fetched_at")
        .order("fetched_at", { ascending: false });
    if (error) throw error;
    return data;
}

/**
 * Puzzles that have been generated (and possibly published) but never actually put into
 * the rotation schedule — i.e. "prepared but not used yet". Drafts from the manual
 * Generate panel land here until published+scheduled, and a published-but-unscheduled
 * puzzle (published without picking a date range) would too.
 */
export async function listUnscheduledPuzzles() {
    const [{ data: scheduled, error: scheduleError }, { data: puzzles, error: puzzleError }] = await Promise.all([
        supabase.from("rotation_schedule").select("puzzle_id"),
        supabase.from("puzzles").select("id, status, created_at, paintings(title, artist)").order("created_at", { ascending: false }),
    ]);
    if (scheduleError) throw scheduleError;
    if (puzzleError) throw puzzleError;

    const scheduledIds = new Set((scheduled || []).map((row) => row.puzzle_id as string));
    return (puzzles || []).filter((p) => !scheduledIds.has(p.id as string));
}

import { PUZZLES_BUCKET, supabase } from "./supabaseClient";
import { SmkArtwork } from "./smkClient";
import { GenerateResult } from "./generate";
import { Settings } from "../../src/settings";

export async function listUsedSmkObjectNumbers(): Promise<Set<string>> {
    const { data, error } = await supabase.from("paintings").select("smk_object_number");
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

export async function publishPuzzle(input: PublishPuzzleInput): Promise<{ id: string; svgStoragePath: string; referencePngStoragePath: string }> {
    const { data: puzzleRow, error: insertError } = await supabase
        .from("puzzles")
        .insert({
            painting_id: input.paintingId,
            settings: input.settings,
            palette: input.generated.palette.map((p) => ({ num: p.index, rgb: p.color })),
            svg_storage_path: "",
            reference_png_storage_path: "",
            status: input.status,
        })
        .select("id")
        .single();
    if (insertError) throw insertError;

    const puzzleId = puzzleRow.id as string;
    const svgPath = `${puzzleId}/puzzle.svg`;
    const refExt = inferExtension(input.referenceImage.contentType);
    const refPath = `${puzzleId}/reference.${refExt}`;

    const { error: svgUploadError } = await supabase.storage
        .from(PUZZLES_BUCKET)
        .upload(svgPath, input.generated.svg, { contentType: "image/svg+xml", upsert: true });
    if (svgUploadError) throw svgUploadError;

    const { error: refUploadError } = await supabase.storage
        .from(PUZZLES_BUCKET)
        .upload(refPath, input.referenceImage.buffer, { contentType: input.referenceImage.contentType, upsert: true });
    if (refUploadError) throw refUploadError;

    const { error: updateError } = await supabase
        .from("puzzles")
        .update({ svg_storage_path: svgPath, reference_png_storage_path: refPath })
        .eq("id", puzzleId);
    if (updateError) throw updateError;

    return { id: puzzleId, svgStoragePath: svgPath, referencePngStoragePath: refPath };
}

export interface ScheduleInput {
    puzzleId: string;
    cadence: "daily" | "weekly";
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
    return data;
}

export async function listSchedule() {
    const { data, error } = await supabase
        .from("rotation_schedule")
        .select("id, cadence, active_from, active_until, puzzles(id, status, paintings(title, artist))")
        .order("active_from", { ascending: true });
    if (error) throw error;
    return data;
}

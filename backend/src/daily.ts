// Fully-automated pipeline: pick a not-yet-used SMK painting, generate its puzzle, and
// publish it straight into the next daily rotation slot. This is what "find a new one
// every day and prepare it" runs, whether triggered manually (POST /api/daily/run) or by
// the server's own interval (see server.ts) — no control-panel review step in between,
// since the goal is a self-sustaining supply of puzzles for the frontend.

import { DEFAULT_SVG_OPTIONS, generatePuzzle } from "./generate";
import { ensurePainting, getNextDailyWindow, listUsedSmkObjectNumbers, publishPuzzle, scheduleRotation } from "./publish";
import { downloadImage, pickRandomArtworks, SmkArtwork } from "./smkClient";
import { Settings } from "../../src/settings";

// Same rationale as /api/generate's default in server.ts: SMK originals can be several
// thousand px wide, and this pipeline runs unattended, so it favors a fast, bounded run
// over maximum facet detail. maximumNumberOfFacets in particular defaults to unbounded
// (Settings.maximumNumberOfFacets = Number.MAX_VALUE) and must be capped explicitly, or
// an uncapped facet count can make the border-tracing/segmenting steps take many minutes
// — the resize alone isn't enough. Values mirror the control panel UI's own defaults.
const DAILY_SETTINGS = Object.assign(new Settings(), {
    resizeImageWidth: 640,
    resizeImageHeight: 640,
    maximumNumberOfFacets: 400,
    removeFacetsSmallerThanNrOfPoints: 20,
});

export interface DailyPreparationResult {
    artwork: SmkArtwork;
    paintingId: string;
    puzzleId: string;
    scheduleId: string;
    activeFrom: string;
    activeUntil: string;
}

export async function runDailyPreparation(): Promise<DailyPreparationResult> {
    const usedObjectNumbers = await listUsedSmkObjectNumbers();
    const [artwork] = await pickRandomArtworks(usedObjectNumbers, 1);
    if (!artwork) {
        throw new Error("No unused SMK artworks found to prepare a puzzle from.");
    }

    const { buffer, contentType } = await downloadImage(artwork.imageUrl);
    const generated = await generatePuzzle(buffer, DAILY_SETTINGS, DEFAULT_SVG_OPTIONS);

    const painting = await ensurePainting(artwork);
    const puzzle = await publishPuzzle({
        paintingId: painting.id,
        settings: DAILY_SETTINGS,
        generated,
        referenceImage: { buffer, contentType },
        status: "published",
    });

    const window = await getNextDailyWindow();
    const schedule = await scheduleRotation({
        puzzleId: puzzle.id,
        paintingId: painting.id,
        cadence: "daily",
        activeFrom: window.activeFrom.toISOString(),
        activeUntil: window.activeUntil.toISOString(),
    });

    return {
        artwork,
        paintingId: painting.id,
        puzzleId: puzzle.id,
        scheduleId: schedule.id,
        activeFrom: window.activeFrom.toISOString(),
        activeUntil: window.activeUntil.toISOString(),
    };
}

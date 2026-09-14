// Fully-automated pipeline: pick a not-yet-used SMK painting, generate its puzzle, and
// publish it straight into the next rotation slot. This is what "find a new one on
// schedule and prepare it" runs, whether triggered manually (POST /api/daily/run) or by
// the server's own interval check (see server.ts) — no control-panel review step in
// between, since the goal is a self-sustaining supply of puzzles for the frontend.
//
// Cadence and generation tuning come from generator_config (see config.ts) rather than
// being hardcoded, so the admin panel's Settings section controls this end-to-end.

import { getGeneratorConfig } from "./config";
import { DEFAULT_SVG_OPTIONS, generatePuzzle } from "./generate";
import { ensurePainting, getNextRotationWindow, listUsedSmkObjectNumbers, publishPuzzle, scheduleRotation } from "./publish";
import { downloadImage, pickRandomArtworks, SmkArtwork } from "./smkClient";
import { Settings } from "../../src/settings";

function cadenceLabel(cadenceDays: number): "daily" | "weekly" | "custom" {
    if (cadenceDays === 1) return "daily";
    if (cadenceDays === 7) return "weekly";
    return "custom";
}

export interface DailyPreparationResult {
    artwork: SmkArtwork;
    paintingId: string;
    puzzleId: string;
    scheduleId: string;
    activeFrom: string;
    activeUntil: string;
}

export async function runDailyPreparation(): Promise<DailyPreparationResult> {
    const config = await getGeneratorConfig();

    // Same rationale as /api/generate's default in server.ts: SMK originals can be
    // several thousand px wide, and this pipeline runs unattended, so it favors a fast,
    // bounded run over maximum facet detail — the resize cap stays fixed (not
    // user-configurable), while color/facet/region tuning comes from generator_config.
    const settings = Object.assign(new Settings(), {
        resizeImageWidth: 640,
        resizeImageHeight: 640,
        kMeansNrOfClusters: config.nrOfColors,
        maximumNumberOfFacets: config.maxFacets,
        removeFacetsSmallerThanNrOfPoints: config.minFacetSize,
        maxFacetsPerColor: config.maxRegionsPerColor,
    });

    const usedObjectNumbers = await listUsedSmkObjectNumbers();
    const [artwork] = await pickRandomArtworks(usedObjectNumbers, 1);
    if (!artwork) {
        throw new Error("No unused SMK artworks found to prepare a puzzle from.");
    }

    const { buffer, contentType } = await downloadImage(artwork.imageUrl);
    const generated = await generatePuzzle(buffer, settings, DEFAULT_SVG_OPTIONS);

    const painting = await ensurePainting(artwork);
    const puzzle = await publishPuzzle({
        paintingId: painting.id,
        settings,
        generated,
        referenceImage: { buffer, contentType },
        status: "published",
    });

    const window = await getNextRotationWindow(config.cadenceDays);
    const schedule = await scheduleRotation({
        puzzleId: puzzle.id,
        paintingId: painting.id,
        cadence: cadenceLabel(config.cadenceDays),
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

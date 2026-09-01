import "dotenv/config";
import express from "express";
import path from "path";
import { randomUUID } from "crypto";
import { downloadImage, getPaintingByObjectNumber, searchPaintings, SmkArtwork } from "./smkClient";
import { DEFAULT_SVG_OPTIONS, GenerateResult, generatePuzzle } from "./generate";
import { ensurePainting, listSchedule, listUsedSmkObjectNumbers, publishPuzzle, scheduleRotation } from "./publish";
import { Settings } from "../../src/settings";

const app = express();
app.use(express.json({ limit: "2mb" }));
// process.cwd(), not __dirname: tsc's output nests under dist/backend/src/... (the
// common root of backend/src and the ../../src engine files it imports is the repo
// root), so an __dirname-relative path wouldn't reliably land on backend/public.
// npm scripts always run this with backend/ as cwd.
app.use(express.static(path.join(process.cwd(), "public")));

interface Generation {
    artwork: SmkArtwork;
    settings: Settings;
    generated: GenerateResult;
    referenceImage: { buffer: Buffer; contentType: string };
    createdAt: number;
}

// Local single-admin tool: an in-memory cache from generation id -> generated puzzle is
// enough to bridge "preview in the browser" -> "publish", no need for real persistence
// or multi-user session handling.
const generations = new Map<string, Generation>();

app.get("/api/smk/search", async (req, res) => {
    try {
        const q = String(req.query.q || "");
        const rows = Number(req.query.rows || 20);
        const offset = Number(req.query.offset || 0);
        const [result, used] = await Promise.all([searchPaintings(q, rows, offset), listUsedSmkObjectNumbers()]);
        res.json({
            found: result.found,
            items: result.items.map((item) => ({ ...item, alreadyUsed: used.has(item.objectNumber) })),
        });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

app.post("/api/generate", async (req, res) => {
    try {
        const objectNumber = String(req.body.objectNumber || "");
        if (!objectNumber) {
            res.status(400).json({ error: "objectNumber is required" });
            return;
        }

        const artwork = await getPaintingByObjectNumber(objectNumber);
        if (!artwork) {
            res.status(404).json({ error: `No SMK artwork found for ${objectNumber}` });
            return;
        }

        // SMK originals can be several thousand px wide; Settings' own default resize cap
        // (1024) still leaves generation taking minutes. Control-panel previews favor a
        // fast turnaround over max detail, so start from a tighter cap here and let an
        // explicit settings.resizeImageWidth/Height in the request override it.
        const settings = Object.assign(new Settings(), { resizeImageWidth: 640, resizeImageHeight: 640 }, req.body.settings || {});
        const svgOptions = Object.assign({ ...DEFAULT_SVG_OPTIONS }, req.body.svgOptions || {});

        const imageRes = await fetch(artwork.imageUrl);
        const contentType = imageRes.headers.get("content-type") || "image/jpeg";
        const buffer = await downloadImage(artwork.imageUrl);

        const generated = await generatePuzzle(buffer, settings, svgOptions);

        const generationId = randomUUID();
        generations.set(generationId, {
            artwork,
            settings,
            generated,
            referenceImage: { buffer, contentType },
            createdAt: Date.now(),
        });

        res.json({
            generationId,
            artwork,
            svg: generated.svg,
            width: generated.width,
            height: generated.height,
            palette: generated.palette,
        });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

app.post("/api/publish", async (req, res) => {
    try {
        const generationId = String(req.body.generationId || "");
        const generation = generations.get(generationId);
        if (!generation) {
            res.status(404).json({ error: "Unknown or expired generationId — generate the puzzle again." });
            return;
        }

        const status: "draft" | "published" = req.body.status === "published" ? "published" : "draft";

        const painting = await ensurePainting(generation.artwork);
        const puzzle = await publishPuzzle({
            paintingId: painting.id,
            settings: generation.settings,
            generated: generation.generated,
            referenceImage: generation.referenceImage,
            status,
        });

        let schedule = null;
        if (status === "published" && req.body.cadence && req.body.activeFrom && req.body.activeUntil) {
            schedule = await scheduleRotation({
                puzzleId: puzzle.id,
                cadence: req.body.cadence,
                activeFrom: req.body.activeFrom,
                activeUntil: req.body.activeUntil,
            });
        }

        generations.delete(generationId);
        res.json({ puzzleId: puzzle.id, schedule });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

app.get("/api/schedule", async (_req, res) => {
    try {
        res.json(await listSchedule());
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
    console.log(`Paint-by-numbers control panel: http://127.0.0.1:${port}`);
});

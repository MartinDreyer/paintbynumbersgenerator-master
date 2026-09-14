// Client for the SMK (Statens Museum for Kunst) open API: https://api.smk.dk
// Only public-domain, has-image artworks are ever surfaced — that's a hard filter,
// not just a UI hint, since these images get redistributed inside published puzzles.

const SMK_BASE_URL = process.env.SMK_API_BASE_URL || "https://api.smk.dk/api/v1";

export interface SmkArtwork {
    objectNumber: string;
    title: string;
    artist: string | null;
    productionDate: string | null;
    imageUrl: string;
    // Separate from imageUrl: image_native is a full-resolution (often 100MB+) download
    // served with Content-Disposition: attachment, which browsers won't render inline in
    // an <img> — fine for generation (which wants full res) but not for list previews.
    thumbnailUrl: string;
    imageWidth: number | null;
    imageHeight: number | null;
}

interface SmkSearchItem {
    object_number: string;
    titles?: Array<{ title: string }>;
    artist?: string[];
    production_date?: Array<{ period?: string }>;
    image_native?: string;
    image_thumbnail?: string;
    image_width?: number;
    image_height?: number;
    public_domain?: boolean;
    has_image?: boolean;
}

function mapItem(item: SmkSearchItem): SmkArtwork | null {
    const imageUrl = item.image_native || item.image_thumbnail;
    if (!imageUrl) return null;
    return {
        objectNumber: item.object_number,
        title: item.titles?.[0]?.title || "Untitled",
        artist: item.artist?.[0] || null,
        productionDate: item.production_date?.[0]?.period || null,
        imageUrl,
        thumbnailUrl: item.image_thumbnail || imageUrl,
        imageWidth: item.image_width || null,
        imageHeight: item.image_height || null,
    };
}

/** Search public-domain Danish paintings. `keys` is a free-text query (e.g. artist or title fragment). */
export async function searchPaintings(keys: string, rows = 20, offset = 0): Promise<{ found: number; items: SmkArtwork[] }> {
    const params = new URLSearchParams({
        // "*" rather than a free-text "maleri" ("painting") query — free text matched anything
        // whose description merely *mentioned* the word, pulling in studies/sketches ("Sketch
        // for the painting..."). object_names:Painting + on_display:true instead restricts to
        // paintings SMK's curators actually have hanging on a wall, which is a much better
        // proxy for "a painting visitors would recognize" than free text ever was.
        keys: keys || "*",
        filters: "[public_domain:true],[has_image:true],[creator_nationality:Danish],[object_names:Painting],[on_display:true]",
        rows: String(rows),
        offset: String(offset),
        lang: "en",
    });
    const res = await fetch(`${SMK_BASE_URL}/art/search/?${params.toString()}`);
    if (!res.ok) {
        throw new Error(`SMK search failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { found: number; items: SmkSearchItem[] };
    const items = data.items.map(mapItem).filter((x): x is SmkArtwork => x !== null);
    return { found: data.found, items };
}

export async function getPaintingByObjectNumber(objectNumber: string): Promise<SmkArtwork | null> {
    const params = new URLSearchParams({ object_number: objectNumber });
    const res = await fetch(`${SMK_BASE_URL}/art?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { items: SmkSearchItem[] };
    const item = data.items?.[0];
    return item ? mapItem(item) : null;
}

export async function downloadImage(imageUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await fetch(imageUrl);
    if (!res.ok) {
        throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
}

/**
 * Picks up to `count` distinct public-domain paintings the caller hasn't seen before
 * (`excludeObjectNumbers`), by probing random offsets into the SMK search results rather
 * than paging through everything — cheap regardless of how large the collection is.
 */
export async function pickRandomArtworks(excludeObjectNumbers: Set<string>, count: number): Promise<SmkArtwork[]> {
    const probe = await searchPaintings("*", 1, 0);
    if (probe.found === 0) return [];

    const picked: SmkArtwork[] = [];
    const pickedNumbers = new Set<string>();
    const maxAttempts = count * 8;
    for (let attempt = 0; attempt < maxAttempts && picked.length < count; attempt++) {
        const offset = Math.floor(Math.random() * probe.found);
        const { items } = await searchPaintings("*", 1, offset);
        const item = items[0];
        if (!item || excludeObjectNumbers.has(item.objectNumber) || pickedNumbers.has(item.objectNumber)) continue;
        pickedNumbers.add(item.objectNumber);
        picked.push(item);
    }
    return picked;
}

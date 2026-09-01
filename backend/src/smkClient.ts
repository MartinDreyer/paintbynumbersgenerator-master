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
        imageWidth: item.image_width || null,
        imageHeight: item.image_height || null,
    };
}

/** Search public-domain Danish paintings. `keys` is a free-text query (e.g. artist or title fragment). */
export async function searchPaintings(keys: string, rows = 20, offset = 0): Promise<{ found: number; items: SmkArtwork[] }> {
    const params = new URLSearchParams({
        keys: keys || "maleri",
        filters: "[public_domain:true],[has_image:true]",
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

export async function downloadImage(imageUrl: string): Promise<Buffer> {
    const res = await fetch(imageUrl);
    if (!res.ok) {
        throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

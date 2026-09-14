import { supabase } from "./supabaseClient";

// Mirrors the generator_config table (pnb-database migration
// 20260914073000_generator_config.sql) — a singleton row (id=1) controlling the
// automated puzzle-prep pipeline's cadence and default generation tuning.
export interface GeneratorConfig {
    enabled: boolean;
    cadenceDays: number;
    nrOfColors: number;
    maxFacets: number;
    minFacetSize: number;
    maxRegionsPerColor: number;
}

interface GeneratorConfigRow {
    enabled: boolean;
    cadence_days: number;
    nr_of_colors: number;
    max_facets: number;
    min_facet_size: number;
    max_regions_per_color: number;
}

function fromRow(row: GeneratorConfigRow): GeneratorConfig {
    return {
        enabled: row.enabled,
        cadenceDays: row.cadence_days,
        nrOfColors: row.nr_of_colors,
        maxFacets: row.max_facets,
        minFacetSize: row.min_facet_size,
        maxRegionsPerColor: row.max_regions_per_color,
    };
}

export async function getGeneratorConfig(): Promise<GeneratorConfig> {
    const { data, error } = await supabase.from("generator_config").select("*").eq("id", 1).single();
    if (error) throw error;
    return fromRow(data as GeneratorConfigRow);
}

export async function updateGeneratorConfig(partial: Partial<GeneratorConfig>): Promise<GeneratorConfig> {
    const update: Partial<GeneratorConfigRow> = { updated_at: new Date().toISOString() } as Partial<GeneratorConfigRow>;
    if (partial.enabled !== undefined) update.enabled = partial.enabled;
    if (partial.cadenceDays !== undefined) update.cadence_days = partial.cadenceDays;
    if (partial.nrOfColors !== undefined) update.nr_of_colors = partial.nrOfColors;
    if (partial.maxFacets !== undefined) update.max_facets = partial.maxFacets;
    if (partial.minFacetSize !== undefined) update.min_facet_size = partial.minFacetSize;
    if (partial.maxRegionsPerColor !== undefined) update.max_regions_per_color = partial.maxRegionsPerColor;

    const { data, error } = await supabase.from("generator_config").update(update).eq("id", 1).select("*").single();
    if (error) throw error;
    return fromRow(data as GeneratorConfigRow);
}

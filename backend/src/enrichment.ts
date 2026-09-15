// Enriches a newly-pulled painting with a short, web-researched blurb about the
// painting or its painter, shown on the puzzle's completion screen alongside an
// "AI-generated" disclaimer (pnb-app's trivia panel). Uses Claude with the web search
// tool so the blurb draws on real, current sources rather than the model's unaided
// recall.
//
// This is a nice-to-have, not a puzzle-generation dependency: without ANTHROPIC_API_KEY
// configured, or if the request fails for any reason, generatePaintingBlurb resolves to
// null and callers (see ensurePainting in publish.ts) just skip storing a blurb —
// publishing a puzzle must never fail because enrichment did.

import Anthropic from "@anthropic-ai/sdk";

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export async function generatePaintingBlurb(title: string, artist: string | null): Promise<string | null> {
    if (!client) return null;

    const subject = artist ? `"${title}" by ${artist}` : `"${title}"`;
    const prompt = `Using web search, research the painting ${subject}, held by Statens Museum for Kunst (SMK), Denmark. Write a short, engaging blurb (2-4 sentences) for a general audience about either the painting itself or its painter — an interesting historical fact, its context, or something notable about the artist. Be factual and specific rather than generic. Output ONLY the blurb text itself — no preamble, no markdown, no headers, no quotation marks around it.`;

    const tools: Anthropic.Messages.ToolUnion[] = [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }];
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

    try {
        // A server-side web-search turn can pause (stop_reason: "pause_turn") if
        // Anthropic's internal search loop hits its iteration cap; re-sending the
        // conversation resumes it automatically. Capped so a pathological case can't
        // loop forever — see shared/tool-use-concepts.md's pause_turn guidance.
        const MAX_CONTINUATIONS = 5;
        let response: Anthropic.Message | null = null;
        for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
            response = await client.messages.create({
                model: "claude-opus-5",
                max_tokens: 1024,
                tools,
                messages,
            });
            if (response.stop_reason !== "pause_turn") break;
            messages = [...messages, { role: "assistant", content: response.content }];
        }
        if (!response) return null;

        const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join(" ")
            .trim();

        return text || null;
    } catch (err) {
        console.error("Painting blurb enrichment failed (non-fatal):", err);
        return null;
    }
}

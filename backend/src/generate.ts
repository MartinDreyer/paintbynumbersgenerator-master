// In-process adaptation of ../../src-cli/main.ts's generation pipeline: same steps,
// same output shape (SVG string + palette/frequency info), but driven by an in-memory
// image buffer instead of file paths, and returning results instead of writing files.

import * as canvas from "canvas";
import { ColorReducer } from "../../src/colorreductionmanagement";
import { RGB } from "../../src/common";
import { FacetBorderSegmenter } from "../../src/facetBorderSegmenter";
import { FacetBorderTracer } from "../../src/facetBorderTracer";
import { FacetCreator } from "../../src/facetCreator";
import { FacetLabelPlacer } from "../../src/facetLabelPlacer";
import { FacetResult } from "../../src/facetmanagement";
import { FacetReducer } from "../../src/facetReducer";
import { Settings } from "../../src/settings";
import { Point } from "../../src/structs/point";

export interface SvgRenderOptions {
    svgShowLabels: boolean;
    svgFillFacets: boolean;
    svgShowBorders: boolean;
    svgSizeMultiplier: number;
    svgFontSize: number;
    svgFontColor: string;
}

export const DEFAULT_SVG_OPTIONS: SvgRenderOptions = {
    svgShowLabels: true,
    svgFillFacets: true,
    svgShowBorders: false,
    svgSizeMultiplier: 3,
    svgFontSize: 50,
    svgFontColor: "#333",
};

export interface PaletteEntry {
    index: number;
    color: RGB;
    frequency: number;
    areaPercentage: number;
    colorAlias?: string;
}

export interface GenerateResult {
    svg: string;
    width: number;
    height: number;
    palette: PaletteEntry[];
}

export async function generatePuzzle(
    imageBuffer: Buffer,
    settings: Settings,
    svgOptions: SvgRenderOptions = DEFAULT_SVG_OPTIONS,
): Promise<GenerateResult> {
    const img = await canvas.loadImage(imageBuffer);
    const c = canvas.createCanvas(img.width, img.height);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    let imgData = ctx.getImageData(0, 0, c.width, c.height);

    if (settings.resizeImageIfTooLarge && (c.width > settings.resizeImageWidth || c.height > settings.resizeImageHeight)) {
        let width = c.width;
        let height = c.height;
        if (width > settings.resizeImageWidth) {
            width = settings.resizeImageWidth;
            height = (c.height / c.width) * settings.resizeImageWidth;
        }
        if (height > settings.resizeImageHeight) {
            const newHeight = settings.resizeImageHeight;
            width = (width / height) * newHeight;
            height = newHeight;
        }

        const tempCanvas = canvas.createCanvas(width, height);
        tempCanvas.getContext("2d")!.drawImage(c, 0, 0, width, height);
        c.width = width;
        c.height = height;
        ctx.drawImage(tempCanvas, 0, 0, width, height);
        imgData = ctx.getImageData(0, 0, c.width, c.height);
    }

    const cKmeans = canvas.createCanvas(imgData.width, imgData.height);
    const ctxKmeans = cKmeans.getContext("2d")!;
    ctxKmeans.fillStyle = "white";
    ctxKmeans.fillRect(0, 0, cKmeans.width, cKmeans.height);
    const kmeansImgData = ctxKmeans.getImageData(0, 0, cKmeans.width, cKmeans.height);

    await ColorReducer.applyKMeansClustering(
        imgData as unknown as ImageData,
        kmeansImgData as unknown as ImageData,
        ctx as unknown as CanvasRenderingContext2D,
        settings,
        () => {
            ctxKmeans.putImageData(kmeansImgData, 0, 0);
        },
    );

    const colormapResult = ColorReducer.createColorMap(kmeansImgData as unknown as ImageData);

    let facetResult = new FacetResult();
    const runs = settings.narrowPixelStripCleanupRuns || 0;
    if (runs === 0) {
        facetResult = await FacetCreator.getFacets(imgData.width, imgData.height, colormapResult.imgColorIndices, () => undefined);
        await FacetReducer.reduceFacets(
            settings.removeFacetsSmallerThanNrOfPoints,
            settings.removeFacetsFromLargeToSmall,
            settings.maximumNumberOfFacets,
            colormapResult.colorsByIndex,
            facetResult,
            colormapResult.imgColorIndices,
            () => undefined,
        );
    } else {
        for (let run = 0; run < runs; run++) {
            await ColorReducer.processNarrowPixelStripCleanup(colormapResult);
            facetResult = await FacetCreator.getFacets(imgData.width, imgData.height, colormapResult.imgColorIndices, () => undefined);
            await FacetReducer.reduceFacets(
                settings.removeFacetsSmallerThanNrOfPoints,
                settings.removeFacetsFromLargeToSmall,
                settings.maximumNumberOfFacets,
                colormapResult.colorsByIndex,
                facetResult,
                colormapResult.imgColorIndices,
                () => undefined,
            );
        }
    }

    await FacetBorderTracer.buildFacetBorderPaths(facetResult, () => undefined);
    await FacetBorderSegmenter.buildFacetBorderSegments(facetResult, settings.nrOfTimesToHalveBorderSegments, () => undefined);
    await FacetLabelPlacer.buildFacetLabelBounds(facetResult, () => undefined);

    const svg = createSVG(
        facetResult,
        colormapResult.colorsByIndex,
        svgOptions.svgSizeMultiplier,
        svgOptions.svgFillFacets,
        svgOptions.svgShowBorders,
        svgOptions.svgShowLabels,
        svgOptions.svgFontSize,
        svgOptions.svgFontColor,
    );

    const colorFrequency: number[] = colormapResult.colorsByIndex.map(() => 0);
    for (const facet of facetResult.facets) {
        if (facet !== null) {
            colorFrequency[facet.color] += facet.pointCount;
        }
    }
    const colorAliasesByColor: { [key: string]: string } = {};
    for (const alias of Object.keys(settings.colorAliases)) {
        colorAliasesByColor[settings.colorAliases[alias].join(",")] = alias;
    }
    const totalFrequency = colorFrequency.reduce((sum, val) => sum + val, 0) || 1;

    const palette: PaletteEntry[] = colormapResult.colorsByIndex.map((color, index) => ({
        index,
        color,
        frequency: colorFrequency[index],
        areaPercentage: colorFrequency[index] / totalFrequency,
        colorAlias: colorAliasesByColor[color.join(",")],
    }));

    return {
        svg,
        width: svgOptions.svgSizeMultiplier * facetResult.width,
        height: svgOptions.svgSizeMultiplier * facetResult.height,
        palette,
    };
}

// Ported as-is from src-cli/main.ts's local createSVG() (not exported there).
function createSVG(
    facetResult: FacetResult,
    colorsByIndex: RGB[],
    sizeMultiplier: number,
    fill: boolean,
    stroke: boolean,
    addColorLabels: boolean,
    fontSize: number = 60,
    fontColor: string = "black",
): string {
    let svgString = "";
    const xmlns = "http://www.w3.org/2000/svg";

    const svgWidth = sizeMultiplier * facetResult.width;
    const svgHeight = sizeMultiplier * facetResult.height;
    svgString += `<?xml version="1.0" standalone="no"?><svg width="${svgWidth}" height="${svgHeight}" xmlns="${xmlns}">`;

    for (const f of facetResult.facets) {
        if (f != null && f.borderSegments.length > 0) {
            const newpath: Point[] = f.getFullPathFromBorderSegments(false);
            if (newpath[0].x !== newpath[newpath.length - 1].x || newpath[0].y !== newpath[newpath.length - 1].y) {
                newpath.push(newpath[0]);
            }

            let data = "M ";
            data += newpath[0].x * sizeMultiplier + " " + newpath[0].y * sizeMultiplier + " ";
            for (let i = 1; i < newpath.length; i++) {
                const midpointX = (newpath[i].x + newpath[i - 1].x) / 2;
                const midpointY = (newpath[i].y + newpath[i - 1].y) / 2;
                data += "Q " + midpointX * sizeMultiplier + " " + midpointY * sizeMultiplier + " " + newpath[i].x * sizeMultiplier + " " + newpath[i].y * sizeMultiplier + " ";
            }

            let svgStroke = "";
            if (stroke) {
                svgStroke = "#000";
            } else if (fill) {
                svgStroke = `rgb(${colorsByIndex[f.color][0]},${colorsByIndex[f.color][1]},${colorsByIndex[f.color][2]})`;
            }

            const svgFill = fill ? `rgb(${colorsByIndex[f.color][0]},${colorsByIndex[f.color][1]},${colorsByIndex[f.color][2]})` : "none";

            svgString += `<path data-facetId="${f.id}" d="${data}" style="fill: ${svgFill};${svgStroke !== "" ? `stroke: ${svgStroke}; stroke-width:1px` : ""}"></path>`;

            if (addColorLabels) {
                const labelOffsetX = f.labelBounds.minX * sizeMultiplier;
                const labelOffsetY = f.labelBounds.minY * sizeMultiplier;
                const labelWidth = f.labelBounds.width * sizeMultiplier;
                const labelHeight = f.labelBounds.height * sizeMultiplier;
                const nrOfDigits = (f.color + "").length;
                svgString += `<g class="label" transform="translate(${labelOffsetX},${labelOffsetY})">
                    <svg width="${labelWidth}" height="${labelHeight}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">
                        <text font-family="Tahoma" font-size="${fontSize / nrOfDigits}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color}</text>
                    </svg>
                </g>`;
            }
        }
    }

    svgString += `</svg>`;
    return svgString;
}

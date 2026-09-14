import { RGB } from "./common";

export enum ClusteringColorSpace {
    RGB = 0,
    HSL = 1,
    LAB = 2,
}

export class Settings {
    public kMeansNrOfClusters: number = 16;
    public kMeansMinDeltaDifference: number = 1;
    public kMeansClusteringColorSpace: ClusteringColorSpace = ClusteringColorSpace.RGB;

    public kMeansColorRestrictions: Array<RGB | string> = [];

    public colorAliases: { [key: string]: RGB } = {};

    public narrowPixelStripCleanupRuns: number = 3; // 3 seems like a good compromise between removing enough narrow pixel strips to convergence. This fixes e.g. https://i.imgur.com/dz4ANz1.png

    public removeFacetsSmallerThanNrOfPoints: number = 20;
    public removeFacetsFromLargeToSmall: boolean = true;
    public maximumNumberOfFacets: number = Number.MAX_VALUE;

    // Caps how many separate numbered regions may share a single palette color (e.g. so
    // one color doesn't end up covering 150 small scattered regions). 0 = unlimited.
    public maxFacetsPerColor: number = 0;

    public nrOfTimesToHalveBorderSegments: number = 2;

    public resizeImageIfTooLarge: boolean = true;
    public resizeImageWidth: number = 1024;
    public resizeImageHeight: number = 1024;

    public randomSeed: number = new Date().getTime();
}

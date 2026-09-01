# Paint by numbers generator

Generate paint-by-numbers images from any input image. The app quantizes the image down to a small palette of colors, traces the resulting regions ("facets") into smooth vector outlines, and produces a numbered, paintable SVG (or PNG/JPG) — the same kind of template you'd buy in a paint-by-numbers kit, along with a legend of which numbered facets correspond to which colors and how much of the image each color covers.

*** This project was a proof of concept for fun back in the day, it is not being actively maintained but feel free to fork and make your own changes. ***

There are two ways to use it: an interactive **web app** and a scriptable **CLI**.

## Demo

Try the web app [here](https://drake7707.github.io/paintbynumbersgenerator/index.html) — no install required.

## Web app

### How it works

1. Load an image, either by pasting one from the clipboard (Ctrl+V), browsing for a file, or picking one of the built-in example images (trivial / small / medium).
2. On the **Options** tab, tune the processing settings if needed (see below) — the defaults are a reasonable starting point.
3. Click **Process image**. Progress bars show each processing stage in order: K-means clustering, facet building, small facet pruning, border detection, border segmentation, and label placement.
4. Once processing finishes, switch between tabs to inspect each intermediate stage (quantized image, facet reduction, border tracing, border segmentation, label placement) or jump straight to the **Output** tab.
5. On the **Output** tab, toggle labels/fill/borders, adjust the SVG size multiplier and label font size/color, and preview the result and its color palette live.
6. Download the result as an SVG, a rendered PNG, or download just the color palette as a PNG.

### Options reference

- **Resize image larger than (width/height)** — if the input image exceeds these dimensions, it's downscaled to fit while keeping its aspect ratio, to keep processing fast.
- **Number of colors** — how many colors to quantize the image to via k-means clustering.
- **Cluster precision** — the delta-distance threshold at which k-means stops iterating. Higher values finish faster but may yield lower-quality clusters.
- **Random seed** — seeds the k-means starting centroids so the same input + settings always produce the same result.
- **Clustering color space** — RGB, HSL, or Lab; the color space the clustering distance is computed in.
- **Restrict clustering colors** — optionally pin the palette to specific `r,g,b` colors (one per line, `//` for comments), useful if you only have a limited set of paints on hand. Leave empty for no restriction.
- **Number of runs for narrow pixel cleanup** — narrow, single-pixel-wide strips make for unpaintable facet borders; this cleanup removes them. It's repeated for this many passes, since removing small facets can reintroduce narrow strips.
- **Remove small facets smaller than (pixels)** — discards facets below this pixel-area threshold. Lower values keep more detail but produce facets that are hard to actually paint.
- **Maximum number of facets** — if more facets remain than this cap, the smallest ones keep getting removed until the limit is met.
- **Small facet removal order** — "Largest to smallest" is slower but keeps small facets acting as anchor points so boundaries don't warp; "Smallest to largest" is faster.
- **Amount of times to halve border segment complexity** — applies Haar wavelet reduction to smooth border curves at the cost of some detail. A segment's start/end points are always preserved.
- **SVG render options** (Output tab) — show/hide numbered labels, fill facets with their color, show/hide borders, scale the SVG up (`SVG size multiplier`, useful when labels don't fit tiny facets), and set label font size/color.

## CLI version

The CLI is a self-contained Node application that runs the same conversion pipeline from the command line, for example:

```
paint-by-numbers-generator-win.exe -i input.png -o output.svg
```

Settings are read from `settings.json` next to the executable by default, or from a specific file via `-c path_to_settings.json`.

The settings file contains mostly the same options as the web version:
 - `randomSeed`: the random seed to choose the initial starting points of the k-means clustering algorithm. This ensures that the same results are generated each time.
 - `kMeansNrOfClusters`: the number of colors to quantize the image to
 - `kMeansMinDeltaDifference`: the threshold delta distance of the k-means clustering to reach before stopping. Having a bigger value will speed up the clustering but may yield suboptimal clusters. Default 1
 - `kMeansClusteringColorSpace`: the color space to apply clustering in
 - `kMeansColorRestrictions`: Specify which colors should be used. An array of rgb values (as number array) or names of colors (reference to color aliases). If no colors are specified no restrictions are applied. Useful if you only have a few colors of paint on hand.
 - `colorAliases`: map of key/values where the keys are the color names and the values are the rgb colors (as number array). You can use the color names in the color restrictions above. The names are also mentioned in the output json that tells you how much % of the area is of that specific color.
       ```
       "colorAliases": {
              "A1": [            0,            0,            0        ],
              "A2": [            255,            0,            0        ],
              "A3": [            0,            255,            0        ],
          }
        ```
 - `removeFacetsSmallerThanNrOfPoints`: removes any facets that are smaller than the given amount of pixels. Lowering the value will create more detailed results but might be much harder to actually paint due to their size.
 - `removeFacetsFromLargeToSmall` (true/false): largest to smallest will prevent boundaries from warping the shapes because the smaller facets act as border anchorpoints but can be considerably slower
 - `maximumNumberOfFacets`: if there are more facets than the given maximum number, keep removing the smallest facets until the limit is reached

 - `nrOfTimesToHalveBorderSegments`: reducing the amount of points in a border segment (using haar wavelet reduction) will smooth out the quadratic curve more but at a loss of detail. A segment (shared border with a facet) will always retain its start and end point.

 - `narrowPixelStripCleanupRuns`: narrow pixel cleanup removes strips of single pixel rows, which would make some facets have some borders segments that are way too narrow to be useful. The small facet removal can introduce new narrow pixel strips, so this is repeated in a few iterative runs.

 - `resizeImageIfTooLarge` (true/false): if true and the input image is larger than the given dimensions then it will be resized to fit but will maintain its ratio.
 - `resizeImageWidth`: width restriction
 - `resizeImageHeight`: height restriction

There are also output profiles that you can define to output the result to svg, png, jpg with specific settings, for example:
```
  "outputProfiles": [
        {
            "name": "full",
            "svgShowLabels": true,
            "svgFillFacets": true,
            "svgShowBorders": true,
            "svgSizeMultiplier": 3,
            "svgFontSize": 50,
            "svgFontColor": "#333",
            "filetype": "png"
        },
        {
            "name": "bordersLabels",
            "svgShowLabels": true,
            "svgFillFacets": false,
            "svgShowBorders": true,
            "svgSizeMultiplier": 3,
            "svgFontSize": 50,
            "svgFontColor": "#333",
            "filetype": "svg"
        },
        {
            "name": "jpgtest",
            "svgShowLabels": false,
            "svgFillFacets": true,
            "svgShowBorders": false,
            "svgSizeMultiplier": 3,
            "svgFontSize": 50,
            "svgFontColor": "#333",
            "filetype": "jpg",
            "filetypeQuality": 80
        }
    ]
```
This defines 3 output profiles. The "full" profile shows labels, fills the facets and shows the borders with a 3x size multiplier, font size weight of 50, color of #333 and output to a png image. The bordersLabels profile outputs to a svg file without filling facets and jpgtest outputs to a jpg file with jpg quality setting  of 80.

The CLI version also outputs a json file that gives more information about the palette, which colors are used and in what quantity, e.g.:
```
  ...
  {
    "areaPercentage": 0.20327615489130435,
    "color": [ 59, 36, 27 ],
    "frequency": 119689,
    "index": 0
  },
   ...
```

The CLI version is useful if you want to automate the process into your own scripts.

## Screenshots

![Screenshot](https://i.imgur.com/6uHm78x.png])

![Screenshot](https://i.imgur.com/cY9ieAy.png)


## Example output

![ExampleOutput](https://i.imgur.com/2Zuo13d.png)

![ExampleOutput2](https://i.imgur.com/SxWhOc7.png)

## Running locally

I used VSCode, which has built in typescript support. To debug it uses a tiny webserver to host the files on localhost.

To run do `npm install` to restore packages and then `npm start` to start the webserver


## Compiling the cli version

Install pkg first if you don't have it yet `npm install pkg -g`. Then in the root folder run `pkg .`. This will generate the output for linux, windows and macos.

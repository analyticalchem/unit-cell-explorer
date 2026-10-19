# Unit Cell Explorer

An interactive 3D view of the simple cubic (SC), body-centered cubic (BCC) and face-centered cubic (FCC) unit cells. Every control sits inside the 3D pane.

- **Lattice**: SC, BCC or FCC.
- **Cells**: one cell, a 2×2×2 block or a 3×3×3 block. The original cell is the centre one in 3×3×3 and the lower-front-left one in 2×2×2.
- **Clipping**: atoms shared between cells are always cut at the faces between them, so each cell shows its own share (⅛ at a cube corner, ½ on a face). The clip toggle cuts the outer atoms at the block's faces too, or leaves them whole.
- **Cell edges**: outline each cell (off by default).
- **Color by site**: corner, body-centre and face-centre atoms in different colours.
- **Layers** (FCC): close-packed layers colored A, B, C, stacked along the body diagonal. Switching between layer and site colors changes only the colors, never the view.
- **Coordination** (all views): one atom is shown whole with all its nearest neighbors (even those outside the cell), joined by spokes, over a greyed crystal; the key gives the coordination number (SC 6, BCC 8, FCC 12). Turning it on caps atom size at 50 % so the spokes show.
- **Atom size and bonds** (all views): nearest-neighbor bonds; turning bonds on sets atom size three quarters of the way to large; bonds end at the sphere surfaces and are cut at the cell faces like the atoms.
- **Blocks only**: color saturation of the cells around the original one (full color by default; lower it to grey them out) and an explode slider that pulls the cells apart. For FCC, **Split by layer** makes the explode slider pull the close-packed layers apart along the stacking direction instead (cells stay put; bonds between layers and the cell edges are hidden while the layers are apart).
- Settings carry over when you switch lattices or cell counts.
- Drag to rotate, scroll or pinch to zoom; with the view focused, arrow keys rotate, + and − zoom, Home resets.

## Model

Lattice constant a = 1. Sphere radii are the hard-sphere values at which nearest neighbors touch: SC a/2, BCC √3a/4, FCC √2a/4. Bonds join nearest neighbors at a, √3a/2 and a/√2.

## Rendering

Plain WebGL 2, no libraries. Spheres are ray-cast in the fragment shader on camera-facing squares, then clipped against their cell, described as up to four slabs (three for a parallelepiped, four for the hexagonal prism); a cut sphere shows its flat cut face exactly and depth is written per pixel. Bonds are ray-traced the same way (solid rods cut by the same slabs); cell edges are thin instanced tubes sized in screen pixels.

Atoms and bonds have a metallic finish: little diffuse light, a studio-style reflection (mid-tone floor, sharp horizon, bright band) tinted by the atom's colour, and a sharp highlight. Each atom's edge is a thin line of its own theme colour. The page fills the screen: the 3D view uses the full window width and whatever height is left, with a compact header on short screens and slightly larger controls on large screens (from 1600 × 900).

## Hexagonal close-packed (HCP): built, switched off

HCP is fully implemented but hidden from the page for now. Open the page with `?hcp=1` to see and test it.

What it does:

- c = √(8/3) a, r = a/2, nearest neighbors at a.
- Two cell shapes: the primitive rhombic cell (8 corners + 1 interior atom at (⅓, ⅔, ½)) and, with the hexagon toggle, the hexagonal prism (12 corners cut to ⅙, 2 basal face centres cut to ½, 3 whole interior atoms). Prisms tile with P1 = 2a1 + a2 and P2 = a1 + 2a2.
- Atoms start at 57 % of touching size, just small enough (r = 0.285 a against 0.289 a of clearance) that the interior atom is not cut. An untouched size slider follows this default.
- Color by site adds an orange "Interior" entry; Layers colors the A, B layers up the c axis; Split by layer separates them along c.
- Interior–interior neighbors in the same basal plane sit in different cells; they are drawn as cross-cell bonds while the cells are closed up.

Where the code lives: `hcp` and `hcpx` in `LATTICES` and `hexPrism()` in `js/model.js`; the four-slab clipping in `js/renderer.js`; the prism toggle, `buildType()` and the `L.family === 'hcp'` checks in `js/main.js`; `--atom-interior` in `css/styles.css`.

### Bringing HCP back

1. In `index.html`, remove `hidden` from every element marked `data-hcp` (the HCP chip and three help sentences), and remove the comment above the HCP chip.
2. Put HCP back into the wording that now names only the cubic lattices:
   - the `<meta name="description">` and the footer sentence,
   - the Color by site button title ("…, face-center and interior sites"),
   - the Layers button title ("A, B, C in FCC; A, B in HCP"),
   - the help sentence "Split by layer (FCC, HCP blocks)…",
   - this README's feature list and model line.
3. Optionally delete the `?hcp=1` block at the end of `js/main.js`.
4. Run the accessibility check and test HCP 1, 2×2×2 and 3×3×3 with the prism, layers, split and bonds.

## Files

`index.html` · `css/styles.css` · `js/model.js` (geometry) · `js/camera.js` (orbit camera and input) · `js/renderer.js` (WebGL) · `js/main.js` (wiring)

**Releasing an update:** `index.html` loads the stylesheet and scripts with a version tag (`?v=20261019-3`). Change all five tags to a new value with every release, so visitors' browsers fetch the new files instead of reusing cached old ones (GitHub Pages lets browsers cache files for up to 10 minutes).

Part of [analyticalchem](https://analyticalchem.github.io/).

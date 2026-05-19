"""
Pure functions for converting Sentinel-2 pixel grids to HEALPix cells.

"Pure" means these functions have no side effects and do no file I/O.
They take numpy arrays in and return numpy arrays out. This makes them
easy to test and understand in isolation.

Key concept — HEALPix NESTED scheme:
  The sky (or Earth surface) is divided into 12 * nside^2 equal-area cells.
  "NESTED" means cell numbering is spatially coherent: cell N's four children
  are cells 4*N, 4*N+1, 4*N+2, 4*N+3. This makes downsampling (÷2 steps)
  trivial: just divide the cell id by 4 to get the parent.
"""

import re
import time

import healpy as hp
import numpy as np
from pyproj import CRS, Transformer


def detect_utm_epsg(s2_product_url: str, reflectance_group: str = "r20m") -> str:
    """Figure out which UTM coordinate system a Sentinel-2 product uses.

    Sentinel-2 data is stored in UTM (Universal Transverse Mercator) coordinates
    — a metric system where x/y are in metres. Before we can map pixels to
    longitude/latitude (which HEALPix needs), we need to know which UTM zone.

    Tries two methods in order:
      1. Read the CRS metadata stored inside the zarr (most reliable).
      2. Parse the UTM zone number from the tile ID in the URL.
         e.g. '_T29SND_' → zone 29 → EPSG:32629 (UTM zone 29N).

    Returns a string like 'EPSG:32629'.
    """
    import zarr

    try:
        root = zarr.open_group(s2_product_url, mode="r", zarr_format=3)
        grp = root["measurements"]["reflectance"][reflectance_group]
        for key in ("crs", "spatial_ref"):
            if key in grp:
                attrs = dict(grp[key].attrs)
                for attr_key in ("crs_wkt", "spatial_ref"):
                    wkt = attrs.get(attr_key, "")
                    if wkt:
                        epsg = CRS.from_wkt(str(wkt)).to_epsg()
                        if epsg:
                            return f"EPSG:{epsg}"
                for attr_key in ("epsg", "EPSG"):
                    val = attrs.get(attr_key)
                    if val is not None:
                        return f"EPSG:{int(val)}"
    except Exception:
        pass  # zarr read failed — fall through to URL parsing

    # Fallback: parse UTM zone from the tile ID in the URL.
    # Sentinel-2 tile IDs: T{zone}{lat_band}{2-letter_col}, e.g. T29SND
    # Lat band A-M = southern hemisphere (EPSG:327xx), N-Z = northern (EPSG:326xx)
    m = re.search(r"_T(\d{2})([A-Z])[A-Z]{2}_", s2_product_url)
    if m:
        zone = int(m.group(1))
        hemi = "7" if m.group(2).upper() <= "M" else "6"
        return f"EPSG:32{hemi}{zone:02d}"

    raise ValueError(f"Could not determine UTM EPSG from {s2_product_url}")


def recommend_nside_from_pixel_spacing(x_utm: np.ndarray, y_utm: np.ndarray) -> int:
    """Choose a HEALPix resolution that matches the input pixel spacing.

    HEALPix resolution is set by 'nside' — a power of 2. Higher nside = finer
    grid. nside=262144 gives ~12m cells (good for 20m Sentinel-2 pixels).

    We choose the largest nside whose cell is NOT smaller than the pixel.
    Going finer would create empty cells between adjacent pixels (holes).

    For Sentinel-2 r20m data (20m pixels) this returns 262144 (= 2^18).
    """
    dx = float(np.abs(x_utm[1] - x_utm[0]))
    dy = float(np.abs(y_utm[1] - y_utm[0]))
    pixel_size_m = np.sqrt(dx * dy)

    R_EARTH = 6_371_000.0
    pixel_size_rad = pixel_size_m / R_EARTH

    # HEALPix angular resolution: θ ≈ sqrt(π/3) / nside
    # Solving for nside: nside = sqrt(π/3) / θ
    nside_exact = np.sqrt(np.pi / 3) / pixel_size_rad
    return int(2 ** np.floor(np.log2(nside_exact)))


def _cell_edges_1d(centers: np.ndarray) -> np.ndarray:
    """Given grid cell centres, compute the boundaries between them.

    Sentinel-2 stores pixel centres. To treat each pixel as a rectangle
    (for footprint resampling), we need the edges between adjacent pixels.

    For centres [10, 20, 30] with 10m spacing, edges are [5, 15, 25, 35].
    The two outer edges extend half a pixel beyond the first/last centre.
    """
    c = np.asarray(centers, dtype=np.float64)
    if len(c) == 1:
        # Single point: produce two edges with zero width (degenerate pixel).
        return np.array([c[0], c[0]], dtype=np.float64)
    d0 = c[1] - c[0]
    dn = c[-1] - c[-2]
    mid = (c[:-1] + c[1:]) / 2
    return np.concatenate([[c[0] - abs(d0) / 2], mid, [c[-1] + abs(dn) / 2]])


def _band_layout_matches_meshgrid(band: np.ndarray, len_x: int, len_y: int) -> None:
    """Raise ValueError if the band array shape is incompatible with the grid.

    Sentinel-2 zarrs can store bands as (rows, cols) = (len_y, len_x) or
    transposed as (len_x, len_y). We support both orientations.
    """
    if band.shape in ((len_x, len_y), (len_y, len_x)):
        return
    raise ValueError(
        f"Band shape {band.shape} not compatible with grid ({len_y},{len_x}) "
        f"or ({len_x},{len_y})."
    )


def _band_at_mesh_ixy(
    band: np.ndarray, len_x: int, len_y: int, i_x: np.ndarray, j_y: np.ndarray
) -> np.ndarray:
    """Extract band values at pixel indices (i_x, j_y), handling both orientations."""
    if band.shape == (len_y, len_x):
        return band[j_y, i_x]
    if band.shape == (len_x, len_y):
        return band[i_x, j_y]
    raise ValueError(f"Band shape {band.shape} incompatible with grid ({len_x},{len_y}).")


def _accumulate_weighted_chunk(
    hpx: np.ndarray,
    weights: np.ndarray,
    weighted_vals: np.ndarray,
    agg_w: dict,
    agg_v: dict,
) -> None:
    """Add one batch of (cell_id, weight, weighted_value) into running accumulators.

    agg_w[cell_id] = total weight accumulated so far for that cell.
    agg_v[cell_id] = sum of (weight × value) accumulated so far.

    To get the final weighted mean: agg_v[c] / agg_w[c].

    We sort by cell_id first so identical ids are contiguous, letting us
    reduce each group with a single np.sum rather than looping element-by-element.
    """
    if hpx.size == 0:
        return
    order = np.argsort(hpx)
    hpx = hpx[order]
    weights = weights[order]
    weighted_vals = weighted_vals[order]
    _, starts = np.unique(hpx, return_index=True)
    ends = np.append(starts[1:], len(hpx))
    for a, b in zip(starts, ends):
        cid = int(hpx[a])
        sw = float(np.sum(weights[a:b]))
        sv = np.sum(weighted_vals[a:b], axis=0)
        if cid in agg_w:
            agg_w[cid] += sw
            agg_v[cid] += sv
        else:
            agg_w[cid] = sw
            agg_v[cid] = sv.copy()


def footprint_weighted_healpix(
    x_utm: np.ndarray,
    y_utm: np.ndarray,
    utm_epsg: str,
    bands: dict,
    band_keys: list,
    nside: int,
    *,
    wgs84_epsg: str = "EPSG:4326",
    foot_subsamples: int = 4,
    pixel_batch: int = 65_536,
    progress: bool = True,
    label: str = "",
) -> tuple:
    """Convert a UTM pixel grid to HEALPix cells using footprint resampling.

    Why footprint resampling?
      At high resolution, one HEALPix cell might be smaller than one Sentinel-2
      pixel. If we just look up the cell for each pixel centre, some cells get
      no data (holes). Instead, we treat each pixel as a rectangle and place a
      K×K grid of sub-sample points inside it. Each sub-sample point is projected
      to lon/lat and mapped to a cell. The final value per cell is a weighted mean
      of all sub-samples that landed in it.

    Processing in batches:
      With a 5500×5500 pixel scene, holding all K^2 sub-samples in RAM at once
      would be 5500^2 × 16 × 8 bytes ≈ 4 GB. Instead, we process pixel_batch
      pixels at a time, accumulating results into a Python dict as we go.

    Returns:
      cell_ids : int64 numpy array, NESTED-sorted, no duplicates
      values   : float32 numpy array, shape (len(cell_ids), len(band_keys))
    """
    xx, _ = np.meshgrid(x_utm, y_utm, indexing="ij")
    nx, ny = xx.shape
    for k in band_keys:
        _band_layout_matches_meshgrid(bands[k], nx, ny)

    x_edges = _cell_edges_1d(x_utm)
    y_edges = _cell_edges_1d(y_utm)

    # Build the coordinate transformer once — creating it is expensive (~10ms).
    transformer = Transformer.from_crs(utm_epsg, wgs84_epsg, always_xy=True)

    # Build the K×K sub-sample offset grid (fractional positions 0..1 inside a pixel).
    K = int(foot_subsamples)
    t = (np.arange(K, dtype=np.float64) + 0.5) / K
    vv, uu = np.meshgrid(t, t, indexing="ij")
    uu, vv = uu.ravel(), vv.ravel()
    n_sub = K * K
    w_pt = 1.0 / n_sub  # each sub-sample contributes equal weight

    n_pix = nx * ny
    n_b = len(band_keys)
    agg_w: dict = {}
    agg_v: dict = {}

    pref = f"[{label}] " if label else ""
    n_batches = (n_pix + pixel_batch - 1) // pixel_batch
    step_report = max(1, n_batches // 20)
    t0 = time.perf_counter()

    if progress:
        print(
            f"{pref}footprint: {nx}×{ny}={n_pix:,}px  nside={nside}  K={K}  "
            f"batches={n_batches}",
            flush=True,
        )

    for bi, start in enumerate(range(0, n_pix, pixel_batch)):
        end = min(start + pixel_batch, n_pix)
        p = np.arange(start, end, dtype=np.int64)
        # Convert flat pixel index to 2D grid indices
        i_x = p // ny
        j_y = p % ny

        # Get the UTM bounding box of each pixel
        x0 = x_edges[i_x];  x1 = x_edges[i_x + 1]
        y0 = y_edges[j_y];  y1 = y_edges[j_y + 1]

        # Place K×K sub-sample points inside each pixel.
        # cx shape: (batch_size, n_sub)
        cx = x0[:, None] + uu[None, :] * (x1 - x0)[:, None]
        cy = y0[:, None] + vv[None, :] * (y1 - y0)[:, None]

        lon, lat = transformer.transform(cx.ravel(), cy.ravel())
        lon = np.asarray(lon, dtype=np.float64)
        lat = np.asarray(lat, dtype=np.float64)
        valid_coords = np.isfinite(lon) & np.isfinite(lat)

        hpx_all = hp.ang2pix(nside, lon, lat, nest=True, lonlat=True).astype(np.int64)

        # Read reflectance values for this batch of pixels
        vals = np.column_stack(
            [_band_at_mesh_ixy(bands[k], nx, ny, i_x, j_y) for k in band_keys]
        ).astype(np.float64)

        # A pixel is valid if all its bands are finite (no NaN / fill value)
        valid_pix = np.all(np.isfinite(vals), axis=1)
        # Expand pixel validity to sub-sample level
        valid_sub = np.repeat(valid_pix, n_sub)
        use = valid_coords & valid_sub

        hpx_used = hpx_all[use]
        w_flat = (np.full(end - start, w_pt).repeat(n_sub))[use]
        v_rep = (np.repeat(vals, n_sub, axis=0))[use]
        v_w = v_rep * w_flat[:, None]
        _accumulate_weighted_chunk(hpx_used, w_flat, v_w, agg_w, agg_v)

        if progress and (bi == 0 or bi + 1 == n_batches or (bi + 1) % step_report == 0):
            print(
                f"{pref}  batch {bi+1}/{n_batches} ({100*(bi+1)/n_batches:.0f}%)  "
                f"rows {end:,}/{n_pix:,}  cells={len(agg_w):,}  "
                f"{time.perf_counter()-t0:.1f}s",
                flush=True,
            )

    if not agg_w:
        return np.array([], dtype=np.int64), np.zeros((0, n_b), dtype=np.float32)

    # Sort cell ids and compute the weighted mean for each cell
    cids = np.array(sorted(agg_w), dtype=np.int64)
    w_arr = np.array([agg_w[c] for c in cids], dtype=np.float64)
    v_sum = np.stack([agg_v[c] for c in cids])
    values_out = (v_sum / w_arr[:, None]).astype(np.float32)

    if progress:
        print(
            f"{pref}done: {len(cids):,} cells in {time.perf_counter()-t0:.1f}s",
            flush=True,
        )
    return cids, values_out

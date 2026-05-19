"""
zarr I/O helpers: reading Sentinel-2 reflectance data and reading/writing
the base-level HEALPix zarr format used between pipeline steps.

What is zarr?
  zarr is a format for storing large N-dimensional arrays, similar to HDF5.
  Data is split into chunks (small pieces) that can be read/written
  independently, making it possible to read just the part you need without
  loading the entire array. Zarr v3 works well over HTTP (S3, etc.).
"""

import os
import shutil

import numpy as np
import zarr


def _band_sort_key(name: str) -> float:
    """Sort band names in numeric order: b1, b2, …, b8a, b9, b11, b12."""
    n = name.lower()
    if n == "b8a":
        return 8.5
    if n.startswith("b") and len(n) > 1:
        tail = n[1:]
        if tail.isdigit():
            return float(tail)
    return float("inf")


def reflectance_band_keys(grp: zarr.Group) -> list:
    """Return the reflectance band array names from a zarr group.

    A Sentinel-2 reflectance group contains both coordinate arrays (x, y)
    and CRS helper arrays (crs, spatial_ref) that are not spectral bands.
    This function returns only the actual 2D band arrays, sorted by band number.
    """
    skip = {"x", "y", "crs", "spatial_ref"}
    keys = []
    for k in sorted(grp.keys()):
        if k.lower() in skip:
            continue
        node = grp[k]
        if isinstance(node, zarr.Group):
            continue
        if getattr(node, "ndim", 0) == 2:
            keys.append(k)
    return sorted(keys, key=_band_sort_key)


def load_coords_only(s2_product_url: str, group: str = "r20m") -> tuple:
    """Read only the x/y UTM coordinate arrays from a Sentinel-2 product.

    Much faster than load_reflectance — reads only the 1D coordinate vectors,
    not the large 2D band arrays. Used by the orchestrator to probe the pixel
    spacing of the first URL and determine base_nside before starting workers.

    Returns:
        x_utm: 1D float64 array of x (easting) coordinates in UTM metres
        y_utm: 1D float64 array of y (northing) coordinates in UTM metres
    """
    root = zarr.open_group(s2_product_url, mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][group]
    x_utm = np.asarray(grp["x"][:], dtype=np.float64)
    y_utm = np.asarray(grp["y"][:], dtype=np.float64)
    return x_utm, y_utm


def load_reflectance(
    s2_product_url: str,
    group: str = "r20m",
    label: str = "",
) -> tuple:
    """Open a Sentinel-2 product zarr and read its reflectance bands.

    IMPORTANT: must open the product ROOT URL, not a subgroup path.
    zarr v3 HTTP stores don't support opening sub-paths directly.

    Args:
        s2_product_url: root URL of the Sentinel-2 product zarr
        group: resolution group (r10m, r20m, r60m)
        label: short name printed in progress lines (e.g. tile ID)

    Returns:
        bands:  dict of band_name → 2D numpy float32 array
        keys:   list of band names in sorted order
        x_utm:  1D float64 array of x (easting) UTM coordinates
        y_utm:  1D float64 array of y (northing) UTM coordinates
    """
    root = zarr.open_group(s2_product_url, mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][group]
    x_utm = np.asarray(grp["x"][:], dtype=np.float64)
    y_utm = np.asarray(grp["y"][:], dtype=np.float64)
    keys = reflectance_band_keys(grp)
    if not keys:
        raise ValueError(
            f"No 2D band arrays under reflectance/{group}. Keys: {list(grp.keys())}"
        )

    # Download one band at a time so the user can see progress.
    # Each band for r20m is a 5490×5490 float32 array (~115 MB).
    n = len(keys)
    bands = {}
    for i, k in enumerate(keys, 1):
        arr = grp[k]
        mb = arr.size * arr.dtype.itemsize / 1_048_576
        pfx = f"[{label}] " if label else ""
        print(f"{pfx}  downloading {k} ({i}/{n}, {mb:.0f} MB)…", flush=True)
        bands[k] = np.asarray(arr[:], dtype=np.float32)

    return bands, keys, x_utm, y_utm


def write_base_healpix_zarr(
    path: str,
    cell_ids: np.ndarray,
    values: np.ndarray,
    band_keys: list,
    base_nside: int,
    source_url: str = "",
) -> None:
    """Write a base-level HEALPix zarr store to disk.

    This format stores only the base (finest) level — just two arrays:
      cell_id: sorted NESTED HEALPix cell ids with observed data
      values:  corresponding reflectance values, one row per cell

    Downstream steps (merge, pyramid) read this format.
    If the path already exists it is deleted and recreated.
    """
    if os.path.exists(path):
        shutil.rmtree(path)

    root = zarr.open_group(path, mode="w", zarr_format=3)
    root.attrs["base_nside"] = int(base_nside)
    root.attrs["bands"] = list(band_keys)
    root.attrs["index_kind"] = "parent_offsets"
    if source_url:
        root.attrs["source"] = source_url

    n = len(cell_ids)
    chunk = min(n, 131_072) if n > 0 else 1
    root.create_array(
        "cell_id", data=np.asarray(cell_ids, dtype=np.int64), chunks=(chunk,)
    )
    root.create_array(
        "values",
        data=np.asarray(values, dtype=np.float32),
        chunks=(chunk, len(band_keys)),
    )


def get_band_keys_from_url(s2_product_url: str, group: str = "r20m") -> list:
    """Read band key names from a Sentinel-2 zarr without loading any band data.

    Used by the orchestrator to build the per-band download task graph before
    dispatching any Dask workers.
    """
    root = zarr.open_group(s2_product_url, mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][group]
    return reflectance_band_keys(grp)


def load_one_band(
    s2_product_url: str,
    group: str,
    band_key: str,
    label: str = "",
) -> np.ndarray:
    """Download a single reflectance band array from a Sentinel-2 zarr.

    Each band is an independent ~100 MB download. Splitting bands into separate
    Dask tasks lets multiple workers download different bands simultaneously,
    and shows per-band progress in the Dask dashboard.

    Returns:
        2D float32 array of reflectance values, shape (rows, cols)
    """
    root = zarr.open_group(s2_product_url, mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][group]
    arr = grp[band_key]
    mb = arr.size * arr.dtype.itemsize / 1_048_576
    pfx = f"[{label}] " if label else ""
    print(f"{pfx}  downloading {band_key} ({mb:.0f} MB)…", flush=True)
    return np.asarray(arr[:], dtype=np.float32)


def read_base_healpix_zarr(path: str) -> tuple:
    """Read a base-level HEALPix zarr (written by write_base_healpix_zarr).

    Filters out rows where the first band value is NaN — these are nodata pixels
    that can appear if the footprint resampling hits pixels outside the valid data
    area.

    Returns:
        cell_ids: int64 array, NESTED-sorted
        values:   float32 array, shape (N, bands)
        attrs:    dict of root attributes (base_nside, bands, source, …)
    """
    root = zarr.open_group(path, mode="r", zarr_format=3)
    attrs = dict(root.attrs)
    cell_ids = np.asarray(root["cell_id"][:], dtype=np.int64)
    values = np.asarray(root["values"][:], dtype=np.float32)

    if values.ndim == 2 and values.shape[1] > 0:
        finite_mask = np.isfinite(values[:, 0])
        cell_ids = cell_ids[finite_mask]
        values = values[finite_mask]

    return cell_ids, values, attrs

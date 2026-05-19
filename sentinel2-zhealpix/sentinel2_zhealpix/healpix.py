"""
Stage 2: resample a local raw zarr to a base-level HEALPix scene zarr.

Parses scene index and tile slug from the raw filename ``NNNN_<tile>.zarr``.
"""
import os
import re
import time

import numpy as np
import zarr

from .config import PipelineConfig
from .healpix_utils import detect_utm_epsg, footprint_weighted_healpix
from .zarr_utils import (
    read_base_healpix_zarr,
    reflectance_band_keys,
    write_base_healpix_zarr,
)

_RAW_FILENAME_RE = re.compile(r"^(\d{4})_(.+)\.zarr$")


def parse_raw_filename(path: str) -> tuple[int, str]:
    """Parse a raw zarr filename into (scene_index, tile_slug)."""
    base = os.path.basename(path.rstrip("/"))
    m = _RAW_FILENAME_RE.match(base)
    if not m:
        raise ValueError(
            f"Raw zarr filename {base!r} does not match expected NNNN_<tile>.zarr pattern."
        )
    return int(m.group(1)), m.group(2)


def scene_zarr_path(config: PipelineConfig, scene_index: int, tile: str) -> str:
    """Build the per-scene HEALPix zarr output path."""
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", tile)[:80]
    return os.path.join(config.scenes_dir, f"{scene_index:04d}_{safe}.zarr")


def _read_scene_attrs(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        _, _, attrs = read_base_healpix_zarr(path)
        return attrs
    except Exception:
        return None


def is_scene_done(path: str, expected_nside: int, expected_bands: list) -> bool:
    """Return True if a scene zarr exists with matching base_nside and bands."""
    attrs = _read_scene_attrs(path)
    if attrs is None:
        return False
    return attrs.get("base_nside") == expected_nside and attrs.get("bands") == list(expected_bands)


def _read_raw_bands(raw_zarr_path: str, group: str, label: str) -> tuple:
    """Open a local raw zarr and read all bands + coords. Returns bands dict, keys, x, y, epsg."""
    root = zarr.open_group(raw_zarr_path, mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][group]
    x_utm = np.asarray(grp["x"][:], dtype=np.float64)
    y_utm = np.asarray(grp["y"][:], dtype=np.float64)
    keys = reflectance_band_keys(grp)
    if not keys:
        raise ValueError(
            f"No 2D band arrays under {raw_zarr_path}/measurements/reflectance/{group}."
        )

    bands = {}
    for i, k in enumerate(keys, 1):
        arr = grp[k]
        mb = arr.size * arr.dtype.itemsize / 1_048_576
        print(f"[{label}]   reading {k} ({i}/{len(keys)}, {mb:.0f} MB)…", flush=True)
        bands[k] = np.asarray(arr[:], dtype=np.float32)

    utm_epsg = detect_utm_epsg(raw_zarr_path, reflectance_group=group)
    return bands, keys, x_utm, y_utm, utm_epsg


def healpix_one_scene(raw_zarr_path: str, config: PipelineConfig) -> str:
    """Resample one local raw zarr into a base-level HEALPix scene zarr."""
    scene_index, tile = parse_raw_filename(raw_zarr_path)
    label = tile[:56]
    out_path = scene_zarr_path(config, scene_index, tile)

    root = zarr.open_group(raw_zarr_path, mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][config.reflectance_group]
    expected_bands = reflectance_band_keys(grp)

    if is_scene_done(out_path, config.base_nside, expected_bands):
        print(f"[{label}] scene already done → {out_path}", flush=True)
        return out_path

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    t0 = time.perf_counter()

    bands, band_keys, x_utm, y_utm, utm_epsg = _read_raw_bands(
        raw_zarr_path, config.reflectance_group, label
    )

    print(
        f"[{label}] {utm_epsg}  nside={config.base_nside}  resampling…",
        flush=True,
    )
    cell_ids, values = footprint_weighted_healpix(
        x_utm,
        y_utm,
        utm_epsg,
        bands,
        band_keys,
        config.base_nside,
        wgs84_epsg="EPSG:4326",
        foot_subsamples=config.footprint_subsamples,
        pixel_batch=config.pixel_batch,
        progress=True,
        label=label,
    )

    source_url = root.attrs.get("source_url", raw_zarr_path)
    write_base_healpix_zarr(
        out_path,
        cell_ids,
        values,
        band_keys,
        config.base_nside,
        source_url=source_url,
    )
    elapsed = time.perf_counter() - t0
    print(
        f"[{label}] {len(cell_ids):,} cells → {out_path}  ({elapsed:.1f}s)",
        flush=True,
    )
    return out_path

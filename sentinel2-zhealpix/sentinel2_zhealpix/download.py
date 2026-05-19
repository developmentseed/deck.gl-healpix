"""
Stage 1: download one Sentinel-2 product into a local raw zarr.

Copies the requested measurements/reflectance/<group> subtree from the
source URL into a local zarr store. Root attrs record provenance for
skip-if-done detection.
"""
import datetime as dt
import os
import re
import shutil
import time

import numpy as np
import zarr

from .config import PipelineConfig
from .zarr_utils import reflectance_band_keys

FORMAT_VERSION = 1


def raw_zarr_path(config: PipelineConfig, scene_index: int, url: str) -> str:
    """Build the output path for a per-scene raw zarr."""
    stem = url.rstrip("/").split("/")[-1]
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:80]
    return os.path.join(config.raw_dir, f"{scene_index:04d}_{safe}.zarr")


def is_raw_done(path: str, source_url: str, group: str) -> bool:
    """Return True if a valid raw zarr exists matching source_url and group."""
    if not os.path.exists(path):
        return False
    try:
        root = zarr.open_group(path, mode="r", zarr_format=3)
        attrs = dict(root.attrs)
        if attrs.get("source_url") != source_url:
            return False
        if attrs.get("reflectance_group") != group:
            return False
        if attrs.get("format_version") != FORMAT_VERSION:
            return False
        grp = root["measurements"]["reflectance"][group]
        if "x" not in grp or "y" not in grp:
            return False
        return len(reflectance_band_keys(grp)) > 0
    except Exception:
        return False


def _copy_array(src_arr, dst_grp: zarr.Group, name: str) -> None:
    """Copy one zarr array (data + attrs + chunking hints) into dst_grp."""
    # Zarr scalars (ndim 0) reject [:]; use empty indexing like NumPy.
    if src_arr.ndim == 0:
        data = np.asarray(src_arr[()])
    else:
        data = np.asarray(src_arr[:])
    chunks = None
    try:
        ch = getattr(src_arr, "chunks", None)
        if ch is not None:
            chunks = tuple(int(c) for c in ch)
    except Exception:
        chunks = None
    new = (
        dst_grp.create_array(name, data=data, chunks=chunks)
        if chunks is not None
        else dst_grp.create_array(name, data=data)
    )
    for k, v in dict(src_arr.attrs).items():
        new.attrs[k] = v


def _copy_node(src_node, dst_parent: zarr.Group, name: str) -> None:
    """Copy a child of a reflectance group (array or nested group)."""
    ndim = getattr(src_node, "ndim", None)
    if ndim is not None:
        _copy_array(src_node, dst_parent, name)
        return
    dst_g = dst_parent.create_group(name)
    for k, v in dict(src_node.attrs).items():
        dst_g.attrs[k] = v
    for ck in sorted(src_node.keys()):
        _copy_node(src_node[ck], dst_g, ck)


def download_one_scene(url: str, scene_index: int, config: PipelineConfig) -> str:
    """Mirror one Sentinel-2 product's reflectance group to a local raw zarr."""
    out_path = raw_zarr_path(config, scene_index, url)
    label = url.rstrip("/").split("/")[-1][:56]

    if is_raw_done(out_path, source_url=url, group=config.reflectance_group):
        print(f"[{label}] raw already done → {out_path}", flush=True)
        return out_path

    if os.path.exists(out_path):
        shutil.rmtree(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    t0 = time.perf_counter()
    print(f"[{label}] downloading {config.reflectance_group}…", flush=True)

    src_root = zarr.open_group(url, mode="r", zarr_format=3)
    src_grp = src_root["measurements"]["reflectance"][config.reflectance_group]

    dst_root = zarr.open_group(out_path, mode="w", zarr_format=3)
    dst_grp = dst_root.require_group(f"measurements/reflectance/{config.reflectance_group}")

    band_count = 0
    for key in sorted(src_grp.keys()):
        node = src_grp[key]
        ndim = getattr(node, "ndim", None)
        if ndim is not None and ndim == 2:
            mb = node.size * node.dtype.itemsize / 1_048_576
            print(f"[{label}]   copying {key} ({mb:.0f} MB)…", flush=True)
            band_count += 1
        _copy_node(node, dst_grp, key)

    dst_root.attrs["source_url"] = url
    dst_root.attrs["reflectance_group"] = config.reflectance_group
    dst_root.attrs["downloaded_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    dst_root.attrs["format_version"] = FORMAT_VERSION

    elapsed = time.perf_counter() - t0
    print(
        f"[{label}] {band_count} bands → {out_path}  ({elapsed:.1f}s)",
        flush=True,
    )
    return out_path

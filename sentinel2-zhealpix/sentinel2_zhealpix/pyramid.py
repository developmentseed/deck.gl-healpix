"""
Step 3 of the pipeline: build the parent_offsets HEALPix pyramid.

What is a parent_offsets pyramid?
  Instead of storing every nside level as a dense 2D array (which would be
  enormous for nside=262144), we store only the cells that actually have data
  (sparse). For fast random access by parent cell, we include a CSR index
  (Compressed Sparse Row) called parent_offsets.

  parent_offsets[p]     = index of first child row belonging to parent p
  parent_offsets[p + 1] = index of first child row belonging to parent p+1

  So the children of parent p are rows [parent_offsets[p], parent_offsets[p+1]).
  This is O(1) lookup by parent index. The deck.gl rendering layer uses this
  to efficiently load only the tiles it needs as you zoom in/out.

How the pyramid is built:
  Starting from the base level, we repeatedly halve nside. At each step,
  we group immediate children (4 per parent — the NESTED scheme guarantees this)
  and average their values. This uses np.unique to find parent cells and
  np.bincount to sum values per parent — O(n_bands) vectorised passes, no
  Python loops over cells.
"""

import os
import shutil
import time

import numpy as np
import zarr

from .config import PipelineConfig
from .zarr_utils import read_base_healpix_zarr


def build_pyramid(merged_zarr_path: str, config: PipelineConfig) -> str:
    """Build the full parent_offsets pyramid from a merged base zarr.

    Reads the merged base (finest nside), then writes a mosaic zarr with
    one group per nside level from base_nside down to min_nside_pyramid.

    Returns the path to the written mosaic zarr.
    """
    cell_ids, values, attrs = read_base_healpix_zarr(merged_zarr_path)
    base_nside = attrs["base_nside"]
    band_keys = attrs["bands"]
    n_b = len(band_keys)

    out_path = os.path.join(config.out_dir, "mosaic.zarr")
    if os.path.exists(out_path):
        shutil.rmtree(out_path)

    root = zarr.open_group(out_path, mode="w", zarr_format=3)
    root.attrs["base_nside"] = int(base_nside)
    root.attrs["min_nside"] = int(config.min_nside_pyramid)
    root.attrs["parent_levels"] = int(config.parent_levels)
    root.attrs["bands"] = list(band_keys)
    root.attrs["index_kind"] = "parent_offsets"
    if "sources" in attrs:
        root.attrs["sources"] = attrs["sources"]
    elif "source" in attrs:
        root.attrs["source"] = attrs["source"]

    current_ids = np.asarray(cell_ids, dtype=np.int64)
    current_vals = np.asarray(values, dtype=np.float32)
    nside = int(base_nside)
    if nside < config.min_nside_pyramid:
        raise ValueError(
            f"base_nside={nside} is below min_nside_pyramid={config.min_nside_pyramid}. "
            "No pyramid levels can be written."
        )
    t0 = time.perf_counter()

    while nside >= config.min_nside_pyramid:
        # nside_parent is 2^parent_levels levels coarser.
        # cpp = children_per_parent = (nside / nside_parent)^2
        # In NESTED scheme, cell p at nside_parent contains cells
        # [p*cpp, p*cpp + 1, …, p*cpp + cpp - 1] at nside.
        nside_parent = nside // (2 ** config.parent_levels)
        if nside_parent == 0:
            raise ValueError(
                f"parent_levels={config.parent_levels} is too large for nside={nside}: "
                f"nside_parent would be 0. Reduce parent_levels or raise min_nside_pyramid."
            )
        cpp = (nside // nside_parent) ** 2
        num_parents = 12 * nside_parent ** 2

        # Build CSR parent_offsets:
        #   For each observed cell, which parent does it belong to?
        parent_of = current_ids // cpp
        counts = np.bincount(parent_of, minlength=num_parents)
        parent_offsets = np.zeros(num_parents + 1, dtype=np.int64)
        np.cumsum(counts, out=parent_offsets[1:])

        chunk_size = max(1, 4 * cpp)  # 4 "tile rows" per chunk
        grp = root.create_group(f"nside_{nside}")
        grp.attrs["nside"] = int(nside)
        grp.attrs["nside_parent"] = int(nside_parent)
        grp.attrs["children_per_parent"] = int(cpp)
        grp.attrs["num_observed_pixels"] = int(len(current_ids))
        grp.attrs["num_parents_grid"] = int(num_parents)

        grp.create_array("cell_id", data=current_ids, chunks=(chunk_size,))
        grp.create_array("values", data=current_vals, chunks=(chunk_size, n_b))
        # 4096 entries × 8 bytes = 32 KB per chunk — right size for O(1) HTTP lookup.
        # Larger chunks (e.g. 1M entries) would force loading 8 MB to read 2 values.
        po_chunk = min(num_parents + 1, 4_096)
        grp.create_array("parent_offsets", data=parent_offsets, chunks=(po_chunk,))

        print(
            f"nside={nside:>8d}  observed={len(current_ids):>12,}  "
            f"nside_parent={nside_parent:>8d}  "
            f"parent_offsets≈{parent_offsets.nbytes/1e6:.1f}MB",
            flush=True,
        )

        if nside == config.min_nside_pyramid:
            break

        # Downsample to next coarser level:
        # Group cells by immediate parent (cell_id // 4), average values.
        immediate_parent = current_ids // 4
        unique_parents, inverse = np.unique(immediate_parent, return_inverse=True)
        n_unique = len(unique_parents)
        # np.bincount with weights runs in C (fully vectorised per band).
        # Looping over bands (not cells) — O(n_bands) Python steps, each O(N) in C.
        sums = np.zeros((n_unique, n_b), dtype=np.float64)
        for b in range(n_b):
            sums[:, b] = np.bincount(
                inverse, weights=current_vals[:, b].astype(np.float64),
                minlength=n_unique,
            )
        counts_per = np.bincount(inverse, minlength=n_unique)
        current_vals = (sums / counts_per[:, None]).astype(np.float32)
        current_ids = unique_parents.astype(np.int64)
        nside //= 2

    total_bytes = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fns in os.walk(out_path) for f in fns
    )
    print(
        f"\nMosaic written → {out_path}  "
        f"({total_bytes / 1024**2:.1f} MB, {time.perf_counter()-t0:.1f}s)",
        flush=True,
    )
    return out_path

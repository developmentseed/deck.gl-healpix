"""
Step 2 of the pipeline: merge all per-scene HEALPix zarrs into one.

Why a binary tree reduction instead of a simple loop?
  A simple fold (merge scenes one at a time into a running accumulator) would
  cause the accumulator to grow until it holds ALL scenes in RAM. With 20 scenes
  of 600 MB each, that is 12 GB — too much.

  A binary tree pairs scenes up: (0,1), (2,3), … each pair is merged
  independently. Then the results are paired again. Each merge only holds two
  scenes in RAM at once (~1.2 GB), regardless of how many total scenes there are.

  The CLI (run-all or merge with --workers > 1) runs the pairs in each round in parallel
  using Dask — it passes a 'pair_executor' function that we call instead of
  running pairs sequentially.

Overlap rule: when two scenes share a cell, the left input wins.
This matches the original notebook behaviour (first file in sorted order wins).
"""

import os
import shutil
import time

import numpy as np
import zarr

from .config import PipelineConfig
from .zarr_utils import read_base_healpix_zarr, write_base_healpix_zarr


def merge_two_sorted_first_wins(
    left_ids: np.ndarray,
    left_vals: np.ndarray,
    right_ids: np.ndarray,
    right_vals: np.ndarray,
) -> tuple:
    """Merge two sorted (cell_id, values) arrays. Left input wins on duplicates.

    Both inputs must be sorted by cell_id in ascending order (which is always
    the case for our zarr outputs). The output is also sorted with no duplicates.

    How it works:
      1. Concatenate both arrays.
      2. Assign priority 0 to left rows, 1 to right rows.
      3. Sort by (cell_id, priority) — ties sort left before right.
      4. Keep only the first occurrence of each cell_id (the left one on ties).
    """
    if left_ids.size == 0:
        return right_ids.copy(), right_vals.copy()
    if right_ids.size == 0:
        return left_ids.copy(), left_vals.copy()

    n = left_ids.size + right_ids.size
    ids = np.concatenate((left_ids, right_ids))
    vals = np.concatenate((left_vals, right_vals))

    priority = np.zeros(n, dtype=np.int8)
    priority[left_ids.size:] = 1  # right = lower priority

    # np.lexsort sorts by last key first, then second-to-last, etc.
    # So (priority, ids) → sort by ids, break ties by priority (0=left wins)
    order = np.lexsort((priority, ids))
    s_ids = ids[order]
    s_vals = vals[order]

    # Keep only first occurrence of each cell_id
    mask = np.empty(s_ids.size, dtype=bool)
    mask[0] = True
    mask[1:] = s_ids[1:] != s_ids[:-1]
    return s_ids[mask], s_vals[mask]


def merge_pair_zarrs(path_a: str, path_b: str, out_path: str) -> str:
    """Read two base-level zarrs, merge them (a wins), write to out_path.

    Peak RAM ≈ 3 × (size(path_a) + size(path_b)): inputs (A+B), the concatenated
    copy created by np.concatenate, and the lexsort/indexed copies inside
    merge_two_sorted_first_wins all coexist during the merge.
    The `del` at the end frees the inputs before the write, reducing the
    post-merge footprint to approximately size(out_path).

    Returns out_path (so Dask can use this as a delayed return value).
    """
    ids_a, vals_a, attrs = read_base_healpix_zarr(path_a)
    ids_b, vals_b, _ = read_base_healpix_zarr(path_b)

    merged_ids, merged_vals = merge_two_sorted_first_wins(ids_a, vals_a, ids_b, vals_b)
    del ids_a, vals_a, ids_b, vals_b  # release before writing

    write_base_healpix_zarr(
        out_path, merged_ids, merged_vals, attrs["bands"], attrs["base_nside"]
    )
    return out_path


def merge_round_output_path(out_dir: str, round_idx: int, pair_idx: int) -> str:
    """Return the path for an intermediate merge result.

    Example: out_dir='./output', round=0, pair=1 → './output/merge/r0_p1.zarr'
    """
    return os.path.join(out_dir, "merge", f"r{round_idx}_p{pair_idx}.zarr")


def _is_valid_zarr(path: str) -> bool:
    """Return True if a zarr exists at path and has the required attributes."""
    if not os.path.exists(path):
        return False
    try:
        root = zarr.open_group(path, mode="r", zarr_format=3)
        attrs = dict(root.attrs)
        return "base_nside" in attrs and "bands" in attrs
    except Exception:
        return False


def tree_merge(
    scene_paths: list,
    config: PipelineConfig,
    pair_executor=None,
) -> str:
    """Reduce a list of per-scene zarrs to one merged base zarr.

    Uses a binary tree: each round halves the number of zarrs by merging pairs.
    Checkpointed: if a round output already exists, that pair is skipped.

    pair_executor:
      Optional callable that accepts a list of (path_a, path_b, out_path) tuples
      and executes them (potentially in parallel).
      If None, pairs are executed sequentially — useful for testing without Dask.
      cli.cmd_merge / cmd_run_all passes a Dask-based executor when --workers > 1.

    Returns the path to the final merged zarr (at {out_dir}/merged_base.zarr).
    """
    os.makedirs(os.path.join(config.out_dir, "merge"), exist_ok=True)
    if not scene_paths:
        raise ValueError("tree_merge requires at least one scene path")
    current_paths = list(scene_paths)
    round_idx = 0

    while len(current_paths) > 1:
        next_paths = []
        pending_pairs = []  # list of (path_a, path_b, out_path) to process

        for pair_idx, i in enumerate(range(0, len(current_paths), 2)):
            if i + 1 >= len(current_paths):
                # Odd number of inputs: carry the last one forward unchanged
                next_paths.append(current_paths[i])
                continue

            out_path = merge_round_output_path(config.out_dir, round_idx, pair_idx)
            if _is_valid_zarr(out_path):
                print(f"[merge] r{round_idx}_p{pair_idx} skip (exists)", flush=True)
            else:
                pending_pairs.append((current_paths[i], current_paths[i + 1], out_path))
            next_paths.append(out_path)

        if pending_pairs:
            print(
                f"[merge] round {round_idx}: {len(pending_pairs)} pair(s)…",
                flush=True,
            )
            t0 = time.perf_counter()
            if pair_executor is not None:
                pair_executor(pending_pairs)
            else:
                for path_a, path_b, out_path in pending_pairs:
                    merge_pair_zarrs(path_a, path_b, out_path)
            print(
                f"[merge] round {round_idx} done in {time.perf_counter()-t0:.1f}s",
                flush=True,
            )

        current_paths = next_paths
        round_idx += 1

    # Copy the final result to a stable path
    final_src = current_paths[0]
    final_dst = os.path.join(config.out_dir, "merged_base.zarr")
    if final_src != final_dst:
        if os.path.exists(final_dst):
            shutil.rmtree(final_dst)
        shutil.copytree(final_src, final_dst)

    return final_dst

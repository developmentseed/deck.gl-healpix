"""
All pipeline settings in one place.

A "dataclass" in Python is like a struct — it groups related values together
and generates __init__, __repr__ etc. automatically.
"""
import os
from dataclasses import dataclass


@dataclass
class PipelineConfig:
    """Settings that control every step of the pipeline.

    The CLI creates one PipelineConfig and passes it to every
    step function. This keeps function signatures clean — functions don't
    need a dozen keyword arguments each.
    """

    # --- required ---
    urls: list  # Sentinel-2 product root URLs (one per scene)
    out_dir: str  # root output directory (local disk)
    base_nside: int  # HEALPix resolution for the base level (e.g. 262144)
    #   This is resolved by the orchestrator before creating the config:
    #   if --base-nside is given on the CLI, use it; otherwise probe the
    #   first URL's pixel spacing to auto-detect it.

    # --- optional, with sensible defaults ---
    reflectance_group: str = "r20m"  # which Sentinel-2 resolution group to read
    min_nside_pyramid: int = 128     # coarsest nside level in the output pyramid
    parent_levels: int = 6           # how many doublings between nside_parent and nside
    footprint_subsamples: int = 4    # K for K×K subsamples per pixel footprint
    pixel_batch: int = 65_536        # pixels processed per loop iteration (memory knob)
    n_workers: int = 0               # Dask worker count; 0 = cpu_count() - 1

    @property
    def raw_dir(self) -> str:
        return os.path.join(self.out_dir, "raw")

    @property
    def scenes_dir(self) -> str:
        return os.path.join(self.out_dir, "scenes")

    @property
    def merge_dir(self) -> str:
        return os.path.join(self.out_dir, "merge")

    @property
    def merged_base_path(self) -> str:
        return os.path.join(self.out_dir, "merged_base.zarr")

    @property
    def mosaic_path(self) -> str:
        return os.path.join(self.out_dir, "mosaic.zarr")

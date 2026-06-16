"""Tests for PipelineConfig path-derivation properties."""
import os

from sentinel2_zhealpix.config import PipelineConfig


def _cfg(out_dir: str) -> PipelineConfig:
    return PipelineConfig(urls=[], out_dir=out_dir, base_nside=16)


def test_raw_dir_under_out_dir(tmp_path):
    cfg = _cfg(str(tmp_path))
    assert cfg.raw_dir == os.path.join(str(tmp_path), "raw")


def test_scenes_dir_under_out_dir(tmp_path):
    cfg = _cfg(str(tmp_path))
    assert cfg.scenes_dir == os.path.join(str(tmp_path), "scenes")


def test_merge_dir_under_out_dir(tmp_path):
    cfg = _cfg(str(tmp_path))
    assert cfg.merge_dir == os.path.join(str(tmp_path), "merge")


def test_merged_base_path_under_out_dir(tmp_path):
    cfg = _cfg(str(tmp_path))
    assert cfg.merged_base_path == os.path.join(str(tmp_path), "merged_base.zarr")


def test_mosaic_path_under_out_dir(tmp_path):
    cfg = _cfg(str(tmp_path))
    assert cfg.mosaic_path == os.path.join(str(tmp_path), "mosaic.zarr")

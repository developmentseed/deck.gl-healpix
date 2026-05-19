"""Tests for healpix.py."""
import os
import re

import numpy as np
import pytest
import zarr

from sentinel2_zhealpix.config import PipelineConfig
from sentinel2_zhealpix.healpix import (
    healpix_one_scene,
    is_scene_done,
    parse_raw_filename,
    scene_zarr_path,
)


def test_parse_raw_filename_round_trip():
    idx, tile = parse_raw_filename("0007_S2C_MSIL2A_T29SND.zarr")
    assert idx == 7
    assert tile == "S2C_MSIL2A_T29SND"


def test_parse_raw_filename_with_path():
    idx, tile = parse_raw_filename("/tmp/out/raw/0042_FOO.zarr")
    assert idx == 42
    assert tile == "FOO"


def test_parse_raw_filename_invalid():
    with pytest.raises(ValueError):
        parse_raw_filename("no_index_prefix.zarr")


def test_scene_zarr_path_format(tmp_path):
    cfg = PipelineConfig(urls=[], out_dir=str(tmp_path), base_nside=16)
    path = scene_zarr_path(cfg, scene_index=3, tile="S2C_MSIL2A_T29SND")
    assert "/scenes/0003_" in path
    assert path.endswith(".zarr")
    assert re.match(r"^[A-Za-z0-9._-]+$", os.path.basename(path))


def test_healpix_one_scene_writes_base_zarr(make_fake_raw_zarr, tmp_path):
    raw_path = make_fake_raw_zarr(
        name="0000_TILE",
        group="r20m",
        bands=("b02", "b03"),
        n_pixels=4,
    )
    cfg = PipelineConfig(
        urls=[],
        out_dir=str(tmp_path / "out"),
        base_nside=64,
        footprint_subsamples=2,
        pixel_batch=8,
    )

    out_path = healpix_one_scene(raw_path, config=cfg)

    assert os.path.exists(out_path)
    assert out_path.startswith(cfg.scenes_dir)
    assert "/scenes/0000_TILE" in out_path

    root = zarr.open_group(out_path, mode="r", zarr_format=3)
    assert root.attrs["base_nside"] == 64
    assert list(root.attrs["bands"]) == ["b02", "b03"]
    assert "cell_id" in root
    assert "values" in root
    cell_ids = np.asarray(root["cell_id"][:])
    assert cell_ids.dtype == np.int64
    assert len(cell_ids) > 0


def test_healpix_one_scene_skips_if_done(make_fake_raw_zarr, tmp_path):
    raw_path = make_fake_raw_zarr(
        name="0000_TILE",
        group="r20m",
        bands=("b02",),
        n_pixels=4,
    )
    cfg = PipelineConfig(
        urls=[],
        out_dir=str(tmp_path / "out"),
        base_nside=64,
        footprint_subsamples=2,
        pixel_batch=8,
    )

    out1 = healpix_one_scene(raw_path, config=cfg)
    mtime1 = os.path.getmtime(os.path.join(out1, "zarr.json"))

    out2 = healpix_one_scene(raw_path, config=cfg)
    mtime2 = os.path.getmtime(os.path.join(out2, "zarr.json"))

    assert out1 == out2
    assert mtime1 == mtime2


def test_is_scene_done_missing(tmp_path):
    assert is_scene_done(str(tmp_path / "nope.zarr"), 64, ["b02"]) is False


def test_is_scene_done_wrong_nside(make_fake_raw_zarr, tmp_path):
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr

    path = str(tmp_path / "scene.zarr")
    write_base_healpix_zarr(
        path,
        np.array([0], dtype=np.int64),
        np.array([[0.1]], dtype=np.float32),
        ["b02"],
        base_nside=128,
    )
    assert is_scene_done(path, 64, ["b02"]) is False
    assert is_scene_done(path, 128, ["b02"]) is True

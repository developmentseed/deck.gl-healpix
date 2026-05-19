"""Tests for download.py."""
import os
import re

import numpy as np
import zarr

from sentinel2_zhealpix.config import PipelineConfig
from sentinel2_zhealpix.download import (
    download_one_scene,
    is_raw_done,
    raw_zarr_path,
)


def test_raw_zarr_path_format(tmp_path):
    cfg = PipelineConfig(urls=[], out_dir=str(tmp_path), base_nside=16)
    url = "https://example.com/S2C_MSIL2A_20260329_T29SND.zarr"
    path = raw_zarr_path(cfg, scene_index=3, url=url)
    assert "/raw/0003_" in path
    assert path.endswith(".zarr")
    filename = os.path.basename(path)
    assert re.match(r"^[A-Za-z0-9._-]+$", filename)


def test_download_one_scene_writes_mirror(make_fake_s2_zarr, tmp_path):
    src = make_fake_s2_zarr(name="src", group="r20m", bands=("b02", "b03"))
    cfg = PipelineConfig(urls=[src], out_dir=str(tmp_path / "out"), base_nside=16)

    out_path = download_one_scene(src, scene_index=0, config=cfg)

    assert os.path.exists(out_path)
    assert out_path.startswith(cfg.raw_dir)

    root = zarr.open_group(out_path, mode="r", zarr_format=3)
    assert root.attrs["source_url"] == src
    assert root.attrs["reflectance_group"] == "r20m"
    assert root.attrs["format_version"] == 1
    assert "downloaded_at" in root.attrs

    grp = root["measurements"]["reflectance"]["r20m"]
    assert "x" in grp
    assert "y" in grp
    assert "crs" in grp
    assert "scalar_meta" in grp
    assert grp["scalar_meta"].ndim == 0
    assert int(np.asarray(grp["scalar_meta"][()])) == 1
    assert "b02" in grp
    assert "b03" in grp


def test_download_one_scene_skips_if_done(make_fake_s2_zarr, tmp_path):
    src = make_fake_s2_zarr(name="src", group="r20m", bands=("b02",))
    cfg = PipelineConfig(urls=[src], out_dir=str(tmp_path / "out"), base_nside=16)

    out1 = download_one_scene(src, scene_index=0, config=cfg)
    mtime1 = os.path.getmtime(os.path.join(out1, "zarr.json"))

    out2 = download_one_scene(src, scene_index=0, config=cfg)
    mtime2 = os.path.getmtime(os.path.join(out2, "zarr.json"))

    assert out1 == out2
    assert mtime1 == mtime2


def test_is_raw_done_missing(tmp_path):
    assert is_raw_done(str(tmp_path / "nope.zarr"), source_url="x", group="r20m") is False


def test_is_raw_done_valid(make_fake_raw_zarr):
    path = make_fake_raw_zarr(name="0000_TEST", group="r20m", bands=("b02",))
    root = zarr.open_group(path, mode="r", zarr_format=3)
    src_url = root.attrs["source_url"]
    assert is_raw_done(path, source_url=src_url, group="r20m") is True


def test_is_raw_done_wrong_group(make_fake_raw_zarr):
    path = make_fake_raw_zarr(name="0000_TEST", group="r20m", bands=("b02",))
    root = zarr.open_group(path, mode="r", zarr_format=3)
    assert is_raw_done(path, source_url=root.attrs["source_url"], group="r60m") is False


def test_is_raw_done_wrong_source(make_fake_raw_zarr):
    path = make_fake_raw_zarr(name="0000_TEST", group="r20m", bands=("b02",))
    assert is_raw_done(path, source_url="https://other.example/foo.zarr", group="r20m") is False

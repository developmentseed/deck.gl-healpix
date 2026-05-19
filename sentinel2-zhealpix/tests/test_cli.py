"""Smoke tests for the unified sentinel2_zhealpix CLI."""
import os
import subprocess
import sys

import numpy as np


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "sentinel2_zhealpix", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_top_level_help():
    r = _run("--help")
    assert r.returncode == 0
    out = r.stdout + r.stderr
    for sub in ("download", "healpix", "merge", "pyramid", "run-all"):
        assert sub in out


def test_download_help():
    r = _run("download", "--help")
    assert r.returncode == 0
    out = r.stdout + r.stderr
    assert "--urls" in out
    assert "--out-dir" in out
    assert "--reflectance-group" in out
    assert "--workers" in out


def test_healpix_help():
    r = _run("healpix", "--help")
    assert r.returncode == 0
    out = r.stdout + r.stderr
    assert "--out-dir" in out
    assert "--raw-dir" in out
    assert "--base-nside" in out
    assert "--subsamples" in out
    assert "--workers" in out


def test_merge_help():
    r = _run("merge", "--help")
    assert r.returncode == 0
    out = r.stdout + r.stderr
    assert "--out-dir" in out
    assert "--scenes-dir" in out
    assert "--workers" in out


def test_pyramid_help():
    r = _run("pyramid", "--help")
    assert r.returncode == 0
    out = r.stdout + r.stderr
    assert "--out-dir" in out
    assert "--merged-base" in out
    assert "--min-nside" in out
    assert "--parent-levels" in out


def test_run_all_help():
    r = _run("run-all", "--help")
    assert r.returncode == 0
    out = r.stdout + r.stderr
    for flag in (
        "--urls",
        "--out-dir",
        "--workers",
        "--reflectance-group",
        "--base-nside",
        "--subsamples",
        "--min-nside",
        "--parent-levels",
    ):
        assert flag in out


def test_run_all_listed_in_top_level_help():
    r = _run("--help")
    assert r.returncode == 0
    assert "run-all" in (r.stdout + r.stderr)


def test_no_subcommand_exits_nonzero():
    r = _run()
    assert r.returncode != 0


def test_healpix_missing_raw_dir_exits(tmp_path):
    r = _run("healpix", "--out-dir", str(tmp_path))
    assert r.returncode != 0
    assert "raw" in (r.stdout + r.stderr).lower()


def test_merge_missing_scenes_dir_exits(tmp_path):
    r = _run("merge", "--out-dir", str(tmp_path))
    assert r.returncode != 0
    assert "scene" in (r.stdout + r.stderr).lower()


def test_pyramid_missing_merged_base_exits(tmp_path):
    r = _run("pyramid", "--out-dir", str(tmp_path))
    assert r.returncode != 0
    assert "merged" in (r.stdout + r.stderr).lower()


def test_run_all_requires_urls():
    r = _run("run-all", "--out-dir", "/tmp/whatever")
    assert r.returncode != 0
    assert "--urls" in (r.stdout + r.stderr) or "required" in (r.stdout + r.stderr).lower()


def test_healpix_raw_dir_override_reads_from_custom_dir(make_fake_raw_zarr, tmp_path):
    raw_path = make_fake_raw_zarr(name="0000_TILE", group="r20m", bands=("b02",), n_pixels=4)
    custom_raw_dir = os.path.dirname(raw_path)
    out_dir = tmp_path / "out"

    r = _run(
        "healpix",
        "--out-dir",
        str(out_dir),
        "--raw-dir",
        custom_raw_dir,
        "--base-nside",
        "64",
        "--subsamples",
        "2",
        "--workers",
        "1",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert (out_dir / "scenes").exists()
    assert any((out_dir / "scenes").glob("0000_*.zarr"))


def test_merge_scenes_dir_override_reads_from_custom_dir(tmp_path):
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr

    custom_scenes_dir = tmp_path / "custom_scenes"
    custom_scenes_dir.mkdir()
    for i in range(2):
        write_base_healpix_zarr(
            str(custom_scenes_dir / f"{i:04d}_TILE.zarr"),
            np.array([i, i + 10], dtype=np.int64),
            np.array([[float(i)], [float(i) + 0.5]], dtype=np.float32),
            ["b02"],
            base_nside=16,
        )

    out_dir = tmp_path / "out"
    r = _run(
        "merge",
        "--out-dir",
        str(out_dir),
        "--scenes-dir",
        str(custom_scenes_dir),
        "--workers",
        "1",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert (out_dir / "merged_base.zarr").exists()


def test_pyramid_merged_base_override_reads_custom_path(tmp_path):
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr

    merged_path = tmp_path / "custom_merged.zarr"
    write_base_healpix_zarr(
        str(merged_path),
        np.array([0, 1, 2, 3], dtype=np.int64),
        np.array([[0.1], [0.2], [0.3], [0.4]], dtype=np.float32),
        ["b02"],
        base_nside=16,
    )

    out_dir = tmp_path / "out"
    out_dir.mkdir()
    r = _run(
        "pyramid",
        "--out-dir",
        str(out_dir),
        "--merged-base",
        str(merged_path),
        "--min-nside",
        "8",
        "--parent-levels",
        "1",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert (out_dir / "mosaic.zarr").exists()


def test_run_all_end_to_end_workers_1(make_fake_s2_zarr, tmp_path):
    src = make_fake_s2_zarr(name="src", group="r20m", bands=("b02", "b03"), n_pixels=4)
    out_dir = tmp_path / "out"

    r = _run(
        "run-all",
        "--urls",
        src,
        "--out-dir",
        str(out_dir),
        "--reflectance-group",
        "r20m",
        "--base-nside",
        "64",
        "--subsamples",
        "2",
        "--min-nside",
        "32",
        "--parent-levels",
        "1",
        "--workers",
        "1",
    )
    assert r.returncode == 0, r.stdout + r.stderr

    assert (out_dir / "raw").exists()
    assert any((out_dir / "raw").glob("0000_*.zarr"))
    assert any((out_dir / "scenes").glob("0000_*.zarr"))
    assert (out_dir / "merged_base.zarr").exists()
    assert (out_dir / "mosaic.zarr").exists()


def test_run_all_skips_when_outputs_exist(make_fake_s2_zarr, tmp_path):
    src = make_fake_s2_zarr(name="src", group="r20m", bands=("b02",), n_pixels=4)
    out_dir = tmp_path / "out"
    cli_args = [
        "run-all",
        "--urls",
        src,
        "--out-dir",
        str(out_dir),
        "--reflectance-group",
        "r20m",
        "--base-nside",
        "64",
        "--subsamples",
        "2",
        "--min-nside",
        "32",
        "--parent-levels",
        "1",
        "--workers",
        "1",
    ]
    assert _run(*cli_args).returncode == 0
    r2 = _run(*cli_args)
    assert r2.returncode == 0
    out = r2.stdout + r2.stderr
    assert "skipping" in out.lower() or "already" in out.lower()

"""Shared pytest fixtures for the sentinel2-zhealpix test suite."""
import datetime as dt

import numpy as np
import pytest
import zarr
from pyproj import CRS


def _write_reflectance_group(grp, n_pixels: int, band_keys: tuple[str, ...]) -> None:
    """Populate a reflectance group with x, y, crs, and band arrays."""
    x = np.linspace(500_000.0, 510_000.0, n_pixels, dtype=np.float64)
    y = np.linspace(4_400_000.0, 4_390_000.0, n_pixels, dtype=np.float64)
    grp.create_array("x", data=x, chunks=(n_pixels,))
    grp.create_array("y", data=y, chunks=(n_pixels,))

    crs_grp = grp.create_group("crs")
    crs_grp.attrs["crs_wkt"] = CRS.from_epsg(32629).to_wkt()
    crs_grp.attrs["epsg"] = 32629

    # Sentinel-2 products may include 0-D metadata arrays; download must mirror them.
    grp.create_array("scalar_meta", data=np.array(np.uint8(1), dtype=np.uint8))

    rng = np.random.default_rng(seed=42)
    for band in band_keys:
        data = rng.random((n_pixels, n_pixels), dtype=np.float32)
        grp.create_array(band, data=data, chunks=(n_pixels, n_pixels))


@pytest.fixture
def make_fake_s2_zarr(tmp_path):
    """Factory: build a fake Sentinel-2 product zarr."""

    def _factory(
        name: str = "source",
        group: str = "r20m",
        bands: tuple[str, ...] = ("b02", "b03", "b04"),
        n_pixels: int = 8,
    ) -> str:
        path = str(tmp_path / f"{name}.zarr")
        root = zarr.open_group(path, mode="w", zarr_format=3)
        grp = root.require_group(f"measurements/reflectance/{group}")
        _write_reflectance_group(grp, n_pixels, bands)
        return path

    return _factory


@pytest.fixture
def make_fake_raw_zarr(tmp_path):
    """Factory: build a fake raw zarr (download-stage output)."""

    def _factory(
        name: str = "0000_TILE",
        group: str = "r20m",
        bands: tuple[str, ...] = ("b02", "b03", "b04"),
        n_pixels: int = 8,
        source_url: str = "file:///fake/source.zarr",
    ) -> str:
        raw_dir = tmp_path / "raw"
        raw_dir.mkdir(exist_ok=True)
        path = str(raw_dir / f"{name}.zarr")
        root = zarr.open_group(path, mode="w", zarr_format=3)
        root.attrs["source_url"] = source_url
        root.attrs["reflectance_group"] = group
        root.attrs["downloaded_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        root.attrs["format_version"] = 1
        grp = root.require_group(f"measurements/reflectance/{group}")
        _write_reflectance_group(grp, n_pixels, bands)
        return path

    return _factory

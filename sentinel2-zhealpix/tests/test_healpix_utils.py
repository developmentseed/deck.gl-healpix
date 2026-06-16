"""
Tests for healpix_utils.py.

We use synthetic numpy arrays instead of real satellite data so tests
run in milliseconds and don't need a network connection.
"""
import numpy as np
import pytest


def test_recommend_nside_from_pixel_spacing_20m():
    """20m pixels → nside should be 262144 (2^18)."""
    from sentinel2_zhealpix.healpix_utils import recommend_nside_from_pixel_spacing

    x_utm = np.arange(10, dtype=np.float64) * 20.0   # 10 points, 20m apart
    y_utm = np.arange(10, dtype=np.float64) * 20.0
    nside = recommend_nside_from_pixel_spacing(x_utm, y_utm)
    assert nside == 262144


def test_recommend_nside_from_pixel_spacing_2000m():
    """2000m pixels → nside should be 2048 (2^11)."""
    from sentinel2_zhealpix.healpix_utils import recommend_nside_from_pixel_spacing

    x_utm = np.arange(10, dtype=np.float64) * 2000.0
    y_utm = np.arange(10, dtype=np.float64) * 2000.0
    nside = recommend_nside_from_pixel_spacing(x_utm, y_utm)
    assert nside == 2048


def test_cell_edges_1d_basic():
    """[10, 20, 30] → edges [5, 15, 25, 35]."""
    from sentinel2_zhealpix.healpix_utils import _cell_edges_1d

    centers = np.array([10.0, 20.0, 30.0])
    edges = _cell_edges_1d(centers)
    assert edges.shape == (4,)
    np.testing.assert_allclose(edges, [5.0, 15.0, 25.0, 35.0])


def test_cell_edges_1d_two_points():
    """Two centres with 10m spacing → three edges."""
    from sentinel2_zhealpix.healpix_utils import _cell_edges_1d

    centers = np.array([0.0, 10.0])
    edges = _cell_edges_1d(centers)
    assert edges.shape == (3,)
    np.testing.assert_allclose(edges, [-5.0, 5.0, 15.0])


def test_detect_utm_epsg_from_url():
    """URL with tile id _T29SND_ → EPSG:32629."""
    from sentinel2_zhealpix.healpix_utils import detect_utm_epsg

    url = "https://example.com/S2C_MSIL2A_20260329_T29SND_foo.zarr"
    epsg = detect_utm_epsg(url)
    assert epsg == "EPSG:32629"


def test_detect_utm_epsg_zone_1():
    """UTM zone 1, lat band A (southern) → EPSG:32701."""
    from sentinel2_zhealpix.healpix_utils import detect_utm_epsg

    url = "https://example.com/S2_T01AAA_foo.zarr"
    epsg = detect_utm_epsg(url)
    assert epsg == "EPSG:32701"


def test_footprint_weighted_healpix_returns_sorted_cells():
    """
    Run footprint resampling on a tiny 4×4 grid at coarse nside=64.

    At nside=64 each HEALPix cell is ~55 arcmin wide (~100 km).
    A 4×4 grid of 100m pixels in Portugal will all fall in the same cell.
    We just check: output is non-empty, cell_ids are sorted, values are finite.
    """
    from sentinel2_zhealpix.healpix_utils import footprint_weighted_healpix

    # 4×4 grid, 100m spacing, UTM zone 29N (central Portugal)
    x_utm = np.linspace(400_000.0, 400_300.0, 4)
    y_utm = np.linspace(4_000_000.0, 4_000_300.0, 4)
    bands = {
        "b02": np.full((4, 4), 0.05, dtype=np.float32),
        "b03": np.full((4, 4), 0.07, dtype=np.float32),
    }
    band_keys = ["b02", "b03"]

    cell_ids, values = footprint_weighted_healpix(
        x_utm, y_utm, "EPSG:32629", bands, band_keys, nside=64,
        wgs84_epsg="EPSG:4326", foot_subsamples=2, pixel_batch=8, progress=False,
    )

    assert cell_ids.dtype == np.int64
    assert values.dtype == np.float32
    assert cell_ids.shape[0] > 0, "Expected at least one cell"
    assert values.shape == (cell_ids.shape[0], 2)
    assert np.all(cell_ids[1:] > cell_ids[:-1]), "cell_ids must be strictly ascending"
    assert np.all(np.isfinite(values))


def test_footprint_weighted_healpix_weighted_mean():
    """
    Two pixels with different values mapping to the same cell → output is their mean.

    We use nside=1 (only 12 cells on the whole sphere) so both pixels definitely
    land in the same cell.
    """
    from sentinel2_zhealpix.healpix_utils import footprint_weighted_healpix

    x_utm = np.array([400_000.0, 400_100.0])
    y_utm = np.array([4_000_000.0])
    bands = {"b02": np.array([[0.1, 0.3]], dtype=np.float32)}  # shape (1, 2) → (ny=1, nx=2)
    band_keys = ["b02"]

    cell_ids, values = footprint_weighted_healpix(
        x_utm, y_utm, "EPSG:32629", bands, band_keys, nside=1,
        wgs84_epsg="EPSG:4326", foot_subsamples=1, pixel_batch=4, progress=False,
    )

    assert len(cell_ids) > 0
    # All values should be between 0.1 and 0.3 (weighted mean of both pixels)
    assert np.all(values >= 0.09) and np.all(values <= 0.31)

"""
Tests for zarr_utils.py.

We create small in-memory zarr stores to test read/write without network access.
pytest's `tmp_path` fixture gives us a temporary directory that is cleaned up
automatically after each test.
"""
import numpy as np
import pytest
import zarr


def test_write_read_base_healpix_zarr_round_trip(tmp_path):
    """Write a base zarr, read it back, verify arrays and attrs are preserved."""
    from sentinel2_zhealpix.zarr_utils import (
        write_base_healpix_zarr,
        read_base_healpix_zarr,
    )

    cell_ids = np.array([0, 5, 100, 200], dtype=np.int64)
    values = np.array([[0.1, 0.2], [0.3, 0.4], [0.5, 0.6], [0.7, 0.8]], dtype=np.float32)
    band_keys = ["b02", "b03"]
    out_path = str(tmp_path / "test.zarr")

    write_base_healpix_zarr(out_path, cell_ids, values, band_keys, base_nside=256)

    read_ids, read_vals, attrs = read_base_healpix_zarr(out_path)

    np.testing.assert_array_equal(read_ids, cell_ids)
    np.testing.assert_allclose(read_vals, values)
    assert attrs["base_nside"] == 256
    assert attrs["bands"] == ["b02", "b03"]


def test_write_base_healpix_zarr_overwrites_existing(tmp_path):
    """Writing to an existing path should delete the old data and write fresh."""
    from sentinel2_zhealpix.zarr_utils import (
        write_base_healpix_zarr,
        read_base_healpix_zarr,
    )

    path = str(tmp_path / "overwrite.zarr")
    ids1 = np.array([1, 2, 3], dtype=np.int64)
    vals1 = np.ones((3, 1), dtype=np.float32)
    write_base_healpix_zarr(path, ids1, vals1, ["b02"], base_nside=64)

    ids2 = np.array([10, 20], dtype=np.int64)
    vals2 = np.zeros((2, 1), dtype=np.float32) + 0.5
    write_base_healpix_zarr(path, ids2, vals2, ["b02"], base_nside=64)

    read_ids, _, _ = read_base_healpix_zarr(path)
    np.testing.assert_array_equal(read_ids, ids2)


def test_read_base_healpix_zarr_filters_nan(tmp_path):
    """Rows where values[0] is NaN should be filtered out on read."""
    from sentinel2_zhealpix.zarr_utils import (
        write_base_healpix_zarr,
        read_base_healpix_zarr,
    )

    path = str(tmp_path / "nan.zarr")
    cell_ids = np.array([0, 1, 2], dtype=np.int64)
    values = np.array([[0.1, 0.2], [np.nan, np.nan], [0.5, 0.6]], dtype=np.float32)
    write_base_healpix_zarr(path, cell_ids, values, ["b02", "b03"], base_nside=16)

    read_ids, read_vals, _ = read_base_healpix_zarr(path)
    assert len(read_ids) == 2  # row 1 (NaN) is dropped
    assert 1 not in read_ids


def test_reflectance_band_keys_filters_coords():
    """Band key detection should skip x, y, crs, spatial_ref arrays."""
    from sentinel2_zhealpix.zarr_utils import reflectance_band_keys

    # Build a minimal in-memory zarr group mimicking a Sentinel-2 reflectance group
    store = zarr.storage.MemoryStore()
    grp = zarr.open_group(store, mode="w", zarr_format=3)
    # These should be EXCLUDED
    grp.create_array("x", data=np.zeros(10), chunks=(10,))
    grp.create_array("y", data=np.zeros(10), chunks=(10,))
    grp.create_array("crs", data=np.zeros(1), chunks=(1,))
    # These should be INCLUDED (2D arrays)
    grp.create_array("b02", data=np.zeros((10, 10)), chunks=(10, 10))
    grp.create_array("b03", data=np.zeros((10, 10)), chunks=(10, 10))
    grp.create_array("b8a", data=np.zeros((10, 10)), chunks=(10, 10))

    keys = reflectance_band_keys(grp)
    assert "x" not in keys
    assert "y" not in keys
    assert "crs" not in keys
    assert keys == ["b02", "b03", "b8a"]


def test_load_coords_only_reads_xy(tmp_path):
    """load_coords_only should return x_utm and y_utm arrays from a local zarr."""
    from sentinel2_zhealpix.zarr_utils import load_coords_only

    # Create a minimal Sentinel-2-like zarr structure on disk
    root_path = str(tmp_path / "product.zarr")
    root = zarr.open_group(root_path, mode="w", zarr_format=3)
    grp = root.require_group("measurements/reflectance/r20m")
    grp.create_array("x", data=np.array([100.0, 120.0, 140.0]))
    grp.create_array("y", data=np.array([200.0, 220.0]))
    grp.create_array("b02", data=np.zeros((2, 3)))

    x, y = load_coords_only(root_path, group="r20m")
    np.testing.assert_array_equal(x, [100.0, 120.0, 140.0])
    np.testing.assert_array_equal(y, [200.0, 220.0])

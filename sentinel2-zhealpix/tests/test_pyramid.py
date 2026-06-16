"""
Tests for pyramid.py.

We use a small synthetic base level (a few dozen cells at nside=16)
to verify pyramid structure without processing real satellite data.
"""
import numpy as np
import zarr


def _make_merged_zarr(tmp_path, nside=16, n_cells=10):
    """Helper: write a minimal merged_base.zarr for testing."""
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr

    path = str(tmp_path / "merged_base.zarr")
    # Use cells spread across the sphere so the pyramid has something to downsample
    total_cells = 12 * nside ** 2
    step = max(1, total_cells // n_cells)
    cell_ids = np.arange(0, min(n_cells * step, total_cells), step, dtype=np.int64)
    values = np.random.default_rng(42).random((len(cell_ids), 2)).astype(np.float32)
    write_base_healpix_zarr(path, cell_ids, values, ["b02", "b03"], base_nside=nside)
    return path, cell_ids, values


def test_build_pyramid_creates_mosaic_zarr(tmp_path):
    """build_pyramid should write a mosaic.zarr with at least one nside group."""
    from sentinel2_zhealpix.pyramid import build_pyramid
    from sentinel2_zhealpix.config import PipelineConfig

    merged_path, _, _ = _make_merged_zarr(tmp_path, nside=16)
    config = PipelineConfig(
        urls=[], out_dir=str(tmp_path), base_nside=16,
        min_nside_pyramid=4, parent_levels=2,
    )

    mosaic_path = build_pyramid(merged_path, config)

    assert mosaic_path == str(tmp_path / "mosaic.zarr")
    root = zarr.open_group(mosaic_path, mode="r", zarr_format=3)
    assert root.attrs["parent_levels"] == 2
    group_keys = list(root.group_keys())
    assert "nside_16" in group_keys
    assert "nside_4" in group_keys


def test_build_pyramid_arrays_have_correct_shape(tmp_path):
    """Each level's cell_id and values arrays should have the same length."""
    from sentinel2_zhealpix.pyramid import build_pyramid
    from sentinel2_zhealpix.config import PipelineConfig

    merged_path, cell_ids, _ = _make_merged_zarr(tmp_path, nside=16)
    config = PipelineConfig(
        urls=[], out_dir=str(tmp_path), base_nside=16,
        min_nside_pyramid=4, parent_levels=2,
    )

    mosaic_path = build_pyramid(merged_path, config)
    root = zarr.open_group(mosaic_path, mode="r", zarr_format=3)

    g = root["nside_16"]
    assert g["cell_id"].shape[0] == g["values"].shape[0]
    assert g["values"].shape[1] == 2  # 2 bands


def test_build_pyramid_parent_offsets_length(tmp_path):
    """parent_offsets length must be 12 * nside_parent^2 + 1."""
    from sentinel2_zhealpix.pyramid import build_pyramid
    from sentinel2_zhealpix.config import PipelineConfig

    merged_path, _, _ = _make_merged_zarr(tmp_path, nside=16)
    config = PipelineConfig(
        urls=[], out_dir=str(tmp_path), base_nside=16,
        min_nside_pyramid=4, parent_levels=2,
    )

    mosaic_path = build_pyramid(merged_path, config)
    root = zarr.open_group(mosaic_path, mode="r", zarr_format=3)

    for key in root.group_keys():
        g = root[key]
        nside_parent = g.attrs["nside_parent"]
        expected_len = 12 * nside_parent ** 2 + 1
        assert g["parent_offsets"].shape[0] == expected_len, key


def test_build_pyramid_parent_offsets_are_monotone(tmp_path):
    """parent_offsets must be non-decreasing (it's a CSR index vector)."""
    from sentinel2_zhealpix.pyramid import build_pyramid
    from sentinel2_zhealpix.config import PipelineConfig

    merged_path, _, _ = _make_merged_zarr(tmp_path, nside=16)
    config = PipelineConfig(
        urls=[], out_dir=str(tmp_path), base_nside=16,
        min_nside_pyramid=4, parent_levels=2,
    )

    mosaic_path = build_pyramid(merged_path, config)
    root = zarr.open_group(mosaic_path, mode="r", zarr_format=3)

    for key in root.group_keys():
        offsets = np.asarray(root[key]["parent_offsets"][:])
        assert np.all(offsets[1:] >= offsets[:-1]), f"{key}: parent_offsets not monotone"
        assert offsets[-1] == root[key]["cell_id"].shape[0], \
            f"{key}: parent_offsets[-1] must equal number of cells"


def test_build_pyramid_coarser_levels_have_fewer_cells(tmp_path):
    """Cells at nside=8 should be <= cells at nside=16 (downsampling)."""
    from sentinel2_zhealpix.pyramid import build_pyramid
    from sentinel2_zhealpix.config import PipelineConfig

    merged_path, _, _ = _make_merged_zarr(tmp_path, nside=16, n_cells=100)
    config = PipelineConfig(
        urls=[], out_dir=str(tmp_path), base_nside=16,
        min_nside_pyramid=4, parent_levels=1,
    )

    mosaic_path = build_pyramid(merged_path, config)
    root = zarr.open_group(mosaic_path, mode="r", zarr_format=3)

    n16 = root["nside_16"]["cell_id"].shape[0]
    n8  = root["nside_8"]["cell_id"].shape[0]
    assert n8 <= n16

# sentinel2-zhealpix/tests/test_merge.py
"""
Tests for merge.py.

All merge logic is pure numpy — we test it with synthetic sorted arrays,
no real zarr files needed for the unit tests.
"""
import os
import numpy as np


def test_merge_two_sorted_no_overlap():
    """Two non-overlapping sorted arrays → concatenated and sorted result."""
    from sentinel2_zhealpix.merge import merge_two_sorted_first_wins

    left_ids  = np.array([0, 2, 4], dtype=np.int64)
    left_vals = np.array([[0.1], [0.2], [0.3]], dtype=np.float32)
    right_ids  = np.array([1, 3, 5], dtype=np.int64)
    right_vals = np.array([[0.5], [0.6], [0.7]], dtype=np.float32)

    ids, vals = merge_two_sorted_first_wins(left_ids, left_vals, right_ids, right_vals)

    np.testing.assert_array_equal(ids, [0, 1, 2, 3, 4, 5])
    assert len(vals) == 6


def test_merge_two_sorted_left_wins_on_overlap():
    """When both arrays contain the same cell id, left value is kept."""
    from sentinel2_zhealpix.merge import merge_two_sorted_first_wins

    left_ids  = np.array([1, 2, 3], dtype=np.int64)
    left_vals = np.array([[0.1], [0.2], [0.3]], dtype=np.float32)
    right_ids  = np.array([2, 3, 4], dtype=np.int64)
    right_vals = np.array([[0.9], [0.9], [0.4]], dtype=np.float32)

    ids, vals = merge_two_sorted_first_wins(left_ids, left_vals, right_ids, right_vals)

    np.testing.assert_array_equal(ids, [1, 2, 3, 4])
    np.testing.assert_allclose(vals[1, 0], 0.2, atol=1e-6)
    np.testing.assert_allclose(vals[2, 0], 0.3, atol=1e-6)
    np.testing.assert_allclose(vals[3, 0], 0.4, atol=1e-6)


def test_merge_two_sorted_empty_left():
    """Empty left input → return right unchanged."""
    from sentinel2_zhealpix.merge import merge_two_sorted_first_wins

    left_ids  = np.array([], dtype=np.int64)
    left_vals = np.zeros((0, 2), dtype=np.float32)
    right_ids  = np.array([1, 2], dtype=np.int64)
    right_vals = np.array([[0.1, 0.2], [0.3, 0.4]], dtype=np.float32)

    ids, vals = merge_two_sorted_first_wins(left_ids, left_vals, right_ids, right_vals)
    np.testing.assert_array_equal(ids, right_ids)
    np.testing.assert_allclose(vals, right_vals)


def test_merge_two_sorted_empty_right():
    """Empty right input → return left unchanged."""
    from sentinel2_zhealpix.merge import merge_two_sorted_first_wins

    left_ids  = np.array([1, 2], dtype=np.int64)
    left_vals = np.array([[0.1], [0.2]], dtype=np.float32)
    right_ids  = np.array([], dtype=np.int64)
    right_vals = np.zeros((0, 1), dtype=np.float32)

    ids, vals = merge_two_sorted_first_wins(left_ids, left_vals, right_ids, right_vals)
    np.testing.assert_array_equal(ids, left_ids)
    np.testing.assert_allclose(vals, left_vals)


def test_merge_pair_zarrs(tmp_path):
    """merge_pair_zarrs reads two zarrs, merges, writes third."""
    from sentinel2_zhealpix.merge import merge_pair_zarrs
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr, read_base_healpix_zarr

    path_a = str(tmp_path / "a.zarr")
    path_b = str(tmp_path / "b.zarr")
    path_out = str(tmp_path / "out.zarr")

    write_base_healpix_zarr(
        path_a,
        np.array([0, 2, 4], dtype=np.int64),
        np.array([[0.1], [0.2], [0.3]], dtype=np.float32),
        ["b02"], base_nside=256,
    )
    write_base_healpix_zarr(
        path_b,
        np.array([1, 2, 5], dtype=np.int64),
        np.array([[0.5], [0.9], [0.6]], dtype=np.float32),
        ["b02"], base_nside=256,
    )

    result_path = merge_pair_zarrs(path_a, path_b, path_out)
    assert result_path == path_out

    ids, vals, attrs = read_base_healpix_zarr(path_out)
    np.testing.assert_array_equal(ids, [0, 1, 2, 4, 5])
    idx_2 = list(ids).index(2)
    np.testing.assert_allclose(vals[idx_2, 0], 0.2, atol=1e-6)


def test_tree_merge_two_scenes(tmp_path):
    """tree_merge of two scenes returns path to a merged zarr."""
    from sentinel2_zhealpix.merge import tree_merge
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr, read_base_healpix_zarr
    from sentinel2_zhealpix.config import PipelineConfig

    path_a = str(tmp_path / "s0.zarr")
    path_b = str(tmp_path / "s1.zarr")
    write_base_healpix_zarr(
        path_a, np.array([0, 2], dtype=np.int64),
        np.array([[0.1], [0.2]], dtype=np.float32), ["b02"], base_nside=16,
    )
    write_base_healpix_zarr(
        path_b, np.array([1, 3], dtype=np.int64),
        np.array([[0.3], [0.4]], dtype=np.float32), ["b02"], base_nside=16,
    )

    config = PipelineConfig(urls=[], out_dir=str(tmp_path), base_nside=16)
    merged_path = tree_merge([path_a, path_b], config)

    ids, vals, attrs = read_base_healpix_zarr(merged_path)
    np.testing.assert_array_equal(ids, [0, 1, 2, 3])
    assert attrs["base_nside"] == 16


def test_tree_merge_four_scenes(tmp_path):
    """tree_merge of four scenes (two rounds of tree reduction)."""
    from sentinel2_zhealpix.merge import tree_merge
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr, read_base_healpix_zarr
    from sentinel2_zhealpix.config import PipelineConfig

    paths = []
    for i in range(4):
        p = str(tmp_path / f"s{i}.zarr")
        write_base_healpix_zarr(
            p,
            np.array([i * 10, i * 10 + 1], dtype=np.int64),
            np.array([[float(i)], [float(i) + 0.5]], dtype=np.float32),
            ["b02"], base_nside=16,
        )
        paths.append(p)

    config = PipelineConfig(urls=[], out_dir=str(tmp_path), base_nside=16)
    merged_path = tree_merge(paths, config)

    ids, vals, _ = read_base_healpix_zarr(merged_path)
    assert len(ids) == 8  # 4 scenes × 2 non-overlapping cells each


def test_tree_merge_three_scenes_odd_carry(tmp_path):
    """tree_merge with 3 scenes (odd count) carries the last scene forward."""
    from sentinel2_zhealpix.merge import tree_merge
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr, read_base_healpix_zarr
    from sentinel2_zhealpix.config import PipelineConfig

    paths = []
    for i in range(3):
        p = str(tmp_path / f"s{i}.zarr")
        write_base_healpix_zarr(
            p,
            np.array([i * 10], dtype=np.int64),
            np.array([[float(i)]], dtype=np.float32),
            ["b02"], base_nside=16,
        )
        paths.append(p)

    config = PipelineConfig(urls=[], out_dir=str(tmp_path), base_nside=16)
    merged_path = tree_merge(paths, config)

    ids, _, _ = read_base_healpix_zarr(merged_path)
    assert len(ids) == 3  # all 3 non-overlapping cells present
    assert 0 in ids and 10 in ids and 20 in ids


def test_tree_merge_checkpoints(tmp_path):
    """tree_merge skips a round output that already exists."""
    from sentinel2_zhealpix.merge import tree_merge, merge_round_output_path
    from sentinel2_zhealpix.zarr_utils import write_base_healpix_zarr, read_base_healpix_zarr
    from sentinel2_zhealpix.config import PipelineConfig

    path_a = str(tmp_path / "s0.zarr")
    path_b = str(tmp_path / "s1.zarr")
    write_base_healpix_zarr(
        path_a, np.array([0], dtype=np.int64),
        np.ones((1, 1), dtype=np.float32), ["b02"], base_nside=16,
    )
    write_base_healpix_zarr(
        path_b, np.array([1], dtype=np.int64),
        np.ones((1, 1), dtype=np.float32) * 2, ["b02"], base_nside=16,
    )

    r0_path = merge_round_output_path(str(tmp_path), 0, 0)
    os.makedirs(os.path.dirname(r0_path), exist_ok=True)
    write_base_healpix_zarr(
        r0_path, np.array([99], dtype=np.int64),
        np.array([[0.999]], dtype=np.float32), ["b02"], base_nside=16,
    )

    config = PipelineConfig(urls=[], out_dir=str(tmp_path), base_nside=16)
    merged_path = tree_merge([path_a, path_b], config)

    ids, _, _ = read_base_healpix_zarr(merged_path)
    assert 99 in ids

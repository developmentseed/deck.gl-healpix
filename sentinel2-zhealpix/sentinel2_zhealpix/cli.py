"""
Unified CLI for sentinel2-zhealpix.

Subcommands call per-input functions from download, healpix, merge, pyramid.
"""
from __future__ import annotations

import argparse
import glob
import os
import sys
import time
from collections.abc import Callable

from .config import PipelineConfig
from .download import download_one_scene, is_raw_done, raw_zarr_path
from .healpix import healpix_one_scene, is_scene_done, parse_raw_filename, scene_zarr_path
from .merge import merge_pair_zarrs, tree_merge
from .pyramid import build_pyramid
from .zarr_utils import read_base_healpix_zarr, reflectance_band_keys


def _default_workers() -> int:
    return max(1, (os.cpu_count() or 2) - 1)


def _add_out_dir(p: argparse.ArgumentParser) -> None:
    p.add_argument("--out-dir", required=True, help="Output directory (local)")


def _add_workers(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--workers",
        type=int,
        default=_default_workers(),
        help="Number of Dask workers (default: cpu_count - 1; 1 = sequential, no Dask)",
    )


def _add_urls_args(p: argparse.ArgumentParser) -> None:
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--urls", nargs="+", metavar="URL", help="One or more Sentinel-2 product root URLs")
    g.add_argument("--urls-file", metavar="FILE", help="Text file with one URL per line")


def _add_reflectance_group(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--reflectance-group",
        default="r20m",
        help="Sentinel-2 resolution group: r10m, r20m, r60m (default: r20m)",
    )


def _add_resample_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--base-nside", type=int, default=None, help="HEALPix base resolution (auto-detect if omitted)")
    p.add_argument("--subsamples", type=int, default=4, help="K×K footprint subsampling per pixel (default: 4)")


def _add_pyramid_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--min-nside", type=int, default=128, help="Coarsest pyramid level (default: 128)")
    p.add_argument(
        "--parent-levels",
        type=int,
        default=6,
        help="nside doublings between each level and its parent (default: 6)",
    )


def _add_raw_dir_override(p: argparse.ArgumentParser) -> None:
    p.add_argument("--raw-dir", default=None, help="Read raw zarrs from this directory (default: --out-dir/raw)")


def _add_scenes_dir_override(p: argparse.ArgumentParser) -> None:
    p.add_argument("--scenes-dir", default=None, help="Read scene zarrs from this directory (default: --out-dir/scenes)")


def _add_merged_base_override(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--merged-base",
        default=None,
        help="Merged base zarr path (default: --out-dir/merged_base.zarr)",
    )


def _resolve_urls(args: argparse.Namespace) -> list[str]:
    if getattr(args, "urls_file", None):
        with open(args.urls_file) as f:
            return [line.strip() for line in f if line.strip()]
    return list(args.urls)


def _build_config(args: argparse.Namespace, urls: list[str], base_nside: int) -> PipelineConfig:
    return PipelineConfig(
        urls=urls,
        out_dir=args.out_dir,
        base_nside=base_nside,
        reflectance_group=getattr(args, "reflectance_group", "r20m"),
        min_nside_pyramid=getattr(args, "min_nside", 128),
        parent_levels=getattr(args, "parent_levels", 6),
        footprint_subsamples=getattr(args, "subsamples", 4),
        n_workers=getattr(args, "workers", _default_workers()),
    )


def _probe_base_nside_raw(raw_zarr_path: str, group: str) -> int:
    import numpy as np
    import zarr

    from .healpix_utils import recommend_nside_from_pixel_spacing

    root = zarr.open_group(raw_zarr_path, mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][group]
    x_utm = np.asarray(grp["x"][:], dtype=np.float64)
    y_utm = np.asarray(grp["y"][:], dtype=np.float64)
    return recommend_nside_from_pixel_spacing(x_utm, y_utm)


def _merged_base_present(config: PipelineConfig) -> bool:
    if not os.path.exists(config.merged_base_path):
        return False
    try:
        _, _, attrs = read_base_healpix_zarr(config.merged_base_path)
        return "base_nside" in attrs and "bands" in attrs
    except Exception:
        return False


def _mosaic_present(config: PipelineConfig) -> bool:
    if not os.path.exists(config.mosaic_path):
        return False
    try:
        import zarr

        root = zarr.open_group(config.mosaic_path, mode="r", zarr_format=3)
        return (
            int(root.attrs.get("min_nside", -1)) == config.min_nside_pyramid
            and int(root.attrs.get("parent_levels", -1)) == config.parent_levels
        )
    except Exception:
        return False


def _run_with_dask_or_serial(fn: Callable, items: list, key_prefix: str, n_workers: int) -> list:
    if n_workers <= 1:
        return [fn(*item) if isinstance(item, tuple) else fn(item) for item in items]

    from dask.distributed import Client, LocalCluster

    with Client(
        LocalCluster(n_workers=n_workers, threads_per_worker=1, memory_limit=0)
    ) as client:
        print(f"Dask dashboard: {client.dashboard_link}\n", flush=True)
        futures = []
        for i, item in enumerate(items):
            args_tuple = item if isinstance(item, tuple) else (item,)
            futures.append(client.submit(fn, *args_tuple, key=f"{key_prefix}[{i}]"))
        return list(client.gather(futures))


def _dask_pair_executor_factory(n_workers: int):
    if n_workers <= 1:
        return None

    from dask.distributed import Client, LocalCluster

    holder: dict = {}

    def executor(pairs: list) -> None:
        client = holder.get("client")
        if client is None:
            cluster = LocalCluster(n_workers=n_workers, threads_per_worker=1, memory_limit=0)
            client = Client(cluster)
            holder["client"] = client
            holder["cluster"] = cluster
            print(f"Dask dashboard: {client.dashboard_link}\n", flush=True)
        futures = [
            client.submit(merge_pair_zarrs, a, b, out, key=f"merge-{os.path.basename(out)}")
            for a, b, out in pairs
        ]
        client.gather(futures)

    def cleanup() -> None:
        if "client" in holder:
            holder["client"].close()
            holder["cluster"].close()

    executor.cleanup = cleanup  # type: ignore[attr-defined]
    return executor


def cmd_download(args: argparse.Namespace) -> int:
    urls = _resolve_urls(args)
    if not urls:
        print("error: no URLs provided", file=sys.stderr)
        return 2
    config = _build_config(args, urls=urls, base_nside=1)
    os.makedirs(config.raw_dir, exist_ok=True)
    print(f"=== download: {len(urls)} scene(s) ===", flush=True)
    t0 = time.perf_counter()
    items = [(u, i, config) for i, u in enumerate(urls)]
    _run_with_dask_or_serial(download_one_scene, items, key_prefix="download", n_workers=args.workers)
    print(f"download complete in {time.perf_counter()-t0:.1f}s", flush=True)
    return 0


def cmd_healpix(args: argparse.Namespace) -> int:
    raw_dir = args.raw_dir if args.raw_dir else os.path.join(args.out_dir, "raw")
    raw_paths = sorted(glob.glob(os.path.join(raw_dir, "*.zarr")))
    if not raw_paths:
        if args.raw_dir:
            print(f"error: no raw scenes found in {raw_dir}/.", file=sys.stderr)
        else:
            print(f"error: no raw scenes found in {raw_dir}/. Run 'download' first.", file=sys.stderr)
        return 2

    base_nside = args.base_nside
    if base_nside is None:
        base_nside = _probe_base_nside_raw(raw_paths[0], group=args.reflectance_group)
        print(f"auto-detected base_nside={base_nside}", flush=True)

    config = _build_config(args, urls=[], base_nside=base_nside)
    os.makedirs(config.scenes_dir, exist_ok=True)
    print(f"=== healpix: {len(raw_paths)} scene(s) ===", flush=True)
    t0 = time.perf_counter()
    items = [(p, config) for p in raw_paths]
    _run_with_dask_or_serial(healpix_one_scene, items, key_prefix="healpix", n_workers=args.workers)
    print(f"healpix complete in {time.perf_counter()-t0:.1f}s", flush=True)
    return 0


def cmd_merge(args: argparse.Namespace) -> int:
    scenes_dir = args.scenes_dir if args.scenes_dir else os.path.join(args.out_dir, "scenes")
    scene_paths = sorted(glob.glob(os.path.join(scenes_dir, "*.zarr")))
    if not scene_paths:
        if args.scenes_dir:
            print(f"error: no scene zarrs in {scenes_dir}/.", file=sys.stderr)
        else:
            print(f"error: no scene zarrs in {scenes_dir}/. Run 'healpix' first.", file=sys.stderr)
        return 2

    _, _, attrs = read_base_healpix_zarr(scene_paths[0])
    base_nside = attrs["base_nside"]

    config = _build_config(args, urls=[], base_nside=base_nside)

    if _merged_base_present(config):
        print(f"merged_base.zarr already present at {config.merged_base_path}, skipping", flush=True)
        return 0

    os.makedirs(config.merge_dir, exist_ok=True)
    print(f"=== merge: {len(scene_paths)} scene(s) ===", flush=True)
    t0 = time.perf_counter()

    executor = _dask_pair_executor_factory(args.workers)
    try:
        merged_path = tree_merge(scene_paths, config, pair_executor=executor)
    finally:
        if executor is not None and hasattr(executor, "cleanup"):
            executor.cleanup()

    print(f"merge complete in {time.perf_counter()-t0:.1f}s → {merged_path}", flush=True)
    return 0


def cmd_pyramid(args: argparse.Namespace) -> int:
    merged_path = args.merged_base if args.merged_base else os.path.join(args.out_dir, "merged_base.zarr")
    if not os.path.exists(merged_path):
        if args.merged_base:
            print(f"error: no merged base zarr at {merged_path}.", file=sys.stderr)
        else:
            print(f"error: no merged base zarr at {merged_path}. Run 'merge' first.", file=sys.stderr)
        return 2

    _, _, attrs = read_base_healpix_zarr(merged_path)
    base_nside = attrs["base_nside"]

    config = _build_config(args, urls=[], base_nside=base_nside)

    if _mosaic_present(config):
        print(
            f"mosaic.zarr already present at {config.mosaic_path} with matching "
            "min_nside / parent_levels, skipping",
            flush=True,
        )
        return 0

    print(f"=== pyramid: building from {merged_path} ===", flush=True)
    t0 = time.perf_counter()
    mosaic_path = build_pyramid(merged_path, config)
    print(f"pyramid complete in {time.perf_counter()-t0:.1f}s → {mosaic_path}", flush=True)
    return 0


def _all_raw_present(urls: list[str], config: PipelineConfig) -> bool:
    for i, url in enumerate(urls):
        path = raw_zarr_path(config, scene_index=i, url=url)
        if not is_raw_done(path, source_url=url, group=config.reflectance_group):
            return False
    return True


def _all_scenes_present(config: PipelineConfig, expected_bands: list[str]) -> bool:
    raw_paths = sorted(glob.glob(os.path.join(config.raw_dir, "*.zarr")))
    if not raw_paths:
        return False
    for raw_path in raw_paths:
        idx, tile = parse_raw_filename(raw_path)
        scene_path = scene_zarr_path(config, idx, tile)
        if not is_scene_done(scene_path, config.base_nside, expected_bands):
            return False
    return True


def _read_band_keys_from_raw(config: PipelineConfig) -> list[str]:
    import zarr

    raw_paths = sorted(glob.glob(os.path.join(config.raw_dir, "*.zarr")))
    if not raw_paths:
        return []
    root = zarr.open_group(raw_paths[0], mode="r", zarr_format=3)
    grp = root["measurements"]["reflectance"][config.reflectance_group]
    return reflectance_band_keys(grp)


def cmd_run_all(args: argparse.Namespace) -> int:
    """Download → healpix → merge → pyramid with disk-state skips."""
    if args.workers <= 1:
        return _cmd_run_all_serial(args)

    from dask.distributed import Client, LocalCluster

    urls = _resolve_urls(args)
    if not urls:
        print("error: no URLs provided", file=sys.stderr)
        return 2

    os.makedirs(args.out_dir, exist_ok=True)
    cfg_dl = _build_config(args, urls=urls, base_nside=1)

    t_total = time.perf_counter()
    print(
        f"run-all: {len(urls)} scene(s), out_dir={args.out_dir}, workers={args.workers}",
        flush=True,
    )

    with Client(LocalCluster(n_workers=args.workers, threads_per_worker=1, memory_limit=0)) as client:
        print(f"Dask dashboard: {client.dashboard_link}\n", flush=True)

        if _all_raw_present(urls, cfg_dl):
            print(f"[download] all {len(urls)} raw zarrs present, skipping", flush=True)
        else:
            os.makedirs(cfg_dl.raw_dir, exist_ok=True)
            print(f"[download] running {len(urls)} scene(s)…", flush=True)
            futures = [
                client.submit(download_one_scene, url, i, cfg_dl, key=f"download[{i}]")
                for i, url in enumerate(urls)
            ]
            client.gather(futures)

        raw_paths = sorted(glob.glob(os.path.join(cfg_dl.raw_dir, "*.zarr")))
        if not raw_paths:
            print("error: no raw zarrs after download stage", file=sys.stderr)
            return 2

        if args.base_nside is not None:
            base_nside = args.base_nside
        else:
            base_nside = _probe_base_nside_raw(raw_paths[0], group=args.reflectance_group)
            print(f"auto-detected base_nside={base_nside}", flush=True)

        config = _build_config(args, urls=urls, base_nside=base_nside)
        expected_bands = _read_band_keys_from_raw(config)

        if _all_scenes_present(config, expected_bands):
            print(f"[healpix]  all {len(raw_paths)} scene zarrs present, skipping", flush=True)
        else:
            os.makedirs(config.scenes_dir, exist_ok=True)
            print(f"[healpix]  running {len(raw_paths)} scene(s)…", flush=True)
            futures = [
                client.submit(healpix_one_scene, p, config, key=f"healpix[{i}]")
                for i, p in enumerate(raw_paths)
            ]
            client.gather(futures)

        if _merged_base_present(config):
            print("[merge]    merged_base.zarr present, skipping", flush=True)
        else:
            os.makedirs(config.merge_dir, exist_ok=True)
            scene_paths = sorted(glob.glob(os.path.join(config.scenes_dir, "*.zarr")))
            print(f"[merge]    {len(scene_paths)} scene(s) → 1", flush=True)

            def _pair_exec(pairs: list) -> None:
                fs = [
                    client.submit(merge_pair_zarrs, a, b, out, key=f"merge-{os.path.basename(out)}")
                    for a, b, out in pairs
                ]
                client.gather(fs)

            tree_merge(scene_paths, config, pair_executor=_pair_exec)

    if _mosaic_present(config):
        print("[pyramid]  mosaic.zarr already up to date, skipping", flush=True)
    else:
        print(f"[pyramid]  building from {config.merged_base_path}", flush=True)
        build_pyramid(config.merged_base_path, config)

    print(f"\nrun-all complete in {time.perf_counter()-t_total:.1f}s", flush=True)
    return 0


def _cmd_run_all_serial(args: argparse.Namespace) -> int:
    """Same pipeline as run-all without LocalCluster (--workers == 1)."""
    urls = _resolve_urls(args)
    if not urls:
        print("error: no URLs provided", file=sys.stderr)
        return 2

    os.makedirs(args.out_dir, exist_ok=True)
    cfg_dl = _build_config(args, urls=urls, base_nside=1)

    t_total = time.perf_counter()
    print(
        f"run-all (sequential): {len(urls)} scene(s), out_dir={args.out_dir}",
        flush=True,
    )

    if _all_raw_present(urls, cfg_dl):
        print(f"[download] all {len(urls)} raw zarrs present, skipping", flush=True)
    else:
        os.makedirs(cfg_dl.raw_dir, exist_ok=True)
        print(f"[download] running {len(urls)} scene(s)…", flush=True)
        for i, url in enumerate(urls):
            download_one_scene(url, i, cfg_dl)

    raw_paths = sorted(glob.glob(os.path.join(cfg_dl.raw_dir, "*.zarr")))
    if not raw_paths:
        print("error: no raw zarrs after download stage", file=sys.stderr)
        return 2

    if args.base_nside is not None:
        base_nside = args.base_nside
    else:
        base_nside = _probe_base_nside_raw(raw_paths[0], group=args.reflectance_group)
        print(f"auto-detected base_nside={base_nside}", flush=True)

    config = _build_config(args, urls=urls, base_nside=base_nside)
    expected_bands = _read_band_keys_from_raw(config)

    if _all_scenes_present(config, expected_bands):
        print(f"[healpix]  all {len(raw_paths)} scene zarrs present, skipping", flush=True)
    else:
        os.makedirs(config.scenes_dir, exist_ok=True)
        print(f"[healpix]  running {len(raw_paths)} scene(s)…", flush=True)
        for p in raw_paths:
            healpix_one_scene(p, config)

    if _merged_base_present(config):
        print("[merge]    merged_base.zarr present, skipping", flush=True)
    else:
        os.makedirs(config.merge_dir, exist_ok=True)
        scene_paths = sorted(glob.glob(os.path.join(config.scenes_dir, "*.zarr")))
        print(f"[merge]    {len(scene_paths)} scene(s) → 1", flush=True)
        tree_merge(scene_paths, config, pair_executor=None)

    if _mosaic_present(config):
        print("[pyramid]  mosaic.zarr already up to date, skipping", flush=True)
    else:
        print(f"[pyramid]  building from {config.merged_base_path}", flush=True)
        build_pyramid(config.merged_base_path, config)

    print(f"\nrun-all complete in {time.perf_counter()-t_total:.1f}s", flush=True)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sentinel2_zhealpix",
        description="Sentinel-2 → HEALPix pipeline (download → healpix → merge → pyramid).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True, metavar="SUBCOMMAND")

    p_dl = sub.add_parser("download", help="Mirror S2 reflectance subgroups to local raw zarrs")
    _add_urls_args(p_dl)
    _add_out_dir(p_dl)
    _add_reflectance_group(p_dl)
    _add_workers(p_dl)
    p_dl.set_defaults(func=cmd_download)

    p_hp = sub.add_parser("healpix", help="Resample raw zarrs to base-level HEALPix scene zarrs")
    _add_out_dir(p_hp)
    _add_raw_dir_override(p_hp)
    _add_reflectance_group(p_hp)
    _add_resample_args(p_hp)
    _add_workers(p_hp)
    p_hp.set_defaults(func=cmd_healpix)

    p_mg = sub.add_parser("merge", help="Tree-reduce-merge scene zarrs into one merged base zarr")
    _add_out_dir(p_mg)
    _add_scenes_dir_override(p_mg)
    _add_workers(p_mg)
    p_mg.set_defaults(func=cmd_merge)

    p_py = sub.add_parser("pyramid", help="Build parent_offsets pyramid from merged base zarr")
    _add_out_dir(p_py)
    _add_merged_base_override(p_py)
    _add_pyramid_args(p_py)
    p_py.set_defaults(func=cmd_pyramid)

    p_ra = sub.add_parser(
        "run-all",
        help="Run download → healpix → merge → pyramid; skip stages whose outputs exist",
    )
    _add_urls_args(p_ra)
    _add_out_dir(p_ra)
    _add_reflectance_group(p_ra)
    _add_resample_args(p_ra)
    _add_pyramid_args(p_ra)
    _add_workers(p_ra)
    p_ra.set_defaults(func=cmd_run_all)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

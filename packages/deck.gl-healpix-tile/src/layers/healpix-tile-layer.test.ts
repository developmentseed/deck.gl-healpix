import { describe, it, expect, jest } from '@jest/globals';
import { HealpixTileLayer } from './healpix-tile-layer';
import type { HealpixTileData } from '../types';

const makeTileProps = (data: HealpixTileData | null) => ({
  id: 'test',
  data,
  _offset: 0,
  tile: { id: '2-0-0', index: { x: 0, y: 0, z: 2 } }
});

describe('HealpixTileLayer.renderSubLayers', () => {
  it('returns null when data is null', () => {
    const layer = new HealpixTileLayer({
      getTileData: () => Promise.resolve(null)
    });
    expect(layer.renderSubLayers(makeTileProps(null) as any)).toBeNull();
  });

  it('returns null when cellIds is empty', () => {
    const layer = new HealpixTileLayer({
      getTileData: () => Promise.resolve(null)
    });
    const data: HealpixTileData = {
      nside: 4,
      cellIds: new Float64Array(0),
      values: new Float32Array(0),
      bands: ['r']
    };
    expect(layer.renderSubLayers(makeTileProps(data) as any)).toBeNull();
  });

  it('returns a HealpixCellsLayer with correct nside when data has cells', () => {
    const layer = new HealpixTileLayer({
      getTileData: () => Promise.resolve(null)
    });
    const data: HealpixTileData = {
      nside: 4,
      cellIds: new Float64Array([1, 2, 3]),
      values: new Float32Array([0.1, 0.2, 0.3]),
      bands: ['r']
    };
    const result = layer.renderSubLayers(makeTileProps(data) as any) as any;
    expect(result).not.toBeNull();
    expect(result.props.nside).toBe(4);
    expect(result.props.cellIds).toBe(data.cellIds);
    expect(result.props.values).toBe(data.values);
    expect(result.props.dimensions).toBe(1);
  });
});

describe('HealpixTileLayer.refreshTileData', () => {
  it('calls reloadAll when called without a filter', () => {
    const layer = new HealpixTileLayer({
      getTileData: () => Promise.resolve(null)
    });
    const reloadAll = jest.fn();
    layer.state = { tileset: { reloadAll, tiles: [] } as any };
    layer.refreshTileData();
    expect(reloadAll).toHaveBeenCalledTimes(1);
  });

  it('does nothing when tileset is null', () => {
    const layer = new HealpixTileLayer({
      getTileData: () => Promise.resolve(null)
    });
    layer.state = { tileset: null };
    expect(() => layer.refreshTileData()).not.toThrow();
  });

  it('resets only tiles where filter returns true, does not call reloadAll', () => {
    const layer = new HealpixTileLayer({
      getTileData: () => Promise.resolve(null)
    });
    const tile0 = { index: { x: 0, y: 0, z: 1 }, setNeedsReload: jest.fn() };
    const tile1 = { index: { x: 1, y: 0, z: 1 }, setNeedsReload: jest.fn() };
    const reloadAll = jest.fn();
    layer.state = {
      tileset: {
        reloadAll,
        tiles: [tile0, tile1]
      } as any
    };
    layer.refreshTileData((idx) => idx.x === 0);
    expect(tile0.setNeedsReload).toHaveBeenCalledTimes(1);
    expect(tile1.setNeedsReload).not.toHaveBeenCalled();
    expect(reloadAll).not.toHaveBeenCalled();
  });
});

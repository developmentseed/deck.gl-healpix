// Minimal stub for @deck.gl/geo-layers used in Jest (no WebGL needed).
import type { HealpixTileIndex } from '../types';

export class _Tileset2D {
  opts: Record<string, unknown> = {};
  constructor(opts?: Record<string, unknown>) {
    this.opts = opts ?? {};
    this.setOptions(this.opts);
  }
  setOptions(opts: Record<string, unknown>) {
    Object.assign(this.opts, opts);
  }
  getTileIndices(_opts: { viewport?: unknown }) {
    return [];
  }
  getTileId(index: HealpixTileIndex) {
    return String(index);
  }
  getTileZoom(_index: HealpixTileIndex) {
    return 0;
  }
  getParentIndex(index: HealpixTileIndex) {
    return index;
  }
}
export type _Tileset2DProps = Record<string, unknown>;

export class TileLayer {
  static layerName = 'TileLayer';
  static defaultProps = {};
  props: Record<string, unknown>;
  state: Record<string, unknown> = {};
  id = '';
  context: Record<string, unknown> = {};
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
  initializeState() {}
  setState(s: Record<string, unknown>) {
    Object.assign(this.state, s);
  }
  setNeedsUpdate() {}
  _getTilesetOptions() {
    return {};
  }
  getTileData(_tile: unknown): null {
    return null;
  }
  renderSubLayers(_props: unknown): null {
    return null;
  }
  getSubLayerProps(extra: Record<string, unknown>) {
    return { ...this.props, ...extra };
  }
  raiseError(e: Error) {
    throw e;
  }
}
export type TileLayerProps = Record<string, unknown>;

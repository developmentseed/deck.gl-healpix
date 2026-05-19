// Minimal stub for @deck.gl/geo-layers used in Jest (no WebGL needed).
export class _Tileset2D {
  opts: any = {};
  constructor(opts: any) {
    this.opts = opts ?? {};
    this.setOptions(this.opts);
  }
  setOptions(opts: any) {
    Object.assign(this.opts, opts);
  }
  getTileIndices(_opts: any) {
    return [];
  }
  getTileId(index: any) {
    return String(index);
  }
  getTileZoom(_index: any) {
    return 0;
  }
  getParentIndex(index: any) {
    return index;
  }
}
export type _Tileset2DProps = Record<string, any>;

export class TileLayer {
  static layerName = 'TileLayer';
  static defaultProps = {};
  props: any;
  state: any = {};
  id = '';
  context: any = {};
  constructor(props: any = {}) {
    this.props = props;
  }
  initializeState() {}
  setState(s: any) {
    Object.assign(this.state, s);
  }
  setNeedsUpdate() {}
  _getTilesetOptions() {
    return {};
  }
  getTileData(_tile: any): any {
    return null;
  }
  renderSubLayers(_props: any): any {
    return null;
  }
  getSubLayerProps(extra: any) {
    return { ...this.props, ...extra };
  }
  raiseError(e: Error) {
    throw e;
  }
}
export type TileLayerProps = Record<string, any>;

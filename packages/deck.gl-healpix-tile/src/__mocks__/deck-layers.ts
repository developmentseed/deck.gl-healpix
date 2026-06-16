// Minimal stub for @deck.gl/layers used in Jest (avoids pulling in @mapbox/tiny-sdf, which is ESM-only).
export class PathLayer {
  static layerName = 'PathLayer';
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
}

export class TextLayer {
  static layerName = 'TextLayer';
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
}

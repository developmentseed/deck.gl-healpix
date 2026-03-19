/**
 * HealpixCellsLayer — render arbitrary HEALPix cells by ID.
 */
import {
  CompositeLayer,
  DefaultProps,
  Layer,
  UpdateParameters
} from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { expandArrayBuffer } from '../utils/array-buffer';
import { computeGeometry } from '../geometry/compute-geometry';
import { VERTS_PER_CELL } from '../types/layer-props';
import type { HealpixCellsLayerProps } from '../types/layer-props';

type _HealpixCellsLayerProps = {
  nside: number;
  cellIds: Int32Array;
  scheme: 'nest' | 'ring';
  getFillColor: Float32Array;
};

const defaultProps: DefaultProps<_HealpixCellsLayerProps> = {
  nside: { type: 'number', value: 0 },
  cellIds: { type: 'object', value: new Int32Array(0), compare: true },
  // @ts-expect-error deck.gl DefaultProps has no 'string' type.
  scheme: { type: 'string', value: 'nest' },
  getFillColor: {
    type: 'object',
    value: new Float32Array(0),
    compare: true
  }
};

export class HealpixCellsLayer extends CompositeLayer<HealpixCellsLayerProps> {
  static layerName = 'HealpixCellsLayer';
  static defaultProps = defaultProps;

  declare state: {
    coords: Float32Array | null;
    indexes: Uint32Array | null;
    triangles: Uint32Array | null;
    ready: boolean;
  };

  private _version = 0;

  initializeState(): void {
    this.setState({
      coords: null,
      indexes: null,
      triangles: null,
      ready: false
    });
    this._buildGeometry();
  }

  shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
    return !!changeFlags.propsOrDataChanged;
  }

  updateState({ props, oldProps }: UpdateParameters<this>): void {
    if (
      props.cellIds !== oldProps.cellIds ||
      props.nside !== oldProps.nside ||
      props.scheme !== oldProps.scheme
    ) {
      this._buildGeometry();
    }
  }

  private async _buildGeometry(): Promise<void> {
    const { nside, cellIds, scheme } = this.props;

    this.setState({
      coords: null,
      indexes: null,
      triangles: null,
      ready: false
    });

    if (!cellIds?.length) return;

    const v = ++this._version;
    const { coords, indexes, triangles } = await computeGeometry(
      nside,
      cellIds,
      scheme
    );
    if (this._version !== v) return;

    this.setState({ coords, indexes, triangles, ready: true });
  }

  renderLayers(): Layer[] {
    const { coords, indexes, triangles, ready } = this.state;
    if (!ready || !coords) return [];

    const { cellIds, getFillColor } = this.props;
    const count = cellIds.length;

    return [
      new SolidPolygonLayer(
        this.getSubLayerProps({
          id: 'cells',
          data: {
            length: count,
            startIndices: indexes,
            attributes: {
              getPolygon: { value: coords, size: 2 },
              indices: { value: triangles, size: 1 },
              getFillColor: {
                value: expandArrayBuffer(getFillColor, VERTS_PER_CELL, 4),
                size: 4,
                normalized: true
              }
            }
          },
          _normalize: false
        })
      )
    ];
  }
}

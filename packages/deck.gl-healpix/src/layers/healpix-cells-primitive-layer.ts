import {
  DefaultProps,
  Layer,
  LayerContext,
  picking,
  project32,
  UpdateParameters
} from '@deck.gl/core';
import type { RenderPass, Texture } from '@luma.gl/core';
import type { ShaderModule } from '@luma.gl/shadertools';
import { Geometry, Model } from '@luma.gl/engine';
import { HEALPIX_FRAGMENT_SHADER, HEALPIX_VERTEX_SHADER } from '../shaders';
import {
  computeHealpixCellsUniforms,
  healpixCellsShaderModule
} from '../shaders/healpix-cells-shader-module';
import { healpixColorShaderModule } from '../shaders/healpix-color-shader-module';
import { healpixFilterShaderModule } from '../shaders/healpix-filter-shader-module';
import { healpixRescaleShaderModule } from '../shaders/healpix-rescale-shader-module';
import { healpixValuesShaderModule } from '../shaders/healpix-values-shader-module';

/** Props for the GPU-instanced HEALPix cell primitive layer. */
export type HealpixCellsPrimitiveLayerProps = {
  nside: number;
  scheme: 'nest' | 'ring';
  instanceCount: number;
};

type HealpixColorPipelineProps = {
  valuesTexture: Texture;
  colorMapTexture: Texture;
  uFilterMin: number;
  uFilterMax: number;
  uRescaleMin: number;
  uRescaleMax: number;
  uDimensions: number;
  uColorMode: number;
  uValuesWidth: number;
  uTexelsPerCell: number;
  shaderModules?: ShaderModule[];
};

type HealpixCellsPrimitiveLayerMergedProps = HealpixCellsPrimitiveLayerProps &
  HealpixColorPipelineProps;

const defaultProps: DefaultProps<HealpixCellsPrimitiveLayerProps> = {
  nside: { type: 'number', value: 1 },
  // @ts-expect-error deck.gl DefaultProps has no 'string' type.
  scheme: { type: 'string', value: 'nest' },
  instanceCount: { type: 'number', value: 0 }
};

/** Indexed quad template: two triangles, four corner vertices per instance. */
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
const QUAD_POSITIONS = new Float32Array(12);

/**
 * Registers the custom HEALPix shader hooks (`HEALPIX_SELECT_VALUES`,
 * `HEALPIX_RESCALE_VALUES`) on the layer context's `ShaderAssembler` so that
 * user-supplied shader modules can inject GLSL into the pipeline. Hooks are
 * registered unconditionally on every `initializeState`; luma.gl deduplicates
 * by hook name, so re-registration is safe across layer remounts (e.g. React
 * StrictMode) and across multiple HEALPix layer instances.
 */
function registerHealpixPipelineHooks(context: LayerContext): void {
  context.shaderAssembler.addShaderHook(
    'fs:HEALPIX_SELECT_VALUES(inout vec4 selectedValues, FragmentGeometry geometry)'
  );
  context.shaderAssembler.addShaderHook(
    'fs:HEALPIX_RESCALE_VALUES(inout vec4 selectedValues, FragmentGeometry geometry)'
  );
}

export class HealpixCellsPrimitiveLayer extends Layer<HealpixCellsPrimitiveLayerMergedProps> {
  static layerName = 'HealpixCellsPrimitiveLayer';
  static defaultProps = defaultProps;

  declare state: { model: Model | null };

  getNumInstances(): number {
    return this.props.instanceCount;
  }

  getShaders(): ReturnType<Layer['getShaders']> {
    return super.getShaders({
      vs: HEALPIX_VERTEX_SHADER,
      fs: HEALPIX_FRAGMENT_SHADER,
      modules: [
        project32,
        picking,
        healpixCellsShaderModule,
        healpixValuesShaderModule,
        healpixFilterShaderModule,
        healpixRescaleShaderModule,
        healpixColorShaderModule,
        ...(this.props.shaderModules ?? [])
      ]
    });
  }

  initializeState(context: LayerContext): void {
    registerHealpixPipelineHooks(context);

    this.getAttributeManager()!.addInstanced({
      cellIdLo: { size: 1, type: 'uint32', noAlloc: true },
      cellIdHi: { size: 1, type: 'uint32', noAlloc: true },
      healpixCellIndex: {
        size: 1,
        type: 'float32',
        stepMode: 'instance',
        accessor: 'healpixCellIndex',
        defaultValue: 0,
        noAlloc: true
      }
    });
  }

  updateState(params: UpdateParameters<HealpixCellsPrimitiveLayer>): void {
    super.updateState(params);
    const shaderModulesChanged =
      params.props.shaderModules !== params.oldProps?.shaderModules;
    if (
      params.changeFlags.extensionsChanged ||
      shaderModulesChanged ||
      !this.state.model
    ) {
      this.state.model?.destroy();
      this.state.model = this._getModel();
      this.getAttributeManager()!.invalidateAll();
    }
  }

  finalizeState(context: LayerContext): void {
    super.finalizeState(context);
    this.state.model?.destroy();
  }

  draw(opts: { renderPass: RenderPass }): void {
    const { renderPass } = opts;
    const { model } = this.state;
    if (!model || this.props.instanceCount === 0) return;

    model.shaderInputs.setProps({
      healpixCells: computeHealpixCellsUniforms(
        this.props.nside,
        this.props.scheme
      ),
      healpixValues: {
        uDimensions: this.props.uDimensions,
        uColorMode: this.props.uColorMode,
        uValuesWidth: this.props.uValuesWidth,
        uTexelsPerCell: this.props.uTexelsPerCell,
        healpixValuesTexture: this.props.valuesTexture
      },
      healpixFilter: {
        uFilterMin: this.props.uFilterMin,
        uFilterMax: this.props.uFilterMax
      },
      healpixRescale: {
        uRescaleMin: this.props.uRescaleMin,
        uRescaleMax: this.props.uRescaleMax
      },
      healpixColor: {
        healpixColorMapTexture: this.props.colorMapTexture
      }
    });
    model.setInstanceCount(this.props.instanceCount);
    model.draw(renderPass);
  }

  private _getModel(): Model {
    const parameters =
      this.context.device.type === 'webgpu'
        ? {
            depthWriteEnabled: true,
            depthCompare: 'less-equal' as const
          }
        : undefined;

    return new Model(this.context.device, {
      ...this.getShaders(),
      id: `${this.props.id}-model`,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-list',
        attributes: {
          indices: QUAD_INDICES,
          positions: { size: 3, value: QUAD_POSITIONS }
        }
      }),
      isInstanced: true,
      parameters
    });
  }
}

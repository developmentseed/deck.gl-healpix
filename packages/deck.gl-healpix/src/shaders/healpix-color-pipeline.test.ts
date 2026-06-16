import { HEALPIX_CELLS_FS } from './healpix-cells.fs.glsl';
import { HEALPIX_CELLS_VS_MAIN } from './healpix-cells.vs.glsl';
import { healpixColorShaderModule } from './healpix-color-shader-module';
import { healpixFilterShaderModule } from './healpix-filter-shader-module';
import { healpixRescaleShaderModule } from './healpix-rescale-shader-module';
import { healpixValuesShaderModule } from './healpix-values-shader-module';

function injectionSource(
  injection: string | { injection: string; order: number } | undefined
): string {
  return typeof injection === 'string'
    ? injection
    : (injection?.injection ?? '');
}

describe('HEALPix color pipeline shader modules', () => {
  it('modules inject stages rather than exporting pipeline functions', () => {
    expect(healpixValuesShaderModule.inject).toHaveProperty(
      'fs:DECKGL_FILTER_COLOR'
    );
    expect(healpixFilterShaderModule.inject).toHaveProperty(
      'fs:DECKGL_FILTER_COLOR'
    );
    expect(healpixRescaleShaderModule.inject).toHaveProperty(
      'fs:DECKGL_FILTER_COLOR'
    );
    expect(healpixColorShaderModule.inject).toHaveProperty(
      'fs:DECKGL_FILTER_COLOR'
    );

    expect(healpixValuesShaderModule.fs).toContain('healpixValueAt');
    expect(healpixValuesShaderModule.fs).toContain('healpixSelectedValues');
    expect(healpixValuesShaderModule.fs).toContain('uTexelsPerCell');
    expect(healpixValuesShaderModule.fs).toContain('healpixColorMode');
    expect(
      injectionSource(
        healpixValuesShaderModule.inject?.['fs:DECKGL_FILTER_COLOR']
      )
    ).toContain('HEALPIX_SELECT_VALUES');
    expect(
      injectionSource(
        healpixRescaleShaderModule.inject?.['fs:DECKGL_FILTER_COLOR']
      )
    ).toContain('HEALPIX_RESCALE_VALUES');
    expect(healpixColorShaderModule.fs).not.toContain('healpixApplyColor');
  });

  it('uses colorMode for interpretation and dimensions for raw value access', () => {
    expect(healpixValuesShaderModule.fs).toContain('int texel = channel / 4;');
    expect(healpixValuesShaderModule.fs).toContain(
      'healpixCell * healpixValues.uTexelsPerCell + texel'
    );
    expect(
      healpixFilterShaderModule.inject?.['fs:DECKGL_FILTER_COLOR']
    ).toEqual(
      expect.objectContaining({
        injection: expect.stringContaining('HEALPIX_COLOR_MODE_SCALAR')
      })
    );
    expect(
      injectionSource(
        healpixColorShaderModule.inject?.['fs:DECKGL_FILTER_COLOR']
      )
    ).toContain('healpixColorMode == HEALPIX_COLOR_MODE_RGBA');
  });

  it('orders built-in deck hook injections before default user injections', () => {
    const builtInOrders = [
      healpixValuesShaderModule.inject?.['fs:DECKGL_FILTER_COLOR'],
      healpixFilterShaderModule.inject?.['fs:DECKGL_FILTER_COLOR'],
      healpixRescaleShaderModule.inject?.['fs:DECKGL_FILTER_COLOR'],
      healpixColorShaderModule.inject?.['fs:DECKGL_FILTER_COLOR']
    ].map((injection) =>
      typeof injection === 'string' ? 0 : (injection?.order ?? 0)
    );

    expect(builtInOrders).toEqual([-40, -30, -20, -10]);
    expect(Math.max(...builtInOrders)).toBeLessThan(0);
  });

  it('passes cell index from vertex to fragment shader', () => {
    expect(HEALPIX_CELLS_VS_MAIN).toContain('in float healpixCellIndex;');
    expect(HEALPIX_CELLS_VS_MAIN).toContain('out float vHealpixCellIndex;');
    expect(HEALPIX_CELLS_VS_MAIN).toContain(
      'vHealpixCellIndex = healpixCellIndex;'
    );
  });

  it('keeps the fragment shader as the hook host', () => {
    expect(HEALPIX_CELLS_FS).toContain(
      'DECKGL_FILTER_COLOR(fragColor, geometry);'
    );
    expect(HEALPIX_CELLS_FS).not.toContain('healpixApplyColor');
    expect(HEALPIX_CELLS_FS).not.toContain('healpixDiscardIfFiltered');
  });
});

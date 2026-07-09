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

/** Round a JS double to the nearest IEEE-754 binary16, as GLSL `mediump`. */
function toFp16(x: number): number {
  const f = new Float32Array([x]);
  const bits = new Uint32Array(f.buffer)[0];
  const sign = (bits >> 16) & 0x8000;
  const exp = ((bits >> 23) & 0xff) - 112;
  const mant = bits & 0x7fffff;
  if (exp <= 0) return sign ? -0 : 0;
  if (exp >= 31) return sign ? -Infinity : Infinity;
  const half = sign | (exp << 10) | (mant >> 13);
  const hs = half & 0x8000 ? -1 : 1;
  const he = (half >> 10) & 0x1f;
  const hm = half & 0x3ff;
  return hs * Math.pow(2, he - 15) * (1 + hm / 1024);
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

  it('rounds the scalar value to the nearest LUT slot (not truncate)', () => {
    // The scalar branches must use `int(x * 255.0 + 0.5)`. Plain
    // `int(x * 255.0)` truncates toward zero, which shifts integer-indexed
    // LUTs to the previous slot under fp16 (mediump) rounding — the
    // "white shows as black on Windows" bug.
    const src = injectionSource(
      healpixColorShaderModule.inject?.['fs:DECKGL_FILTER_COLOR']
    );
    const scalarLookups = src.match(/healpixSelectedValues\.x \* 255\.0[^)]*/g);
    expect(scalarLookups).not.toBeNull();
    // Both HEALPIX_COLOR_MODE_SCALAR and _SCALAR_ALPHA branches.
    expect(scalarLookups).toHaveLength(2);
    for (const lookup of scalarLookups ?? []) {
      expect(lookup).toContain('+ 0.5');
    }
  });

  it('recovers every integer LUT index through the fp16 shader round-trip', () => {
    // Emulate the scalar-mode index math the shader performs at mediump for a
    // 256-entry LUT addressed by integer values (e.g. paint palette indices),
    // rescaled with min=0, max=255: idx = int(fp16(v / 255) * 255 + 0.5).
    for (let v = 0; v <= 255; v++) {
      const rescaled = toFp16(v / 255);
      const slot = Math.trunc(toFp16(rescaled * 255) + 0.5);
      expect(slot).toBe(v);
    }
  });

  it('keeps the fragment shader as the hook host', () => {
    expect(HEALPIX_CELLS_FS).toContain(
      'DECKGL_FILTER_COLOR(fragColor, geometry);'
    );
    expect(HEALPIX_CELLS_FS).not.toContain('healpixApplyColor');
    expect(HEALPIX_CELLS_FS).not.toContain('healpixDiscardIfFiltered');
  });
});

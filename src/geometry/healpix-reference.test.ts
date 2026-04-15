// src/geometry/healpix-reference.test.ts
import { cornersNestLonLat, cornersRingLonLat } from 'healpix-ts';
import { nestCornerLonLat, ringCornerLonLat } from './healpix-reference';

const NSIDE_LIST = [1, 2, 4, 16, 512, 8192, 262144];

describe('nestCornerLonLat', () => {
  for (const nside of NSIDE_LIST) {
    it(`matches healpix-ts for nside=${nside}, first 5 cells, all 4 corners`, () => {
      const maxCell = Math.min(4, 12 * nside * nside - 1);
      for (let cellId = 0; cellId <= maxCell; cellId++) {
        const ref = cornersNestLonLat(nside, cellId); // [[lon,lat], ...]
        for (let corner = 0; corner < 4; corner++) {
          const [lon, lat] = nestCornerLonLat(nside, cellId, corner);
          expect(lon).toBeCloseTo(ref[corner][0], 6);
          expect(lat).toBeCloseTo(ref[corner][1], 6);
        }
      }
    });
  }
});

describe('ringCornerLonLat', () => {
  for (const nside of [1, 2, 4, 16, 512, 8192]) {
    it(`matches healpix-ts ring corners for nside=${nside}, first 5 cells`, () => {
      const maxCell = Math.min(4, 12 * nside * nside - 1);
      for (let cellId = 0; cellId <= maxCell; cellId++) {
        const ref = cornersRingLonLat(nside, cellId);
        for (let corner = 0; corner < 4; corner++) {
          const [lon, lat] = ringCornerLonLat(nside, cellId, corner);
          expect(lon).toBeCloseTo(ref[corner][0], 6);
          expect(lat).toBeCloseTo(ref[corner][1], 6);
        }
      }
    });
  }
});

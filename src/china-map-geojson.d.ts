declare module 'china-map-geojson/lib/china.js' {
  import type { FeatureCollection, Geometry } from 'geojson';

  const ChinaData: FeatureCollection<Geometry, {
    id?: string;
    name: string;
    cp?: [number, number];
  }>;
  export default ChinaData;
}

# Devon local evidence pilot

Static pilot at `/devon/`, using the existing GitHub Pages hosting. No paid
services, API keys, application server or database are required. The current
Explorer and its register ratings are unchanged.

## Evidence

- **Flood:** on-demand browser queries to EA's ArcGIS-hosted
  `RiskOfFloodingFromRiversAndSea/FeatureServer/0`. Exact item:
  https://www.arcgis.com/home/item.html?id=11ed3046a3df48b3af56048fbcd4b12a
  Data last edited 6 June 2024, as reported by the service. This is an older
  product, not a claim to display the latest national assessment. OGL v3;
  attribution, including OS and CEH notices, is displayed on the page.
  Point queries use original service geometry; map queries round to six decimal
  places. Map counts are checked against results; more than 1,500 features or
  incomplete responses require a closer zoom or show an unavailable message.
  Source availability is not guaranteed. Surface water is not included.
- **Heat:** NASA POWER `T2M_MAX`, MERRA-2 native grid, 0.5° latitude by 0.625°
  longitude. Twelve cell centres cover the pilot window. `heat-source-*.json`
  retain the complete API responses; `heat.json` contains daily values, maximum
  temperature, days ≥25°C, exact request URLs and retrieval time. Each cell must
  have all 92 days from 1 June–31 August 2022. No interpolation. This is regional
  historical outdoor heat, not granular urban heat, HadUK-Grid or a forecast.
  NASA's reuse guidance explicitly includes commercial applications with
  acknowledgement: https://forum.earthdata.nasa.gov/viewtopic.php?t=82
- **Wildfire:** stored EFFIS `fuel_map` image and original legend. Capabilities
  describe this as version 2017; do not use retrieval time as the map date.
  The WMS image is requested in EPSG:3857 for alignment with Leaflet and cropped
  to `[-4.7,50.15,-2.85,51.35]`. Display opacity is reduced; classifications are
  unchanged. Raw layer metadata is retained in `wildfire-metadata.xml` and exact
  requests in `wildfire-source.json`. Underlying analytical resolution is not
  established. A fuel map is contextual vegetation evidence, not validated
  susceptibility, fire weather, a live warning or a household risk score.
  EFFIS EU-owned content: CC BY 4.0 unless separately indicated; no additional
  third-party restriction was found in this layer's metadata.
  https://forest-fire.emergency.copernicus.eu/about-effis/data-license

The software MIT licence does not replace source dataset terms.

## Geographic and privacy scope

Postcodes.io county code `E10000008` (Devon) and unitary district codes
`E06000026` (Plymouth), `E06000027` (Torbay) are accepted within the map window.
No inference from postcode prefixes. Example locations are approximate named
points. Map clicks can inspect any point within the bounding window, including
neighbouring land and sea; this is explicitly not a Devon boundary.

The page stores no searches, URL coordinates or postcode history and loads no
analytics. Postcodes.io receives submitted postcodes. ArcGIS receives selected
point coordinates and flood-map bounds. OpenStreetMap supplies background tiles;
unpkg supplies Leaflet. All receive ordinary connection information. Stored heat
and fuel data require no runtime requests to NASA or EFFIS. A map-library failure
does not prevent example/postcode point queries or heat summaries.

## Refresh and verification

From the repository root, with network access:

```sh
python3 tools/fetch_devon_sample.py
python3 tools/validate.py
python3 tests/browser_checks.py
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://localhost:8000/devon/`. To refresh only the EFFIS assets:
`python3 tools/fetch_devon_sample.py --wildfire-only`.

Requests to NASA are sequential, one per grid cell. Refresh to a different
period requires updating both processing and visible methodology. Review
licences on refresh; do not silently replace the flood product with a different
schema. Review refreshed files before publishing. No background refresh runs.

## Deliberate limitations

No combined risk score, property risk determination, climate projection,
surface-water assessment or wildfire probability. Missing evidence does not
indicate low risk. All results retain source-specific meaning. The pilot is
intended to establish whether a richer Explorer is useful before investment in
the proposed platform or finer heat/fire evidence.

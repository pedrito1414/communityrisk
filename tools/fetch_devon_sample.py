#!/usr/bin/env python3
"""Refresh the small, public Devon evidence sample (standard library only).

No credentials. NASA requests are sequential and one per native grid cell.
Run explicitly; the website never requests NASA data itself.
"""
import datetime
import math
import sys
import json
from pathlib import Path
import urllib.parse
import urllib.request

OUT = Path(__file__).resolve().parents[1] / 'data' / 'devon'


def fetch(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        return response.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if '--wildfire-only' in sys.argv:
        fetch_wildfire()
        return
    cells = []
    for lat in (50.0, 50.5, 51.0, 51.5):
        for lon in (-4.375, -3.75, -3.125):
            query = urllib.parse.urlencode(dict(parameters='T2M_MAX', community='AG',
                longitude=lon, latitude=lat, start='20220601', end='20220831', format='JSON'))
            url = 'https://power.larc.nasa.gov/api/temporal/daily/point?' + query
            raw = fetch(url)
            data = json.loads(raw)
            daily = data['properties']['parameter']['T2M_MAX']
            valid = {date: value for date, value in daily.items()
                     if isinstance(value, (int, float)) and value != data['header']['fill_value']}
            if len(valid) != 92:
                raise ValueError(f'Incomplete summer at {lon}, {lat}: {len(valid)}/92 days')
            cells.append(dict(lon=lon, lat=lat, bounds=[lon-.3125, lat-.25, lon+.3125, lat+.25],
                maximum_c=max(valid.values()), days_ge_25=sum(v >= 25 for v in valid.values()),
                valid_days=len(valid), daily=valid, source_url=url))
            (OUT / f'heat-source-{lat}-{lon}.json').write_bytes(raw)
            print(f'Heat {lon}, {lat}: {max(valid.values())} C', flush=True)
    result = dict(retrieved=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        period=['2022-06-01', '2022-08-31'], resolution='0.5° latitude × 0.625° longitude (MERRA-2)',
        acknowledgement='NASA Langley Research Center POWER Project, funded through the NASA Earth Science/Applied Science Program.',
        cells=cells)
    (OUT / 'heat.json').write_text(json.dumps(result, separators=(',', ':')) + '\n')
    fetch_wildfire()


def fetch_wildfire():
    # Use the map projection to preserve image alignment.
    def project(lon, lat):
        return (6378137 * math.radians(lon), 6378137 * math.log(math.tan(math.pi/4 + math.radians(lat)/2)))
    projected = (*project(-4.7,50.15), *project(-2.85,51.35))
    base = 'https://maps.effis.emergency.copernicus.eu/effis?'
    params = dict(service='WMS', version='1.1.1', request='GetMap', layers='fuel_map',
        styles='', srs='EPSG:3857', bbox=','.join(map(str,projected)), width=1100,
        height=900, format='image/png', transparent='true')
    urls = {'wildfire-fuels.png': base + urllib.parse.urlencode(params),
        'wildfire-fuels-legend.png': base + urllib.parse.urlencode(dict(service='WMS',
            version='1.1.1', request='GetLegendGraphic', layer='fuel_map', format='image/png'))}
    for name, url in urls.items():
        image = fetch(url)
        if not image.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError(f'Expected PNG for {name}: {image[:300]!r}')
        (OUT / name).write_bytes(image)
        print(name, len(image), flush=True)
    (OUT / 'wildfire-source.json').write_text(json.dumps(dict(
        retrieved=datetime.datetime.now(datetime.timezone.utc).isoformat(), bounds=[-4.7,50.15,-2.85,51.35],
        urls=urls, layer='fuel_map', version='2017', image_crs='EPSG:3857', licence='https://forest-fire.emergency.copernicus.eu/about-effis/data-license'), indent=2)+'\n')

    (OUT / 'wildfire-metadata.xml').write_bytes(fetch(base + 'language=eng&request=GetMetadata&layer=fuel_map'))


if __name__ == '__main__':
    main()

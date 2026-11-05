#!/usr/bin/env python3
"""Validate the shared static site without third-party dependencies."""
import csv
import json
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
def read(name):
    return json.loads((ROOT / 'data' / name).read_text())

def validate():
    forums, risks, national, matches, boundaries = (read(n) for n in ['forums.json', 'local-risks.json', 'national-risks.json', 'risk-matches.json', 'boundaries.geojson'])
    def unique(records, key):
        values = [r[key] for r in records]
        assert len(values) == len(set(values)), f'Duplicate {key}'
        assert all(values), f'Empty {key}'
        return set(values)
    codes = unique(forums, 'code'); ids = unique(risks, 'id'); nids = unique(national, 'national_id')
    assert codes == unique([f['properties'] for f in boundaries['features']], 'code'), 'Forum/boundary mismatch'
    names = {f['code']: f['name'] for f in forums}
    for f in forums:
        assert f['coverage'] in ['summary', 'detailed']
        assert urlsplit(f['source_url']).scheme == 'https'
        assert urlsplit(f['website_url']).scheme in ['http', 'https']
        assert f['website_kind'] in ['website', 'risk-information', 'pdf']
    for feature in boundaries['features']:
        assert feature['properties']['name'] == names[feature['properties']['code']]
        geometry = feature['geometry']
        assert geometry['type'] in ['Polygon', 'MultiPolygon']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for polygon in polygons:
            for ring in polygon:
                assert len(ring) >= 4 and ring[0] == ring[-1], 'Invalid polygon ring'
    for risk in risks:
        assert risk['forum_code'] in codes
        for field in ['likelihood', 'impact', 'visualRating']:
            if risk.get(field) is not None:
                assert isinstance(risk[field], (int, float)) and 1 <= risk[field] <= 5, f'Invalid {field}: {risk["id"]}'
    assert {m['local_id'] for m in matches} == ids, 'Missing or extra matches'
    pairs = [(m['local_id'], m['national_id']) for m in matches]
    assert len(pairs) == len(set(pairs)), 'Duplicate local/national link'
    by_id = {r['id']: r for r in risks}
    for match in matches:
        risk = by_id[match['local_id']]
        assert match['forum_code'] == risk['forum_code']
        assert match['local_risk'] == risk['name']
        assert match['lrf'] == names[match['forum_code']]
        assert not match['national_id'] or match['national_id'] in nids
        assert match['match_status'] in ['Direct', 'Candidate', 'Broad / multiple', 'Review / unmatched']
        if match['match_status'] == 'Direct': assert match['national_id']
    with (ROOT / 'data/risk-matches.csv').open(newline='') as source:
        reader = csv.DictReader(source)
        expected = [{key: str(m.get(key, '')) for key in reader.fieldnames} for m in matches]
        assert list(reader) == expected, 'CSV download differs from JSON'

    definitions = read('risk-definitions.json')
    for source in definitions['sources'].values():
        assert urlsplit(source['url']).scheme == 'https'
        assert source['title'] and source['edition']
    for kind, valid_ids in [('local', ids), ('national', nids)]:
        assert set(definitions[kind]).issubset(valid_ids), f'Unknown {kind} definition ID'
        for definition_id, definition in definitions[kind].items():
            assert definition['text'].strip() and definition['format'] == 'summary'
            assert definition['source_id'] in definitions['sources']
            source = definitions['sources'][definition['source_id']]
            if kind == 'local':
                risk = next(r for r in risks if r['id'] == definition_id)
                assert source['forum_code'] == risk['forum_code'], 'Local definition attributed to another forum'
                assert source['checked_at']
            if source.get('type', 'pdf') == 'pdf':
                assert isinstance(definition.get('pdf_page'), int) and definition['pdf_page'] > 0
            else:
                assert source['type'] == 'web' and definition.get('section', '').strip()
                assert 'pdf_page' not in definition
    for match in matches:
        if match['forum_code'].startswith('S43'):
            assert match['national_id'] and match.get('rationale', '').strip()
            assert match.get('reviewed_at') == '2026-11-04'
            local = definitions['local'][match['local_id']]
            assert match['local_source_id'] == local['source_id']
            assert int(match['local_pdf_page']) == local['pdf_page']
            national_record = next(n for n in national if n['national_id'] == match['national_id'])
            assert int(match['national_pdf_page']) == national_record['pdf_page']
            assert match['match_status'] in ['Direct', 'Broad / multiple']
    for topic in definitions['topics'].values():
        assert topic['text'].strip() and topic['national_ids']
        assert all(nid in definitions['national'] for nid in topic['national_ids'])
    for local_id, related in definitions['related'].items():
        assert local_id in ids
        if 'topic_id' in related: assert related['topic_id'] in definitions['topics']
        else: assert related['national_ids'] and all(nid in definitions['national'] for nid in related['national_ids'])
    covered = set(definitions['local']) | set(definitions['related']) | {m['local_id'] for m in matches if m['match_status']=='Direct' and m['national_id'] in definitions['national']}
    print(f'Definitions: {len(definitions["local"])} local summaries, {len(definitions["national"])} national summaries; {len(covered)}/{len(risks)} local entries have definitions or labelled national background.')

    class Links(HTMLParser):
        def handle_starttag(self, tag, attrs):
            for name, value in attrs:
                if name not in ['src', 'href'] or not value: continue
                parsed = urlsplit(value)
                if parsed.scheme or parsed.netloc or not parsed.path: continue
                target = (self.path.parent / unquote(parsed.path)).resolve()
                assert target.is_relative_to(ROOT), f'Link escapes site: {value}'
                assert target.exists(), f'Missing local file: {self.path}: {value}'
                if target.is_dir(): assert (target / 'index.html').exists(), f'Missing index: {value}'
    for path in ROOT.rglob('*.html'):
        parser = Links(); parser.path = path; parser.feed(path.read_text())
    print(f'Validated {len(forums)} forums, {len(risks)} risks, {len(national)} national risks, {len(matches)} matches, boundaries and page links.')

if __name__ == '__main__': validate()

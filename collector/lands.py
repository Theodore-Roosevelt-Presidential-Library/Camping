#!/usr/bin/env python3
"""Build the land-status layers for the Camping tools (standard library only).

Writes, into docs/data/:
  lands.json  - public land polygons around Medora, one class per feature (GeoJSON)
  sites.json  - developed Forest Service recreation sites (points); the widget draws the
                quarter-mile no-camping zone around each one
  roads.json  - National Forest System roads (reference only; the Motor Vehicle Use Map
                is the official word on which roads are open)
  meta.json   - when each source was read and how many features came back

Land that is in none of these layers is shown as "private or unknown".

Privacy: the state trust land service also carries lessee names, phone numbers and
email addresses. Only the tract number, legal description and public-access status are
requested. Nothing about any person is stored.

Usage:  python collector/lands.py
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'data')

# Coverage: the Little Missouri National Grassland (Medora and McKenzie ranger districts)
# and the three units of Theodore Roosevelt National Park, North Dakota side only.
BBOX = (-104.05, 46.0, -102.75, 48.1)  # west, south, east, north

# Named areas outside the main box that the guide also covers.
EXTRA_AREAS = [
    {'key': 'schnell', 'name': 'Schnell Recreation Area', 'bbox': (-102.36, 46.84, -102.12, 46.95)},  # BLM, near Richardton
]
COUNTY_BBOX = (-104.05, 46.0, -102.2, 48.1)  # wide enough for the extra areas

UA = 'TRPL-Camping-Collector/1.0 (+https://camping.labs.trlibrary.com)'
USFS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW'
PADUS = 'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0'
TRUST = 'https://ndgishub.nd.gov/arcgis/rest/services/Applications/SLD_TrustlandMinerals/MapServer/1'

DIGITS = 5  # about one metre


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get_json(url, params, tries=4):
    q = urllib.parse.urlencode(params)
    full = url + '?' + q
    for i in range(tries):
        try:
            req = urllib.request.Request(full, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read().decode('utf-8')
            d = json.loads(body)
            if isinstance(d, dict) and d.get('error'):
                raise RuntimeError(json.dumps(d['error'])[:300])
            return d
        except Exception as e:  # noqa: BLE001
            log('  retry', i + 1, 'after', type(e).__name__, str(e)[:200])
            time.sleep(5 * (i + 1))
    raise RuntimeError('failed: ' + full[:300])


def envelope(box=None):
    w, s, e, n = box or BBOX
    return json.dumps({'xmin': w, 'ymin': s, 'xmax': e, 'ymax': n, 'spatialReference': {'wkid': 4326}})


def query_all(layer, where, fields, offset_deg, page=1000, box=None):
    """Every feature intersecting BBOX, as GeoJSON features, paging by object id order."""
    feats, start = [], 0
    while True:
        params = {
            'where': where, 'outFields': fields, 'returnGeometry': 'true',
            'geometry': envelope(box), 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
            'spatialRel': 'esriSpatialRelIntersects', 'outSR': 4326, 'f': 'geojson',
            'resultOffset': start, 'resultRecordCount': page, 'orderByFields': 'OBJECTID',
        }
        if offset_deg:
            params['maxAllowableOffset'] = offset_deg
        d = get_json(layer + '/query', params)
        got = d.get('features', [])
        feats.extend(got)
        log('  ', layer.split('/services/')[-1][:60], 'offset', start, '+', len(got))
        if len(got) < page and not d.get('exceededTransferLimit') and not (d.get('properties') or {}).get('exceededTransferLimit'):
            break
        if not got:
            break
        start += len(got)
    return feats


# ---------- geometry helpers ----------

def clip_ring(ring, box=None):
    """Sutherland-Hodgman clip of one ring to a box (BBOX by default). Returns [] if nothing is left."""
    w, s, e, n = box or BBOX
    def clip(points, inside, cross):
        out = []
        if not points:
            return out
        prev = points[-1]
        for cur in points:
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
            prev = cur
        return out
    def x_at(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return [x, a[1] + t * (b[1] - a[1])]
    def y_at(a, b, y):
        t = (y - a[1]) / (b[1] - a[1])
        return [a[0] + t * (b[0] - a[0]), y]
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring[:]
    pts = clip(pts, lambda p: p[0] >= w, lambda a, b: x_at(a, b, w))
    pts = clip(pts, lambda p: p[0] <= e, lambda a, b: x_at(a, b, e))
    pts = clip(pts, lambda p: p[1] >= s, lambda a, b: y_at(a, b, s))
    pts = clip(pts, lambda p: p[1] <= n, lambda a, b: y_at(a, b, n))
    if len(pts) < 3:
        return []
    return pts + [pts[0]]


def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a / 2.0


def rnd(ring):
    out = []
    for x, y in ring:
        p = [round(x, DIGITS), round(y, DIGITS)]
        if not out or p != out[-1]:
            out.append(p)
    return out


def polygons_of(geom):
    if not geom:
        return []
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def clean_polygons(geom, min_area=1e-8, box=None):
    """Clip to a box (BBOX by default), round, drop slivers. Returns a list of polygons (lists of rings)."""
    out = []
    for poly in polygons_of(geom):
        rings = []
        for k, ring in enumerate(poly):
            c = rnd(clip_ring([list(map(float, p[:2])) for p in ring], box))
            if len(c) < 4 or abs(ring_area(c)) < min_area:
                if k == 0:
                    rings = []
                    break
                continue
            rings.append(c)
        if rings:
            out.append(rings)
    return out


def feature(polys, props):
    geom = {'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': polys}
    return {'type': 'Feature', 'properties': props, 'geometry': geom}


# ---------- sources ----------

def forest_service_land():
    log('Forest Service land (surface ownership parcels)')
    feats = query_all(USFS + '/EDW_SurfaceOwnership_01/MapServer/0',
                      "ownerclassification='USDA FOREST SERVICE'", 'nfslandunitname', 0.00003, page=1000)
    out = []
    for f in feats:
        polys = clean_polygons(f.get('geometry'))
        if polys:
            name = (f.get('properties') or {}).get('nfslandunitname') or 'Little Missouri National Grassland'
            out.append(feature(polys, {'c': 'usfs', 'n': name}))
    return out


def trust_land():
    log('State school trust land (ND Department of Trust Lands surface tracts)')
    feats = query_all(TRUST, '1=1', 'OBJECTID,TRACT_ID,COUNTY,TWP,RNG,SEC,SUBDIVISION,PUBLIC_ACCESS', 0.00003, page=1000)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        polys = clean_polygons(f.get('geometry'))
        if not polys:
            continue
        access = (p.get('PUBLIC_ACCESS') or '').strip()
        legal = 'Sec. %s, T%sN, R%sW' % (p.get('SEC'), p.get('TWP'), p.get('RNG')) if p.get('SEC') else ''
        out.append(feature(polys, {
            'c': 'trust', 'n': 'State school trust land', 'a': access,
            'l': legal, 'q': (p.get('SUBDIVISION') or '').strip(), 'k': (p.get('COUNTY') or '').strip().title(),
        }))
    return out


# PAD-US managers kept, and the class each becomes.
PADUS_CLASS = {'NPS': 'nps', 'BLM': 'blm', 'SFW': 'wma', 'SPR': 'park', 'USACE': 'usace', 'USBR': 'usbr', 'FWS': 'fws'}


def other_public_land():
    log('Other public land (PAD-US 4.1 fee layer)')
    managers = ",".join("'%s'" % m for m in PADUS_CLASS)
    feats = query_all(PADUS, "State_Nm='ND' AND Mang_Name IN (%s)" % managers,
                      'OBJECTID,Mang_Name,Unit_Nm,Des_Tp,Pub_Access', 0.0002, page=500)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        polys = clean_polygons(f.get('geometry'), min_area=1e-7)
        if not polys:
            continue
        cls = PADUS_CLASS.get(p.get('Mang_Name'))
        name = (p.get('Unit_Nm') or '').strip()
        if cls == 'blm':
            name = 'Bureau of Land Management'
        out.append(feature(polys, {'c': cls, 'n': name, 'd': p.get('Des_Tp') or ''}))
    return out


def extra_areas():
    """Named areas outside the main box (for now, BLM's Schnell Recreation Area near Richardton)."""
    out = []
    for a in EXTRA_AREAS:
        log('Extra area:', a['name'])
        feats = query_all(PADUS, "State_Nm='ND' AND Mang_Name='BLM'", 'OBJECTID,Mang_Name,Unit_Nm', 0.00005, page=50, box=a['bbox'])
        for f in feats:
            polys = clean_polygons(f.get('geometry'), min_area=1e-7, box=a['bbox'])
            if polys:
                out.append(feature(polys, {'c': 'blm', 'n': a['name'], 'x': a['key']}))
    return out


BIA_LAR = 'https://biamaps.geoplatform.gov/server/rest/services/DivLTR/BIA_AIAN_National_LAR/MapServer/0'


def tribal_land():
    """Reservation boundaries (BIA Land Area Representations). The widget keeps these switched
    off until the wording is approved; see TRIBAL in docs/camping.js."""
    log('Reservation boundaries (BIA LAR)')
    try:
        feats = query_all(BIA_LAR, '1=1', 'OBJECTID,LARNAME', 0.0003, page=50)
    except Exception as e:  # noqa: BLE001
        log('  skipped:', e)
        return []
    out = []
    for f in feats:
        polys = clean_polygons(f.get('geometry'), min_area=1e-6)
        if polys:
            name = (f.get('properties') or {}).get('LARNAME') or ''
            out.append(feature(polys, {'c': 'tribal', 'n': (name + ' Reservation').strip()}))
    return out


def grassland_boundary():
    """The administrative boundary of the national grassland, for context: inside it,
    unshaded land is private or state land."""
    log('Grassland administrative boundary')
    try:
        layer = USFS + '/EDW_ForestSystemBoundaries_01/MapServer/0'
        feats = query_all(layer, "forestname LIKE '%Dakota Prairie%'", 'forestname', 0.0005, page=50)
    except Exception as e:  # noqa: BLE001
        log('  skipped:', e)
        return []
    out = []
    for f in feats:
        polys = clean_polygons(f.get('geometry'), min_area=1e-6)
        if polys:
            out.append(feature(polys, {'c': 'boundary', 'n': 'Dakota Prairie Grasslands boundary'}))
    return out


SITE_TYPES_BUFFERED = {'CAMPGROUND', 'TRAILHEAD', 'DAY USE AREA', 'PICNIC SITE', 'BOATING SITE',
                       'BOAT RAMP', 'FISHING SITE', 'INTERPRETIVE SITE', 'OBSERVATION SITE', 'GROUP CAMPGROUND',
                       'HORSE CAMP', 'OTHER RECREATION CONCENTRATION AREA'}


NAME_FIXES = {'Coc Campground': 'CCC Campground', 'Coal Creek Mdh Ii': 'Coal Creek Campground',
              'Bennet': 'Bennett Trailhead', 'Sather Lake Day Use': 'Sather Lake Day Use Area'}


def tidy_name(name, site_type):
    if name.isupper():
        name = ' '.join(w if w in ('CCC', 'MDH', 'II') else w.capitalize() for w in name.split())
    else:
        name = ' '.join(w.capitalize() if w.islower() and w not in ('of', 'in', 'the', 'and') else w for w in name.split())
    name = NAME_FIXES.get(name, name)
    if site_type == 'TRAILHEAD' and 'trailhead' not in name.lower():
        name += ' Trailhead'
    return name


def rec_sites():
    log('Developed recreation sites')
    feats = query_all(USFS + '/EDW_RecInfraRecreationSites_02/MapServer/0', '1=1',
                      'OBJECTID,site_name,public_site_name,site_type,development_scale,fee_charged,usda_portal_url',
                      None, page=1000)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        t = (p.get('site_type') or '').upper()
        name = tidy_name((p.get('public_site_name') or p.get('site_name') or '').strip(), t)
        try:
            scale = int(p.get('development_scale') or 0)
        except ValueError:
            scale = 0
        # Day-use areas are developed sites even when the record carries no development scale.
        buffered = t in SITE_TYPES_BUFFERED and (scale >= 2 or t == 'DAY USE AREA')
        x, y = g['coordinates'][:2]
        out.append({'type': 'Feature', 'properties': {
            'n': name, 't': t.title(), 'b': 1 if buffered else 0, 'u': p.get('usda_portal_url') or '',
        }, 'geometry': {'type': 'Point', 'coordinates': [round(x, DIGITS), round(y, DIGITS)]}})
    return out


def roads():
    log('National Forest System roads')
    out = []
    for lyr, status in ((0, 'open'), (1, 'closed')):
        try:
            feats = query_all(USFS + '/EDW_RoadBasic_01/MapServer/%d' % lyr, '1=1',
                              'OBJECTID,id,name,oper_maint_level,surface_type', 0.0001, page=1000)
        except Exception as e:  # noqa: BLE001
            log('  layer', lyr, 'skipped:', e)
            continue
        for f in feats:
            p = f.get('properties') or {}
            g = f.get('geometry') or {}
            lines = g['coordinates'] if g.get('type') == 'MultiLineString' else [g.get('coordinates')] if g.get('type') == 'LineString' else []
            lines = [rnd([list(map(float, pt[:2])) for pt in ln]) for ln in lines if ln]
            lines = [ln for ln in lines if len(ln) >= 2]
            if not lines:
                continue
            lvl = (p.get('oper_maint_level') or '')[:1]
            out.append({'type': 'Feature', 'properties': {
                'n': p.get('id') or p.get('name') or '', 'm': lvl, 's': status,
            }, 'geometry': {'type': 'MultiLineString', 'coordinates': lines} if len(lines) > 1 else {'type': 'LineString', 'coordinates': lines[0]}})
    return out


COUNTIES = 'https://services1.arcgis.com/qQaNyq8h4wNEdlUV/arcgis/rest/services/FireDangerIndex_Public/FeatureServer/0'


def counties():
    """County outlines, so a tapped spot can be matched to that county's burn restrictions."""
    log('County outlines (ND fire danger layer)')
    feats = query_all(COUNTIES, '1=1', 'OBJECTID,NAME', 0.002, page=100, box=COUNTY_BBOX)
    out = []
    for f in feats:
        polys = clean_polygons(f.get('geometry'), min_area=1e-5, box=COUNTY_BBOX)
        if polys:
            out.append(feature(polys, {'n': (f.get('properties') or {}).get('NAME')}))
    return out


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path, 'w') as fh:
        json.dump(obj, fh, separators=(',', ':'))
    log('wrote', name, round(os.path.getsize(path) / 1024), 'KB')


def main():
    os.makedirs(OUT, exist_ok=True)
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    meta = {'built': now, 'bbox': BBOX, 'extra': EXTRA_AREAS, 'sources': {}}

    layers = []
    for key, fn, label in (
        ('usfs', forest_service_land, 'USDA Forest Service, Surface Ownership (EDW)'),
        ('trust', trust_land, 'ND Department of Trust Lands, Surface Tracts (ND GIS Hub)'),
        ('padus', other_public_land, 'USGS Protected Areas Database of the U.S. (PAD-US) 4.1, Fee'),
        ('boundary', grassland_boundary, 'USDA Forest Service, Administrative Forest Boundaries (EDW)'),
        ('extra', extra_areas, 'USGS PAD-US 4.1 (BLM), named areas outside the main box'),
        ('tribal', tribal_land, 'Bureau of Indian Affairs, Land Area Representations'),
    ):
        feats = fn()
        if key in ('usfs', 'trust', 'padus') and not feats:
            raise SystemExit('No features from %s; keeping the previous files.' % label)
        layers.extend(feats)
        meta['sources'][key] = {'label': label, 'features': len(feats), 'read': now}

    write('lands.json', {'type': 'FeatureCollection', 'features': layers})

    sites = rec_sites()
    meta['sources']['sites'] = {'label': 'USDA Forest Service, Recreation Sites (EDW)', 'features': len(sites), 'read': now}
    write('sites.json', {'type': 'FeatureCollection', 'features': sites})

    rd = roads()
    meta['sources']['roads'] = {'label': 'USDA Forest Service, National Forest System Roads (EDW)', 'features': len(rd), 'read': now}
    write('roads.json', {'type': 'FeatureCollection', 'features': rd})

    cty = counties()
    meta['sources']['counties'] = {'label': 'ND Department of Emergency Services, county fire danger areas', 'features': len(cty), 'read': now}
    write('counties.json', {'type': 'FeatureCollection', 'features': cty})

    write('meta.json', meta)


if __name__ == '__main__':
    main()

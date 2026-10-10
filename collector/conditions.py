#!/usr/bin/env python3
"""Snapshot of today's camping conditions around Medora (standard library only).

Writes docs/data/conditions.json. The widget reads the same sources live when it can and
falls back to this snapshot (for example when someone opens the saved map with no signal).

  fire      North Dakota fire danger index (today and six days out) and the burn
            restrictions in force for each county, the Little Missouri National Grassland,
            and BLM land (ND Department of Emergency Services, burnrestrictions.nd.gov)
  orders    Alerts and orders posted by the Dakota Prairie Grasslands
  weather   National Weather Service watches, warnings and advisories for the area
  rain      Rain and snow in the last three days and the next three (Open-Meteo)

Usage:  python collector/conditions.py
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'data', 'conditions.json')
UA = 'TRPL-Camping-Collector/1.0 (+https://camping.labs.trlibrary.com)'

DES = 'https://services1.arcgis.com/qQaNyq8h4wNEdlUV/arcgis/rest/services'
COUNTIES = ['Billings', 'Golden Valley', 'McKenzie', 'Slope', 'Stark', 'Dunn', 'Bowman']
NWS_ZONES = 'NDC007,NDC033,NDC053,NDC087,NDC089,NDC025,NDC011'
DPG_ALERTS = 'https://www.fs.usda.gov/r01/dpg/alerts'
PLACES = [('Medora', 46.914, -103.524), ('North Unit / Watford City', 47.59, -103.27), ('Southern grassland (Amidon)', 46.62, -103.45)]
LEVELS = ['', 'Low', 'Moderate', 'High', 'Very High', 'Extreme']


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url, params=None, as_json=True, tries=3):
    full = url + ('?' + urllib.parse.urlencode(params) if params else '')
    for i in range(tries):
        try:
            req = urllib.request.Request(full, headers={'User-Agent': UA, 'Accept': 'application/geo+json, application/json, text/html'})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode('utf-8', 'replace')
            return json.loads(body) if as_json else body
        except Exception as e:  # noqa: BLE001
            log('  retry', i + 1, url[:80], type(e).__name__, str(e)[:120])
            time.sleep(4 * (i + 1))
    return None


def ms_to_iso(ms):
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except (TypeError, ValueError):
        return None


def fire():
    out = {'danger': [], 'restrictions': [], 'published': None}
    where = 'NAME IN (%s)' % ','.join("'%s'" % c for c in COUNTIES)
    d = fetch(DES + '/FireDangerIndex_Public/FeatureServer/0/query',
              {'where': where, 'outFields': 'NAME,FireIndex,day1,day2,day3,day4,day5,day6,DatePublished', 'returnGeometry': 'false', 'f': 'json'})
    for f in (d or {}).get('features', []):
        a = f['attributes']
        out['danger'].append({'county': a['NAME'], 'today': a.get('FireIndex'),
                              'days': [a.get('day%d' % i) for i in range(1, 7)]})
        out['published'] = ms_to_iso(a.get('DatePublished')) or out['published']
    out['danger'].sort(key=lambda r: COUNTIES.index(r['county']) if r['county'] in COUNTIES else 99)

    fields = ('county,Label,Jurisdiction_Type,declaration_status,campfires_conditions,campfires_red_checkbox,'
              'camp_conditions,camp_red_checkbox,FireIndex,burn_expiration_date,banincludedcities_v1,remove')
    d = fetch(DES + '/Fire_Decs_Indexes_Warnings_Template_Publish/FeatureServer/0/query',
              {'where': "remove<>'Yes'", 'outFields': fields, 'returnGeometry': 'false', 'f': 'json'})
    seen = set()
    for f in (d or {}).get('features', []):
        a = f['attributes']
        name = (a.get('county') or '').strip()
        kind = None
        if a.get('Jurisdiction_Type') == 'County FDR' and name.replace(' County', '') in COUNTIES:
            kind, key = 'county', name.replace(' County', '')
        elif name.startswith('USFS Little Missouri'):
            kind, key = 'usfs', 'McKenzie District' if 'McKenzie' in name else 'Medora District'
        elif name.startswith('BLM Lands within') and name.replace('BLM Lands within ', '').replace(' County', '') in COUNTIES:
            kind, key = 'blm', name.replace('BLM Lands within ', '').replace(' County', '')
        if not kind or (kind, key) in seen:
            continue
        seen.add((kind, key))
        out['restrictions'].append({
            'kind': kind, 'name': key,
            'declared': a.get('declaration_status') == 'Yes',
            'campfires_at': a.get('campfires_conditions') if a.get('campfires_conditions') in LEVELS[1:] else None,
            'campfires_flag': a.get('campfires_red_checkbox') == 'Yes',
            'camping_at': a.get('camp_conditions') if a.get('camp_conditions') in LEVELS[1:] else None,
            'index': a.get('FireIndex'),
            'expires': ms_to_iso(a.get('burn_expiration_date')),
            'note': (a.get('banincludedcities_v1') or '').strip()[:400] if kind == 'county' else '',
        })
    return out


SKIP_ORDERS = re.compile(r'South Dakota|Grand River|Cedar River|Sheyenne', re.I)


def orders():
    page = fetch(DPG_ALERTS, as_json=False)
    if not page:
        return None
    found, seen = [], set()
    for m in re.finditer(r'href="(/r01/dpg/alerts/[^"#?]+)"[^>]*>(.*?)</a>', page, re.S):
        url, title = m.group(1), html.unescape(re.sub(r'<[^>]+>|\s+', ' ', m.group(2))).strip()
        if not title or SKIP_ORDERS.search(title):
            continue
        # The listing shows a short summary and dates right after each title.
        tail = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', page[m.end():m.end() + 2500])))
        nxt = tail.find('Alert Start Date')
        summary = tail[:nxt].strip() if nxt > 0 else ''
        start = re.search(r'Alert Start Date:\s*([A-Z][a-z]+ \d{1,2}, \d{4})', tail)
        end = re.search(r'Alert End Date:\s*([A-Z][a-z]+ \d{1,2}, \d{4})', tail[:600])
        num = re.search(r'([0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2})', title) or (re.search(r'Forest Order:[^0-9]{0,30}([0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2})', tail[nxt:nxt + 160]) if nxt > 0 else None)
        found.append({'title': title, 'url': 'https://www.fs.usda.gov' + url, 'summary': summary[:320],
                      'start': start.group(1) if start else None, 'end': end.group(1) if end else None,
                      'order': num.group(1) if num else None})
    # A title can appear more than once on the page (menus, featured blocks); keep the
    # fullest copy of each, in first-seen order.
    best = {}
    for o in found:
        key = o['url']
        score = bool(o['summary']) + bool(o['start']) + bool(o['order'])
        if key not in best or score > best[key][0]:
            best[key] = (score, o)
    order = []
    for o in found:
        if o['url'] not in seen:
            seen.add(o['url'])
            order.append(best[o['url']][1])
    return order


def flags(order_list):
    titles = ' '.join(o['title'] for o in (order_list or []))
    return {
        'offroad_closed': bool(re.search(r'Vehicles? Off[- ]Road', titles, re.I)),
        'fire_order': bool(re.search(r'Little Missouri.*Fire (Restriction|Closure)', titles, re.I)),
    }


def weather():
    d = fetch('https://api.weather.gov/alerts/active', {'zone': NWS_ZONES})
    if d is None:
        return None
    out = []
    for f in d.get('features', []):
        p = f.get('properties', {})
        out.append({'event': p.get('event'), 'severity': p.get('severity'), 'headline': p.get('headline'),
                    'ends': p.get('ends') or p.get('expires'), 'area': p.get('areaDesc')})
    return out


def rain():
    d = fetch('https://api.open-meteo.com/v1/forecast', {
        'latitude': ','.join(str(p[1]) for p in PLACES), 'longitude': ','.join(str(p[2]) for p in PLACES),
        'daily': 'precipitation_sum,snowfall_sum,precipitation_probability_max', 'past_days': 3, 'forecast_days': 4,
        'timezone': 'America/Denver', 'precipitation_unit': 'inch'})
    if d is None:
        return None
    if isinstance(d, dict):
        d = [d]
    out = []
    for (name, _, _), x in zip(PLACES, d):
        days = x['daily']
        p = days['precipitation_sum']
        out.append({'place': name, 'dates': days['time'], 'precip': p, 'snow': days.get('snowfall_sum'),
                    'chance': days.get('precipitation_probability_max'),
                    'past3': round(sum(v or 0 for v in p[:3]), 2), 'next3': round(sum(v or 0 for v in p[4:7]), 2)})
    return out


def main():
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT))
        except ValueError:
            prev = {}
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    data = {'built': now}
    for key, fn in (('fire', fire), ('orders', orders), ('weather', weather), ('rain', rain)):
        log(key)
        try:
            val = fn()
        except Exception as e:  # noqa: BLE001
            log('  failed:', e)
            val = None
        if val is None or (key == 'fire' and not val.get('danger')):
            val = prev.get(key)  # keep the last good reading rather than blanking it
            data.setdefault('stale', []).append(key)
        data[key] = val
    data['flags'] = flags(data.get('orders'))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as fh:
        json.dump(data, fh, indent=1)
    log('wrote conditions.json', os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()

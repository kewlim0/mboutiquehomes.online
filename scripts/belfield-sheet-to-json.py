#!/usr/bin/env python3
"""Turns the downloaded owner-contact workbook (File > Download > Microsoft Excel) into the JSON that scripts/import-upcoming.js reads:
    python3 scripts/belfield-sheet-to-json.py ~/Downloads/<workbook>.xlsx private-files/import/upcoming.json
Tabs read: SEND, 2R (03 & 03A), 4R (07 & 10), BIG UNIT. One row per unit; the same unit on several tabs is merged.
Uses only the standard library. The output holds real owner data, so it stays in private-files/ (never committed or deployed)."""
import json, re, sys, zipfile, calendar
from decimal import Decimal
import xml.etree.ElementTree as ET
from datetime import date, timedelta

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
UNIT_RE = re.compile(r'\b([ABC])-(\d{1,2})-(\d{2}A?)\b', re.I)
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})


def col_index(ref):
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_workbook(path):
    """{sheet name: [[cell text, ...], ...]}"""
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    out = {}
    for sh in ET.fromstring(z.read('xl/workbook.xml')).find('m:sheets', NS):
        target = rels[sh.get('{%s}id' % NS['r'])].lstrip('/')
        xml = ET.fromstring(z.read(target if target.startswith('xl/') else 'xl/' + target))
        rows = []
        for row in xml.iter('{%s}row' % NS['m']):
            cells = {}
            for c in row.findall('m:c', NS):
                t = c.get('t'); v = c.find('m:v', NS)
                if t == 's' and v is not None:
                    val = shared[int(v.text)]
                elif t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                elif v is not None:
                    val = v.text or ''
                    if re.fullmatch(r'-?\d+(\.\d+)?[eE][+-]?\d+', val):          # a phone number saved as a number: 6.0176877219E10
                        d = Decimal(val)
                        val = str(int(d)) if d == d.to_integral_value() else val
                    elif re.fullmatch(r'-?\d+\.0', val):
                        val = val[:-2]
                else:
                    val = ''
                cells[col_index(c.get('r'))] = val.strip()
            if cells:
                rows.append([cells.get(i, '') for i in range(max(cells) + 1)])
        out[sh.get('name')] = rows
    return out


def end_of_month(y, m):
    return date(y, m, calendar.monthrange(y, m)[1])


def find_date(txt):
    """The tenancy end date written in a note ("Tenancy end October 2027", "15 Aug 2027", "15/8/2027"); None when there is none."""
    t = txt.lower()
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', t)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r'(\d{1,2})[/.](\d{1,2})[/.](\d{4})', t)
    if m and 1 <= int(m[2]) <= 12:
        return date(int(m[3]), int(m[2]), min(int(m[1]), calendar.monthrange(int(m[3]), int(m[2]))[1]))
    m = re.search(r'(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})', t)
    if m:
        mo = MONTHS[m[2]]
        return date(int(m[3]), mo, min(int(m[1]), calendar.monthrange(int(m[3]), mo)[1]))
    m = re.search(r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(?:of\s+)?(\d{4})', t)
    if m:
        return end_of_month(int(m[2]), MONTHS[m[1]])
    m = re.search(r'(\d{4})\s*,?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*', t)      # "2028 December"
    if m:
        return end_of_month(int(m[1]), MONTHS[m[2]])
    return None


def classify(notes, status_col):
    txt = f'{notes} {status_col}'.lower()
    if re.search(r'own\s?-?stay|owner\s?-?stay|self\s?-?stay|自住', txt):
        status = 'own'
    elif re.search(r'\bsale\b|\bsell\b|for sale|selling|出售|想卖', txt):
        status = 'sale'
    elif re.search(r'tenan|\brent(ed|al)?\b|\blease', txt) or find_date(txt):
        status = 'tenant'
    elif re.search(r"cannot\s+(be\s+)?reach|can'?t\s+(be\s+)?reach|no\s+pick|no\s+answer|busy\s+line|not\s+in\s+service|out\s+of\s+service|wrong\s+number|unreachable|not\s+reachable|switch(ed)?\s+off|disconnected", txt):
        status = 'noanswer'
    else:
        status = 'none'
    end = find_date(txt) if status in ('tenant', 'sale', 'own') else None
    return status, end


def clean_name(name, unit_text):
    name = UNIT_RE.sub('', name)
    name = re.sub(r'(RESIDENSI\s+)?SUNWAY\s+BELFIELD', '', name, flags=re.I)
    return re.sub(r'\s+', ' ', name).strip(' -,')


def norm_unit(text):
    m = UNIT_RE.search(text or '')
    return f'{m[1].upper()}-{int(m[2]):02d}-{m[3].upper()}' if m else None


def clean_phone(p):
    """Returns (phone, repaired). A number saved as a number loses its leading 0 (a mobile 012... becomes 12...), so it is put back;
    6012... / +44... style international numbers are kept as they are."""
    raw = (p or '').strip()
    d = re.sub(r'[\s\-()]', '', raw)
    if raw.startswith('-') or not re.fullmatch(r'\+?\d+', d):
        return '', False
    plus, digits = d.startswith('+'), d.lstrip('+')
    if plus or digits.startswith('0'):
        return d, False
    if digits.startswith('60') and 11 <= len(digits) <= 12:   # 6012-345 6789 -> 012-345 6789 (one way of writing Malaysian numbers)
        return '0' + digits[2:], False
    if re.fullmatch(r'1\d{8,9}', digits):                  # mobile that lost its 0: 12-345 6789 -> 012-345 6789
        return '0' + digits, False
    if re.fullmatch(r'3\d{8}', digits):                    # landline that lost its 0: 3-5639 9333 -> 03-5639 9333
        return '0' + digits, False
    if re.fullmatch(r'[4-9]\d{7}', digits):                # 8 digits: the area code is a guess (Klang Valley 03), so it is flagged
        return '03' + digits, True
    if 9 <= len(digits) <= 15:                             # other country codes (44..., 65...)
        return '+' + digits, False
    return '', False


def sheet_rows(rows):
    """Yield dicts using the header row: No / Name / Premises Address / Telephone / Type / Status, everything else is a note."""
    head_i = next((i for i, r in enumerate(rows) if any(c.strip().lower() == 'name' for c in r)), None)
    if head_i is None:
        return
    head = [c.strip().lower() for c in rows[head_i]]
    def find(prefix):
        return next((i for i, h in enumerate(head) if h.startswith(prefix)), None)
    ci = {'name': find('name'), 'addr': find('premises'), 'tel': find('tel'), 'type': find('type'), 'status': find('status')}
    known = {v for v in ci.values() if v is not None} | {find('no')}
    for r in rows[head_i + 1:]:
        get = lambda k: r[ci[k]].strip() if ci[k] is not None and ci[k] < len(r) else ''
        extra = [c.strip() for i, c in enumerate(r) if i not in known and i < 12 and c.strip()]
        unit = norm_unit(get('addr')) or norm_unit(get('name'))
        if not unit:
            continue
        yield {'unit': unit, 'name': clean_name(get('name'), unit), 'phone': get('tel'), 'type': get('type'), 'status': get('status'), 'notes': '\n'.join(extra)}


# Sunway Belfield Residence floor plan: the unit-number ending decides the type
TYPE_BY_SUFFIX = {'03': 'A1', '03A': 'A2', '08': 'B', '09': 'B', '01': 'C', '06': 'C', '02': 'D', '05': 'D', '07': 'E', '10': 'E'}


def main(src, dst):
    book = read_workbook(src)
    def tab(*keys):
        for name, rows in book.items():
            if all(k in name.lower().replace(' ', '') for k in keys):
                return rows
        return []
    tabs = [('BIG', tab('big')), ('2R', tab('2r')), ('4R', tab('4r')), ('SEND', tab('send'))]
    owners = {}
    for line, rows in tabs:
        for r in sheet_rows(rows):
            o = owners.setdefault(r['unit'], {'unit': r['unit'], 'name': '', 'phone': '', 'type': '', 'status_col': '', 'notes': [], 'line': ''})
            o['name'] = o['name'] or r['name']
            o['phone'] = o['phone'] or r['phone']
            o['type'] = o['type'] or r['type']
            o['status_col'] = o['status_col'] or r['status']
            if r['notes'] and r['notes'].lower() not in [x.lower() for x in o['notes']]:
                o['notes'].append(r['notes'])
            if line in ('2R', '4R') or not o['line']:
                o['line'] = line if line != 'SEND' else o['line']
    out = []
    for o in owners.values():
        notes = '\n'.join(o['notes'])
        status, end = classify(notes, o['status_col'])
        phone, repaired = clean_phone(o['phone'])
        if o['phone'].strip() and not phone:        # a number the spreadsheet mangled: kept in the notes instead of guessing
            notes = (notes + '\n' if notes else '') + f'原表格的电话：{o["phone"]}'
        elif repaired:
            notes = (notes + '\n' if notes else '') + f'电话是自动补全的，请核对（原表格：{o["phone"]}）'
        t = o['type'].upper().replace(' ', '')
        t = t if t in ('C', 'D', 'E', 'F', 'C/E', 'D/F') else ''
        note = '\n'.join(x for x in [o['status_col'] if o['status_col'] and o['status_col'].lower() not in notes.lower() else '', notes] if x)
        nxt = (end - timedelta(days=60)).isoformat() if end and status == 'tenant' else None
        suffix = o['unit'].split('-')[2]
        out.append({'unit': o['unit'], 'name': o['name'], 'phone': phone, 'type': TYPE_BY_SUFFIX.get(suffix, ''),
                    'line': '2R' if suffix in ('03', '03A') else '4R' if suffix in ('07', '10') else 'BIG',
                    'status': status, 'tenancyEnd': end.isoformat() if end else None, 'nextFollowup': nxt, 'note': note})
    out.sort(key=lambda x: x['unit'])
    json.dump(out, open(dst, 'w'), ensure_ascii=False, indent=0)
    by = {}
    for x in out:
        by[x['status']] = by.get(x['status'], 0) + 1
    print(f'{len(out)} units  ·  by status: {by}  ·  with tenancy end date: {sum(1 for x in out if x["tenancyEnd"])}  ·  without phone: {sum(1 for x in out if not x["phone"])}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: belfield-sheet-to-json.py <workbook.xlsx> <out.json>')
    main(*sys.argv[1:])

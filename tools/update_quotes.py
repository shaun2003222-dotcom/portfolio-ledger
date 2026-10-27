#!/usr/bin/env python3
"""台股最近交易日收盤行情更新器：TWSE OpenAPI + 官方 MI_INDEX 備援 + TPEx。

使用：python tools/update_quotes.py
可以安裝 truststore，在 Windows 使用作業系統的 HTTPS 信任鏈：
python -m pip install --upgrade truststore

不關閉憑證驗證、不猜測未發布行情，不以較舊資料覆蓋較新資料。
"""
from __future__ import annotations

import html
import json
import math
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import truststore
except ImportError:
    truststore = None

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'quotes' / 'market.json'
TAIPEI_TZ = timezone(timedelta(hours=8))
TWSE_OPENAPI = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
TWSE_DAILY = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'
TPEX_OPENAPI = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
MIN_ROWS = {'TWSE': 80, 'TPEX': 80}
UA = 'Mozilla/5.0 (compatible; PortfolioLedger/1.1; daily-official-close)'


def clean_number(value):
    if value is None or isinstance(value, bool):
        return None
    s = html.unescape(str(value)).strip()
    s = re.sub(r'<[^>]*>', '', s).replace(',', '').replace('\u2212', '-').strip()
    if not s or s in ('-', '--', '---', 'X', '除權', '除息'):
        return None
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def price(value):
    n = clean_number(value)
    return n if n is not None and n > 0 else None


def iso_date(value):
    s = str(value or '').strip().replace('/', '').replace('-', '')
    if not s.isdigit():
        return None
    if len(s) == 7:  # 1151027 -> 2026-10-27
        year, month, day = int(s[:3]) + 1911, int(s[3:5]), int(s[5:7])
    elif len(s) == 8:  # 20261027
        year, month, day = int(s[:4]), int(s[4:6]), int(s[6:8])
    else:
        return None
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None


def download_json(url):
    req = urllib.request.Request(url, headers={
        'Accept': 'application/json',
        'User-Agent': UA,
        'Cache-Control': 'no-cache',
    })
    # 只啟用受信任的憑證鏈；不使用 verify=False / unverified_context。
    ctx = (truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
           if truststore is not None else ssl.create_default_context())
    with urllib.request.urlopen(req, timeout=35, context=ctx) as res:
        payload = res.read(28 * 1024 * 1024)
    try:
        obj = json.loads(payload.decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('伺服器未傳回有效 JSON（可能是網站防護或暫時錯誤）') from exc
    return obj


def parse_openapi(market, rows):
    if not isinstance(rows, list) or len(rows) < MIN_ROWS[market]:
        raise ValueError('OpenAPI 回應資料量不足或格式不符')
    parsed = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        if market == 'TWSE':
            code = str(row.get('Code', '')).strip().upper()
            name = str(row.get('Name', '')).strip()
            close = price(row.get('ClosingPrice'))
            day = iso_date(row.get('Date'))
            change = clean_number(row.get('Change'))
        else:
            code = str(row.get('SecuritiesCompanyCode', '')).strip().upper()
            name = str(row.get('CompanyName', '')).strip()
            close = price(row.get('Close'))
            day = iso_date(row.get('Date'))
            change = clean_number(row.get('Change'))
        if re.fullmatch(r'[0-9A-Z]{4,12}', code) and close and day:
            parsed[f'{market}:{code}'] = {'name': name, 'price': close,
                                          'date': day, 'change': change}
    if len(parsed) < MIN_ROWS[market]:
        raise ValueError(f'{market} 實際可用報價僅 {len(parsed)} 筆，拒絕覆蓋原資料')
    day = max(p['date'] for p in parsed.values())
    # 只收錄相同交易日的成交價格，避免把更早的股票成交日期混進本期行情。
    parsed = {k: v for k, v in parsed.items() if v['date'] == day}
    if len(parsed) < MIN_ROWS[market]:
        raise ValueError(f'{market} 同交易日可用報價不足')
    return parsed, day


def parse_mi_index(response, requested):
    if not isinstance(response, dict) or str(response.get('stat', '')).strip().upper() != 'OK':
        raise ValueError(f"官方盤後表尚未發布（stat={response.get('stat') if isinstance(response, dict) else '?'}）")
    day = iso_date(response.get('date'))
    if day != requested:
        raise ValueError(f'盤後資料日期不符：查詢 {requested}，回傳 {day or "未提供"}')
    parsed = {}
    for table in response.get('tables', []):
        if not isinstance(table, dict):
            continue
        fields = [re.sub(r'\s+', '', str(c)) for c in table.get('fields', [])]
        if not {'證券代號', '收盤價'}.issubset(fields):
            continue
        symbol_col = fields.index('證券代號')
        price_col = fields.index('收盤價')
        name_col = fields.index('證券名稱') if '證券名稱' in fields else None
        change_col = next((fields.index(c) for c in ('漲跌價差', '漲跌價', '漲跌') if c in fields), None)
        sign_col = next((fields.index(c) for c in ('漲跌(+/-)', '漲跌(+／-)', '漲跌符號') if c in fields), None)
        for row in table.get('data', []):
            if not isinstance(row, (list, tuple)) or len(row) <= max(symbol_col, price_col):
                continue
            code = re.sub(r'<[^>]*>', '', str(row[symbol_col])).strip().upper()
            close = price(row[price_col])
            if not re.fullmatch(r'[0-9A-Z]{4,12}', code) or close is None:
                continue
            name = re.sub(r'<[^>]*>', '', str(row[name_col])).strip() if name_col is not None and len(row) > name_col else ''
            change = clean_number(row[change_col]) if change_col is not None and len(row) > change_col else None
            if sign_col is not None and len(row) > sign_col and change is not None:
                sign = html.unescape(re.sub(r'<[^>]*>', '', str(row[sign_col]))).strip()
                if '-' in sign or '－' in sign or '跌' in sign:
                    change = -abs(change)
                elif '+' in sign or '＋' in sign or '漲' in sign:
                    change = abs(change)
            parsed[f'TWSE:{code}'] = {'name': name, 'price': close,
                                       'date': day, 'change': change}
    if len(parsed) < MIN_ROWS['TWSE']:
        raise ValueError(f'MI_INDEX 可用上市報價僅 {len(parsed)} 筆')
    return parsed, day


def newer_mi_index(primary_day, now):
    """只補抓比 OpenAPI 新的交易日；非交易日／未公告日不視為錯誤。"""
    # 當天收盤資料通常下午才陸續發布；收盤前不查詢當天盤後表。
    d = now.date() if (now.hour, now.minute) >= (14, 0) else now.date() - timedelta(days=1)
    failures = []
    for n in range(8):
        requested = (d - timedelta(days=n)).isoformat()
        if primary_day and requested <= primary_day:
            break
        if (d - timedelta(days=n)).weekday() >= 5:
            continue
        url = TWSE_DAILY + '?' + urllib.parse.urlencode({
            'response': 'json', 'date': requested.replace('-', ''), 'type': 'ALLBUT0999'
        })
        try:
            data = download_json(url)
            records, day = parse_mi_index(data, requested)
            return records, day, failures
        except Exception as exc:
            failures.append(f'{requested}: {str(exc)[:120]}')
    return None, None, failures


def update():
    existing = {}
    if TARGET.exists():
        try:
            existing = json.loads(TARGET.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as exc:
            print(f'警告：舊行情檔無法解析：{exc}', file=sys.stderr)
    existing = existing if isinstance(existing, dict) else {}
    old_quotes = existing.get('quotes') if isinstance(existing.get('quotes'), dict) else {}
    old_markets = existing.get('markets') if isinstance(existing.get('markets'), dict) else {}
    quotes, markets = {}, {}
    today = datetime.now(TAIPEI_TZ)
    completed = 0
    for market, url in [('TWSE', TWSE_OPENAPI), ('TPEX', TPEX_OPENAPI)]:
        received, received_day, source = None, None, None
        problems = []
        try:
            received, received_day = parse_openapi(market, download_json(url))
            source = 'TWSE OpenAPI' if market == 'TWSE' else 'TPEx OpenAPI'
            print(f'{market} 原始資料：{len(received)} 檔，日期 {received_day}')
        except Exception as exc:
            problems.append(f'OpenAPI 下載失敗：{exc}')

        if market == 'TWSE':
            # 重要：OpenAPI 成功不代表日期最新。自動比對官網盤後資料。
            backup, backup_day, failures = newer_mi_index(received_day, today)
            if backup is not None and (received_day is None or backup_day > received_day):
                received, received_day, source = backup, backup_day, 'TWSE 官網 MI_INDEX'
                print(f'上市官方備援已更新：{len(received)} 檔，日期 {received_day}')
            elif failures:
                print('上市備援查詢：' + '；'.join(failures[:3]), file=sys.stderr)
                # 因休市或盤後表尚未公布而失敗時，仍可沿用已成功取得的 OpenAPI。

        old_market = old_markets.get(market) if isinstance(old_markets.get(market), dict) else {}
        old_day = iso_date(old_market.get('date'))
        old_set = {k: v for k, v in old_quotes.items() if k.startswith(market + ':')}
        if received is not None and (not old_day or received_day >= old_day):
            quotes.update(received)
            markets[market] = {'date': received_day, 'count': len(received), 'error': None, 'source': source}
            completed += 1
            print(f'{market} 採用 {source}：{received_day}，{len(received)} 檔')
        else:
            quotes.update(old_set)
            if received is not None and old_day and received_day < old_day:
                problems.append(f'資料日期倒退（新來源 {received_day}，原資料 {old_day}）')
            markets[market] = {'date': old_day, 'count': len(old_set),
                               'error': '；'.join(problems)[:250] if problems else '暫無較新的行情',
                               'source': old_market.get('source', '舊檔案')}
            print(f'{market} 保留舊資料：{old_day or "無"}，{len(old_set)} 檔；' + '; '.join(problems), file=sys.stderr)

    # 若同日上櫃比上市新，明確標註上市可能延遲，不假裝上市已是最近交易日。
    if (markets['TWSE'].get('date') and markets['TPEX'].get('date') and
            markets['TWSE']['date'] < markets['TPEX']['date']):
        msg = f"上市資料可能延遲（上市 {markets['TWSE']['date']}、上櫃 {markets['TPEX']['date']}）"
        markets['TWSE']['error'] = msg
        print('注意：' + msg, file=sys.stderr)

    if completed == 0:
        print('上市、上櫃均未取得可用的新行情；未覆寫 quotes/market.json。', file=sys.stderr)
        return 1
    payload = {
        'version': 1,
        'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'markets': markets,
        'quotes': dict(sorted(quotes.items())),
    }
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    tmp = TARGET.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    tmp.replace(TARGET)
    print(f'成功寫入 {TARGET}，{len(quotes)} 檔報價')
    return 0


def main():
    return update()


if __name__ == '__main__':
    sys.exit(main())


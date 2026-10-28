# -*- coding: utf-8 -*-
"""只取 ports 字段，确认 awk 分派与解析正确"""
import json
from playwright.sync_api import sync_playwright
BASE = "http://192.168.1.2"
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_context().new_page()
    pg.goto(BASE + "/cgi-bin/luci/", wait_until="domcontentloaded"); pg.wait_for_timeout(600)
    if pg.query_selector('input[name="luci_password"]'):
        pg.fill('input[name="luci_username"]', "root"); pg.fill('input[name="luci_password"]', "admin123")
        pg.click('button[type="submit"], input[type="submit"]'); pg.wait_for_timeout(2500)
    pg.goto(BASE + "/cgi-bin/luci/admin/quickstart/", wait_until="domcontentloaded"); pg.wait_for_timeout(1200)
    d = pg.evaluate("""async()=>{const r=await fetch('/cgi-bin/luci/admin/home_extra/status',{credentials:'include'});return await r.json();}""")
    print("ports:", json.dumps(d.get("ports"), ensure_ascii=False))
    print("net:", d.get("net"), "temp:", d.get("temp"))
    br.close()

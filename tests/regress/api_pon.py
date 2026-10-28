# -*- coding: utf-8 -*-
"""直接取 /admin/home_extra/status，看 pon 字段是否真的出来（走真实登录会话）"""
import json
from playwright.sync_api import sync_playwright
BASE = "http://192.168.1.2"
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_context().new_page()
    pg.goto(BASE + "/cgi-bin/luci/", wait_until="domcontentloaded"); pg.wait_for_timeout(600)
    if pg.query_selector('input[name="luci_password"]'):
        pg.fill('input[name="luci_username"]', "root"); pg.fill('input[name="luci_password"]', "admin123")
        pg.click('button[type="submit"], input[type="submit"]'); pg.wait_for_timeout(2500)
    pg.goto(BASE + "/cgi-bin/luci/admin/quickstart/", wait_until="domcontentloaded"); pg.wait_for_timeout(1500)
    d = pg.evaluate("""async()=>{const r=await fetch('/cgi-bin/luci/admin/home_extra/status',{credentials:'include'});return await r.json();}""")
    print("keys:", sorted(d.keys()))
    print("pon:", json.dumps(d.get("pon"), ensure_ascii=False))
    print("temp:", d.get("temp"), "load:", d.get("load"), "cpu:", d.get("cpu"))
    br.close()

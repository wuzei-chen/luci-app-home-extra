# -*- coding: utf-8 -*-
"""v20 验收：网口状态卡（LAN1-LAN4：链路状态 / 协商速率 / 实时收发）。

判定要点：
  - 4 格、名字 LAN1..LAN4、在线计数 = up 的口数
  - 在线口带协商速率（如「LAN3 · 1G」），离线口写「未连接」并置灰
  - 收发速率格式为「收 x  发 y」，且不出现 NaN / undefined / Infinity
  - 模块设置面板 7 行，关掉「网口状态」后卡片隐藏、骨架变矮
  - 首屏仍在一屏内；回归 v17 SPA 卸载
用法: py -3.13 tests/_ui_v20.py
"""
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = os.environ.get("XG_BASE", "http://192.168.1.2")
USER, PW = "root", "admin123"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "ui_v20.json")
SHOTS = r"F:/BL/xg040gmd/_shots"

PROBE = r"""()=>{
  const q=s=>document.querySelector(s);
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
  const card=q('#he13-card-ports');
  const cells=[...document.querySelectorAll('#he13-portgrid .he13-pl')].map(c=>({
    k:(c.querySelector('.he13-pl-k')||{}).textContent||'',
    v:(c.querySelector('.he13-pl-v')||{}).textContent||'',
    off:((c.querySelector('.he13-pl-v')||{className:''}).className||'').indexOf('is-off')>=0,
  }));
  return {
    hasCard: !!card, cardRect: r(card),
    cardDisp: card ? getComputedStyle(card).display : null,
    cells: cells,
    sum: (document.getElementById('he13-port-sum')||{}).textContent||null,
    rootH: (r(q('#he13-root'))||{}).h,
    scrollH: document.documentElement.scrollHeight,
    panelRows: [...document.querySelectorAll('#he13-set-list .he13-set-row')]
      .map(x=>((x.querySelector('.he13-set-nm')||{}).textContent||'')),
    path: location.pathname,
    mcW: (r(q('#maincontent'))||{}).w,
  };
}"""


def main():
    os.makedirs(SHOTS, exist_ok=True)
    res, errs = {}, []
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + "/cgi-bin/luci/", wait_until="domcontentloaded")
        pg.wait_for_timeout(600)
        if pg.query_selector('input[name="luci_password"]'):
            pg.fill('input[name="luci_username"]', USER)
            pg.fill('input[name="luci_password"]', PW)
            pg.click('button[type="submit"], input[type="submit"]')
            pg.wait_for_timeout(2500)
        pg.goto(BASE + "/cgi-bin/luci/admin/quickstart/", wait_until="networkidle")
        pg.wait_for_timeout(7000)   # 至少两次 status，速率才有基线
        res["home"] = pg.evaluate(PROBE)
        res["api"] = pg.evaluate(
            """async()=>{const r=await fetch('/cgi-bin/luci/admin/home_extra/status',{credentials:'include'});
               return (await r.json()).ports || null;}""")
        pg.screenshot(path=os.path.join(SHOTS, "v20-home-ports.png"), full_page=True)

        pg.evaluate("()=>document.getElementById('he13-gear').click()")
        pg.wait_for_timeout(600)
        res["panel"] = pg.evaluate(PROBE)
        pg.screenshot(path=os.path.join(SHOTS, "v20-panel-ports.png"))
        pg.evaluate("()=>document.querySelector('#he13-set-list .he13-sw[data-mod=\"ports\"]').click()")
        pg.wait_for_timeout(500)
        res["ports_off"] = pg.evaluate(PROBE)
        pg.evaluate("()=>document.querySelector('#he13-set-list .he13-sw[data-mod=\"ports\"]').click()")
        pg.wait_for_timeout(400)
        pg.evaluate("()=>document.getElementById('he13-set-x').click()")
        pg.wait_for_timeout(300)

        pg.evaluate("""()=>{const a=[...document.querySelectorAll('a')]
            .find(x=>(x.innerText||'').trim()==='网络向导'); if(a) a.click();}""")
        pg.wait_for_timeout(2500)
        res["wizard"] = pg.evaluate(PROBE)

        res["errors"] = errs
        ctx.close()
        br.close()

    h, pa, api = res["home"], res["panel"], res["api"] or []
    cells = h["cells"]
    online = [c for c in cells if not c["off"]]
    off = [c for c in cells if c["off"]]
    bad = [c["v"] for c in cells if re.search(r"NaN|undefined|Infinity|null", c["v"] or "")]
    api_up = [p["name"] for p in api if p.get("up")]
    checks = [
        ("网口卡存在且有高度", h["hasCard"] and (h["cardRect"] or {}).get("h", 0) > 60),
        ("4 个格且名字为 LAN1..LAN4", [c["k"].split(" ")[0] for c in cells] == ["LAN1", "LAN2", "LAN3", "LAN4"]),
        ("在线/离线与后端一致",
         sorted([c["k"].split(" ")[0].lower() for c in online]) == sorted(api_up)),
        ("在线口带协商速率", all("·" in c["k"] for c in online) and len(online) > 0),
        ("离线口显示「未连接」且置灰", all(c["v"] == "未连接" and c["off"] for c in off)),
        ("在线口速率格式为「收 x  发 y」", all(c["v"].startswith("收 ") and " 发 " in c["v"] for c in online)),
        ("速率无 NaN/undefined", not bad),
        ("汇总在线数正确", h["sum"] == f"在线 {len(api_up)} / {len(api)}"),
        ("面板 7 行且含网口状态", "网口状态" in pa["panelRows"] and len(pa["panelRows"]) == 7),
        ("关网口卡 → 隐藏且骨架变矮",
         res["ports_off"]["cardDisp"] == "none" and (res["ports_off"]["rootH"] or 0) < (h["rootH"] or 0)),
        ("首屏仍在一屏内", (h["scrollH"] or 9999) <= 900),
        ("回归：SPA 到向导内容正常",
         res["wizard"]["path"] != "/cgi-bin/luci/admin/quickstart/" and (res["wizard"]["mcW"] or 0) > 600),
        ("无 pageerror", len(errs) == 0),
    ]
    print("\n=== 断言 ===")
    fail = 0
    for name, ok in checks:
        fail += 0 if ok else 1
        print(("PASS  " if ok else "FAIL  ") + name)
    print(f"\n卡片 {h['cardRect']} 骨架 {h['rootH']} scrollH {h['scrollH']} 汇总 {h['sum']}")
    for c in cells:
        print(f"  {c['k']:<14} {c['v']}  off={c['off']}")
    print("后端 ports:", json.dumps(api, ensure_ascii=False))
    res["checks"] = [{"name": n, "ok": bool(o)} for n, o in checks]
    res["fail"] = fail
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"\n{'全部通过' if not fail else str(fail) + ' 条失败'} / {len(checks)}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())

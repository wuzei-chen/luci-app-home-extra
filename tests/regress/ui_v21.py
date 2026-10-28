# -*- coding: utf-8 -*-
"""v21 验收：WAN 出口卡新增 IPv6 三行（地址 / 网关 / 链路本地）。

本机真实情况（实测）：没有全局 IPv6、没有 IPv6 默认路由，只有 eth0 的 fe80:: 链路本地。
所以判据是「缺失要如实说缺失」：
  - IPv6 地址 = 未获取，且置灰 + title 说明上游没下发 RA/PD
  - IPv6 网关 = 无，置灰
  - IPv6 本地 = fe80::…（与后端 ipv6.ll 完全一致，且不置灰）
另外顺带回归：运营商/城市恢复中文（api.ip.sb 挂掉后改的三级兜底要真的生效）。
用法: py -3.13 tests/_ui_v21.py
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ.get("XG_BASE", "http://192.168.1.2")
USER, PW = "root", "admin123"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "ui_v21.json")
SHOTS = r"F:/BL/xg040gmd/_shots"

PROBE = r"""()=>{
  const q=s=>document.querySelector(s);
  const g=id=>{const e=document.getElementById(id); return e?{
    t:e.textContent.trim(), cls:e.className, title:e.getAttribute('title')}:null;};
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
  return {
    v6: g('he13-v6'), v6gw: g('he13-v6gw'), v6ll: g('he13-v6ll'),
    isp: (document.getElementById('he13-isp')||{}).textContent||null,
    ip: (document.getElementById('he13-ip')||{}).textContent||null,
    wanCard: r(q('#he13-card-wan')),
    rootH: (r(q('#he13-root'))||{}).h,
    scrollH: document.documentElement.scrollHeight,
    overflow: (()=>{const m=q('.main-right');return m?m.scrollHeight-m.clientHeight:null;})(),
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
        pg.wait_for_timeout(6500)
        res["home"] = pg.evaluate(PROBE)
        res["api"] = pg.evaluate(
            """async()=>{const r=await fetch('/cgi-bin/luci/admin/home_extra/status',{credentials:'include'});
               const d=await r.json(); return {ipv6:d.ipv6||null, wan:d.wan||null};}""")
        pg.screenshot(path=os.path.join(SHOTS, "v21-wan-ipv6.png"), full_page=True)

        pg.evaluate("""()=>{const a=[...document.querySelectorAll('a')]
            .find(x=>(x.innerText||'').trim()==='网络向导'); if(a) a.click();}""")
        pg.wait_for_timeout(2500)
        res["wizard"] = pg.evaluate(PROBE)

        res["errors"] = errs
        ctx.close()
        br.close()

    h, api = res["home"], res["api"] or {}
    v6 = api.get("ipv6") or {}
    wan = api.get("wan") or {}
    checks = [
        ("三行都在", all(h[k] for k in ("v6", "v6gw", "v6ll"))),
        ("IPv6 地址 = 未获取且置灰",
         h["v6"]["t"] == "未获取" and "is-off" in h["v6"]["cls"]),
        ("缺失时 title 说明原因", "RA/PD" in (h["v6"]["title"] or "")),
        ("IPv6 网关 = 无且置灰", h["v6gw"]["t"] == "无" and "is-off" in h["v6gw"]["cls"]),
        ("IPv6 本地 = 后端链路本地地址",
         v6.get("ll") and h["v6ll"]["t"] == v6["ll"]),
        ("IPv6 本地不置灰", "is-off" not in h["v6ll"]["cls"]),
        ("后端确实没有全局地址", not v6.get("addr")),
        ("运营商恢复中文（兜底生效）",
         bool(wan.get("isp")) and h["isp"] and ("移动" in h["isp"]) and h["ip"] == wan.get("ip")),
        ("卡片变高但首屏不溢出", (h["overflow"] or 0) <= 0),
        ("回归：SPA 到向导内容正常",
         res["wizard"]["path"] != "/cgi-bin/luci/admin/quickstart/" and (res["wizard"]["mcW"] or 0) > 600),
        ("无 pageerror", len(errs) == 0),
    ]
    print("\n=== 断言 ===")
    fail = 0
    for name, ok in checks:
        fail += 0 if ok else 1
        print(("PASS  " if ok else "FAIL  ") + name)
    print(f"\nWAN 卡 {h['wanCard']}  骨架 {h['rootH']}  scrollH {h['scrollH']}  溢出 {h['overflow']}")
    print("行:", {k: (h[k]['t'], h[k]['cls']) for k in ("v6", "v6gw", "v6ll")})
    print("运营商:", h["isp"], "| 出口 IP:", h["ip"])
    print("后端 ipv6:", json.dumps(api.get("ipv6"), ensure_ascii=False),
          " wan:", json.dumps(wan, ensure_ascii=False))
    res["checks"] = [{"name": n, "ok": bool(o)} for n, o in checks]
    res["fail"] = fail
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"\n{'全部通过' if not fail else str(fail) + ' 条失败'} / {len(checks)}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())

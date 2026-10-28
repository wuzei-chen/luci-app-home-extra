# -*- coding: utf-8 -*-
"""v19 验收：PON 光链路卡（数据源 ponctl status --json）。

要点：
  - 卡片 6 格数值与后端 pon 字段一致（当前无光：RX/TX 必须显示"无光"，不是 -40.0 dBm）
  - 状态点 is-bad、状态文案取 lifecycle 的中文映射
  - 模块设置面板多出「PON 光链路」一行且开关能隐藏它
  - 顺带回归 v17 路由卸载（点网络向导后内容正常）
用法: py -3.13 tests/_ui_v19.py
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ.get("XG_BASE", "http://192.168.1.2")
USER, PW = "root", "admin123"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "ui_v19.json")
SHOTS = r"F:/BL/xg040gmd/_shots"

PROBE = r"""()=>{
  const q=s=>document.querySelector(s);
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
  const t=id=>{const e=document.getElementById(id);return e?e.textContent.trim():null;};
  const card=q('#he13-card-pon');
  const mc=q('#maincontent');
  return {
    hasCard: !!card, cardRect: r(card),
    cardDisp: card ? getComputedStyle(card).display : null,
    mode: t('he13-pon-mode'), state: t('he13-pon-state'),
    dot: (q('#he13-pon-dot')||{className:''}).className,
    rx: t('he13-pon-rx'), tx: t('he13-pon-tx'), temp: t('he13-pon-temp'),
    volt: t('he13-pon-volt'), bias: t('he13-pon-bias'), onu: t('he13-pon-onu'),
    rxOff: (q('#he13-pon-rx')||{className:''}).className.indexOf('is-off') >= 0,
    rootH: (r(q('#he13-root'))||{}).h,
    scrollH: document.documentElement.scrollHeight,
    mcW: mc ? Math.round(mc.getBoundingClientRect().width) : null,
    panelRows: [...document.querySelectorAll('#he13-set-list .he13-set-row')].map(x=>
      ((x.querySelector('.he13-set-nm')||{}).textContent||'')),
    path: location.pathname,
    text: (q('#maincontent') ? q('#maincontent').innerText : '').replace(/\s+/g,' ').slice(0,90),
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
        pg.wait_for_timeout(6000)
        res["home"] = pg.evaluate(PROBE)
        res["api"] = pg.evaluate(
            """async()=>{const r=await fetch('/cgi-bin/luci/admin/home_extra/status',{credentials:'include'});
               return (await r.json()).pon || null;}""")
        pg.screenshot(path=os.path.join(SHOTS, "v19-home-pon.png"), full_page=True)

        # 模块面板里应有 PON 一行，关掉应隐藏卡片
        pg.evaluate("()=>document.getElementById('he13-gear').click()")
        pg.wait_for_timeout(600)
        res["panel"] = pg.evaluate(PROBE)
        pg.screenshot(path=os.path.join(SHOTS, "v19-panel-pon.png"))
        pg.evaluate("()=>document.querySelector('#he13-set-list .he13-sw[data-mod=\"pon\"]').click()")
        pg.wait_for_timeout(500)
        res["pon_off"] = pg.evaluate(PROBE)
        pg.evaluate("()=>document.querySelector('#he13-set-list .he13-sw[data-mod=\"pon\"]').click()")
        pg.wait_for_timeout(400)
        pg.evaluate("()=>document.getElementById('he13-set-x').click()")
        pg.wait_for_timeout(300)
        res["pon_on"] = pg.evaluate(PROBE)

        # 回归 v17：SPA 到网络向导
        pg.evaluate("""()=>{const a=[...document.querySelectorAll('a')]
            .find(x=>(x.innerText||'').trim()==='网络向导'); if(a) a.click();}""")
        pg.wait_for_timeout(2500)
        res["wizard"] = pg.evaluate(PROBE)

        res["errors"] = errs
        ctx.close()
        br.close()

    h, api, pa = res["home"], res["api"] or {}, res["panel"]
    checks = [
        ("PON 卡存在且有高度", h["hasCard"] and (h["cardRect"] or {}).get("h", 0) > 80),
        ("面板多出 PON 行", "PON 光链路" in pa["panelRows"] and len(pa["panelRows"]) == 6),
        ("模式 = XGPON", h["mode"] == "XGPON"),
        ("无光时状态 = 未接通光信号", h["state"] == "未接通光信号"),
        ("状态点 is-bad", "is-bad" in (h["dot"] or "")),
        ("RX 显示「无光」而非 -40 dBm", h["rx"] == "无光" and h["rxOff"]),
        ("TX 显示「无光」", h["tx"] == "无光"),
        ("模块温度有值", (h["temp"] or "").endswith("℃")),
        ("电压有值", (h["volt"] or "").endswith("V")),
        ("偏置电流有值", (h["bias"] or "").endswith("mA")),
        ("ONU = O1 初始", h["onu"] == "O1 初始"),
        ("前端数值与后端一致",
         api.get("mode") == "xgpon" and api.get("life") == "wait-optical-signal"
         and api.get("signal") is False and abs((api.get("temp") or 0) - float((h["temp"] or "0").replace(" ℃", "") or 0)) < 1.5),
        # 节点始终在 DOM 里（display:none），所以判据必须是"可见性 + 高度"，不是存在性
        ("关 PON → 卡片隐藏且骨架变矮",
         res["pon_off"]["cardDisp"] == "none" and (res["pon_off"]["rootH"] or 0) < (h["rootH"] or 0)),
        ("再开 PON → 卡片回来", res["pon_on"]["cardDisp"] != "none"),
        ("首屏仍在一屏内（scrollH ≤ 900）", (h["scrollH"] or 9999) <= 900),
        ("回归：SPA 到向导内容正常",
         res["wizard"]["path"] != "/cgi-bin/luci/admin/quickstart/" and (res["wizard"]["mcW"] or 0) > 600),
        ("无 pageerror", len(errs) == 0),
    ]
    print("\n=== 断言 ===")
    fail = 0
    for name, ok in checks:
        fail += 0 if ok else 1
        print(("PASS  " if ok else "FAIL  ") + name)
    print(f"\n卡片 {h['cardRect']}  骨架高 {h['rootH']}  scrollH {h['scrollH']}")
    print("取值:", {k: h[k] for k in ("mode", "state", "rx", "tx", "temp", "volt", "bias", "onu")})
    print("后端 pon:", json.dumps(api, ensure_ascii=False))
    print("面板行:", pa["panelRows"])
    res["checks"] = [{"name": n, "ok": bool(o)} for n, o in checks]
    res["fail"] = fail
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"\n{'全部通过' if not fail else str(fail) + ' 条失败'} / {len(checks)}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())

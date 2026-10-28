# -*- coding: utf-8 -*-
"""v17 验收：SPA 路由切换不再把首页的"塌缩/隐藏"带到别的页面。

背景：v16 把骨架切成默认后，从首页点侧栏「网络向导」→ 整页不重载 →
html.he13 与 #maincontent 的 0×0 塌缩被带到向导页 → 用户看到"内容不在了"。

判定（每步都量 DOM，不靠肉眼）：
  1. 首页 → 骨架在、原生塌缩
  2. SPA 点「网络向导」→ he13 现场必须全部撤掉、#maincontent 有尺寸、向导文字在
  3. SPA 点「首页」→ 骨架必须重建
  4. SPA 点「状态」→ 目标页正常、无 he13 现场
  5. 整页直开向导页 → 正常（脚本没被注入，天然没问题）
用法: py -3.13 tests/_ui_v17.py
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ.get("XG_BASE", "http://192.168.1.2")
USER, PW = "root", "admin123"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "ui_v17.json")
SHOTS = r"F:/BL/xg040gmd/_shots"

PROBE = r"""()=>{
  const q=s=>document.querySelector(s);
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
  const mc=q('#maincontent');
  return {
    path: location.pathname,
    htmlClass: document.documentElement.className,
    he13Root: !!q('#he13-root'),
    mc: r(mc),
    mcCollapsed: mc ? mc.getAttribute('data-he13-collapsed') : null,
    hiddenLeft: document.querySelectorAll('[data-he13-hidden]').length,
    text: (document.querySelector('#maincontent') ? document.querySelector('#maincontent').innerText : document.body.innerText || '')
            .replace(/\s+/g,' ').trim().slice(0,120),
    scrollH: document.documentElement.scrollHeight,
  };
}"""


def nav_click(pg, label):
    """点侧栏菜单（SPA，不重载）。"""
    ok = pg.evaluate(
        """(label)=>{
            const a=[...document.querySelectorAll('a')].find(x=>(x.innerText||'').trim()===label);
            if(!a) return false; a.click(); return true;
        }""", label)
    pg.wait_for_timeout(2500)
    return ok


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
        pg.wait_for_timeout(5000)
        res["home"] = pg.evaluate(PROBE)

        clicked = nav_click(pg, "网络向导")
        res["wizard"] = pg.evaluate(PROBE)
        res["wizard"]["clickedMenu"] = clicked
        pg.screenshot(path=os.path.join(SHOTS, "v17-wizard-spa.png"), full_page=True)

        clicked = nav_click(pg, "首页")
        res["back_home"] = pg.evaluate(PROBE)
        res["back_home"]["clickedMenu"] = clicked
        pg.wait_for_timeout(2000)
        res["back_home2"] = pg.evaluate(PROBE)

        # 「状态」是折叠父菜单（href=/admin/status 但点了只展开子菜单），
        # 这里必须点叶子「概览」才真的换路由。
        clicked = nav_click(pg, "概览")
        res["status"] = pg.evaluate(PROBE)
        res["status"]["clickedMenu"] = clicked
        pg.screenshot(path=os.path.join(SHOTS, "v17-status-spa.png"), full_page=True)
        ctx.close()

        # 5) 整页直开向导页（新 context，脚本不会注入）
        ctx2 = br.new_context(viewport={"width": 1440, "height": 900})
        pg2 = ctx2.new_page()
        pg2.goto(BASE + "/cgi-bin/luci/", wait_until="domcontentloaded")
        pg2.wait_for_timeout(400)
        if pg2.query_selector('input[name="luci_password"]'):
            pg2.fill('input[name="luci_username"]', USER)
            pg2.fill('input[name="luci_password"]', PW)
            pg2.click('button[type="submit"], input[type="submit"]')
            pg2.wait_for_timeout(2500)
        pg2.goto(BASE + "/cgi-bin/luci/admin/network_guide/pages/network", wait_until="networkidle")
        pg2.wait_for_timeout(2500)
        res["wizard_direct"] = pg2.evaluate(PROBE)
        ctx2.close()

        res["errors"] = errs
        br.close()

    w, s, bh, bd = res["wizard"], res["status"], res["back_home2"], res["wizard_direct"]
    checks = [
        ("首页有骨架", res["home"]["he13Root"] and "he13" in res["home"]["htmlClass"]),
        ("首页已塌缩", res["home"]["mc"]["w"] == 0 and res["home"]["mcCollapsed"] == "1"),
        ("SPA 到向导：he13 类已撤", "he13" not in w["htmlClass"]),
        ("SPA 到向导：骨架已移除", not w["he13Root"]),
        ("SPA 到向导：塌缩已撤销", w["mcCollapsed"] is None and w["mc"]["w"] > 600 and w["mc"]["h"] > 300),
        ("SPA 到向导：无残留隐藏标记", w["hiddenLeft"] == 0),
        ("SPA 到向导：向导内容可见", "网络配置向导" in w["text"] or "连接方式" in w["text"]),
        ("SPA 回首页：骨架重建", bh["he13Root"] and "he13" in bh["htmlClass"]),
        ("SPA 回首页：再次塌缩", bh["mc"]["w"] == 0),
        ("SPA 到概览：现场撤干净",
         (not s["he13Root"]) and "he13" not in s["htmlClass"]
         and s["mc"]["w"] > 600 and s["path"] != "/cgi-bin/luci/admin/quickstart/"),
        ("SPA 到概览：有内容", len(s["text"]) > 10),
        ("整页直开向导：正常", (not res["wizard_direct"]["he13Root"]) and res["wizard_direct"]["mc"]["w"] > 600),
        ("无 pageerror", len(errs) == 0),
    ]
    print("\n=== 断言 ===")
    fail = 0
    for name, ok in checks:
        fail += 0 if ok else 1
        print(("PASS  " if ok else "FAIL  ") + name)
    for k in ("home", "wizard", "back_home2", "status", "wizard_direct"):
        d = res[k]
        print(f"[{k}] {d['path']} class={d['htmlClass']!r} root={d['he13Root']} "
              f"mc={d['mc']['w']}x{d['mc']['h']} collapsed={d['mcCollapsed']} text={d['text'][:50]!r}")
    res["checks"] = [{"name": n, "ok": bool(o)} for n, o in checks]
    res["fail"] = fail
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"\n{'全部通过' if not fail else str(fail) + ' 条失败'} / {len(checks)}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())

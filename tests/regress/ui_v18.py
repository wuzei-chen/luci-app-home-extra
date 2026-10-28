# -*- coding: utf-8 -*-
"""v18 验收：模块设置面板只列骨架真实模块，且开关真的生效。

背景：原生 .module-settings 列的是 iStoreOS 首页 10 个原生模块，而这些原生块在本骨架里
已被隐藏 —— 勾选没有任何可见效果，用户报"设置项已经和实际不一致"。

判定：
  1. 齿轮打开自绘面板（不是原生 .module-settings），rect 等于视口
  2. 行数 = 4 个可切换模块 + 1 个"常显"底部信息
  3. 每个开关：关 → 对应节点 display:none 且 #he13-root 变矮；开 → 恢复
  4. 刷新后状态保持（localStorage）
  5. 「全部显示」一键复位
  6. 蒙层与 × 都能关
用法: py -3.13 tests/_ui_v18.py
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ.get("XG_BASE", "http://192.168.1.2")
USER, PW = "root", "admin123"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "ui_v18.json")
SHOTS = r"F:/BL/xg040gmd/_shots"

PANEL = r"""()=>{
  const q=s=>document.querySelector(s);
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};};
  const set=q('#he13-set');
  const rows=[...document.querySelectorAll('#he13-set-list .he13-set-row')].map(x=>({
    nm:(x.querySelector('.he13-set-nm')||{}).textContent||'',
    sw:!!x.querySelector('.he13-sw'),
    mod:(x.querySelector('.he13-sw')||{getAttribute:()=>null}).getAttribute
        ? (x.querySelector('.he13-sw')||{}).getAttribute?.('data-mod') : null,
    on:x.querySelector('.he13-sw') ? x.querySelector('.he13-sw').classList.contains('is-on') : null,
  }));
  const disp=id=>{const e=q(id);return e?getComputedStyle(e).display:null;};
  return {
    panelOpen: set ? set.classList.contains('is-open') : false,
    panelRect: r(set),
    cardRect: r(q('.he13-set-card')),
    nativeModal: !!q('.module-settings'),
    rows: rows,
    rootH: (r(q('#he13-root'))||{}).h,
    vis: {
      kpi: disp('#he13-root .he13-kpi'), wan: disp('#he13-card-wan'),
      rate: disp('#he13-card-rate'), quick: disp('#he13-card-quick'),
      foot: disp('#he13-foot'),
    },
    stored: localStorage.getItem('he13.mods'),
  };
}"""


def open_panel(pg):
    pg.evaluate("()=>document.getElementById('he13-gear').click()")
    pg.wait_for_timeout(600)
    return pg.evaluate(PANEL)


def toggle(pg, mod):
    pg.evaluate("(m)=>document.querySelector('#he13-set-list .he13-sw[data-mod=\"'+m+'\"]').click()", mod)
    pg.wait_for_timeout(500)
    return pg.evaluate(PANEL)


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

        res["open"] = open_panel(pg)
        pg.screenshot(path=os.path.join(SHOTS, "v18-panel-open.png"))

        res["rate_off"] = toggle(pg, "rate")
        res["rate_on"] = toggle(pg, "rate")
        res["kpi_off"] = toggle(pg, "kpi")
        res["kpi_on"] = toggle(pg, "kpi")
        res["quick_off"] = toggle(pg, "quick")
        pg.screenshot(path=os.path.join(SHOTS, "v18-panel-quick-off.png"))

        # 刷新看持久化
        pg.goto(BASE + "/cgi-bin/luci/admin/quickstart/", wait_until="networkidle")
        pg.wait_for_timeout(5000)
        res["after_reload"] = open_panel(pg)
        pg.screenshot(path=os.path.join(SHOTS, "v18-panel-reload.png"))

        # 全部显示
        pg.evaluate("()=>document.getElementById('he13-set-all').click()")
        pg.wait_for_timeout(500)
        res["reset"] = pg.evaluate(PANEL)

        # 关闭：× 与蒙层
        pg.evaluate("()=>document.getElementById('he13-set-x').click()")
        pg.wait_for_timeout(300)
        res["closed_x"] = pg.evaluate(PANEL)
        pg.evaluate("()=>document.getElementById('he13-gear').click()")
        pg.wait_for_timeout(400)
        pg.evaluate("()=>document.getElementById('he13-set-mask').click()")
        pg.wait_for_timeout(300)
        res["closed_mask"] = pg.evaluate(PANEL)

        res["errors"] = errs
        ctx.close()
        br.close()

    o, ro, rl, rs = res["open"], res["rate_off"], res["after_reload"], res["reset"]
    mnames = [r["nm"] for r in o["rows"]]
    checks = [
        ("齿轮打开自绘面板", o["panelOpen"] and not o["nativeModal"]),
        ("面板铺满视口", (o["panelRect"] or {}).get("w") == 1440 and (o["panelRect"] or {}).get("h") == 900),
        # v20 起模块面板扩为 7 行（6 开关 + 底部信息常显），新增 PON 光链路/网口状态
        ("标题行 7 行（6 开关 + 常显）", len(o["rows"]) == 7 and sum(1 for r in o["rows"] if r["sw"]) == 6),
        ("项目名称与骨架一致",
         mnames == ["指标行", "PON 光链路", "网口状态", "WAN 出口", "实时速率", "快捷入口", "底部信息"]),
        ("初始 6 个开关全开", all(r["on"] for r in o["rows"] if r["sw"])),
        ("关实时速率 → 节点消失", ro["vis"]["rate"] == "none"),
        # 速率卡与 WAN 卡同一排，行高由更高的 WAN 卡决定，所以单独关速率高度不变
        # 是**正确**的（不是残留）；真正的"变矮"要看整行模块。
        ("关实时速率 → 同排 WAN 不塌陷", ro["vis"]["wan"] != "none" and (ro["rootH"] or 0) == (o["rootH"] or 0)),
        ("关指标行 → 骨架变矮", (res["kpi_off"]["rootH"] or 0) < (o["rootH"] or 0)),
        ("关快捷入口 → 骨架变矮", (res["quick_off"]["rootH"] or 0) < (o["rootH"] or 0)),
        ("再开实时速率 → 节点回来", res["rate_on"]["vis"]["rate"] != "none"),
        ("关指标行 → 节点消失", res["kpi_off"]["vis"]["kpi"] == "none"),
        ("再开指标行 → 节点回来", res["kpi_on"]["vis"]["kpi"] != "none"),
        ("关快捷入口 → 节点消失且已落盘",
         res["quick_off"]["vis"]["quick"] == "none" and "quick" in (res["quick_off"]["stored"] or "")),
        ("刷新后仍关闭", rl["vis"]["quick"] == "none" and any(r["mod"] == "quick" and r["on"] is False for r in rl["rows"])),
        ("全部显示后恢复", rs["vis"]["quick"] != "none" and all(r["on"] for r in rs["rows"] if r["sw"])),
        ("× 可关", not res["closed_x"]["panelOpen"]),
        ("蒙层可关", not res["closed_mask"]["panelOpen"]),
        ("无 pageerror", len(errs) == 0),
    ]
    print("\n=== 断言 ===")
    fail = 0
    for name, ok in checks:
        fail += 0 if ok else 1
        print(("PASS  " if ok else "FAIL  ") + name)
    print(f"\n面板 rect={o['panelRect']} card={o['cardRect']} rootH={o['rootH']}")
    print("行:", [(r["nm"], r["mod"], r["on"]) for r in o["rows"]])
    print("关 rate 后 vis=", ro["vis"], " rootH=", ro["rootH"])
    res["checks"] = [{"name": n, "ok": bool(o2)} for n, o2 in checks]
    res["fail"] = fail
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"\n{'全部通过' if not fail else str(fail) + ' 条失败'} / {len(checks)}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())

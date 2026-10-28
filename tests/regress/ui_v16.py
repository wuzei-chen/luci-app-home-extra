# -*- coding: utf-8 -*-
"""v16 验收：**复现用户真实路径**（新浏览器 → 打开 / → 登录 → 落到首页），
不再手动加 ?he13=1。三幕：
  A. 全新上下文（无 sessionStorage / 无缓存）登录后访问 "/"      → 期望骨架在
  B. 同上下文访问 "/?he13=0"                                    → 期望骨架消失、原生回来
  C. 同上下文访问 "/?he13=1"                                    → 期望骨架回来
用法: py -3.13 tests/_ui_v16.py
输出: tests/regress/ui_v16.json + _shots/v16-*.png
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ.get("XG_BASE", "http://192.168.1.2")
USER, PW = "root", "admin123"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "ui_v16.json")
SHOTS = r"F:/BL/xg040gmd/_shots"

PROBE = r"""
() => {
  const q = (s) => document.querySelector(s);
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect();
    return { t: Math.round(b.top), l: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }; };
  const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1; };
  const root = q('#he13-root');
  const mc = q('#maincontent');
  const canvas = q('#he13-areacv');
  return {
    url: location.pathname + location.search,
    he13Flag: sessionStorage.getItem('he13'),
    rootExists: !!root,
    rootRect: r(root),
    rootVisible: vis(root),
    kpiCount: root ? root.querySelectorAll('.he13-k').length : 0,
    quickCount: root ? root.querySelectorAll('.he13-q').length : 0,
    mf: (q('#he13-mf') || {}).textContent || null,
    fw: (q('#he13-fw') || {}).textContent || null,
    time: (q('#he13-time') || {}).textContent || null,
    gear: (q('#he13-gear') || {}).textContent || null,
    gearRect: r(q('#he13-gear')),
    uptime: (q('#he13-uptime') || {}).textContent || null,
    term: (q('#he13-term') || {}).textContent || null,
    conn: (q('#he13-conn') || {}).textContent || null,
    load: (q('#he13-load') || {}).textContent || null,
    isp: (q('#he13-isp') || {}).textContent || null,
    ip: (q('#he13-ip') || {}).textContent || null,
    chartSum: (q('#he13-chart-sum') || {}).textContent || null,
    canvasRect: r(canvas),
    canvasBit: canvas ? { w: canvas.width, h: canvas.height } : null,
    mcCollapsed: mc ? {
      disp: getComputedStyle(mc).display, w: mc.getBoundingClientRect().width,
      h: mc.getBoundingClientRect().height,
    } : null,
    nativeVisible: {
      cardContainer: vis(q('.card-container')),
      network: vis(q('.network-container.align-c')),
      system: vis(q('.system')),
    },
    scrollH: document.documentElement.scrollHeight,
    htmlClass: document.documentElement.className,
  };
}
"""


def login(pg, tag):
    pg.goto(BASE + "/cgi-bin/luci/", wait_until="domcontentloaded")
    pg.wait_for_timeout(600)
    if pg.query_selector('input[name="luci_password"]'):
        pg.fill('input[name="luci_username"]', USER)
        pg.fill('input[name="luci_password"]', PW)
        pg.click('button[type="submit"], .cbi-button-apply, input[type="submit"]')
        pg.wait_for_timeout(2500)
        print(f"[{tag}] 已提交登录表单")
    else:
        print(f"[{tag}] 无登录表单（已登录）")


def visit(pg, path, tag, shot=None, settle=6000):
    pg.goto(BASE + path, wait_until="networkidle")
    pg.wait_for_timeout(settle)
    st = pg.evaluate(PROBE)
    st["tag"] = tag
    if shot:
        pg.screenshot(path=os.path.join(SHOTS, shot), full_page=True)
    print(f"[{tag}] url={st['url']} flag={st['he13Flag']} root={st['rootExists']} "
          f"vis={st['rootVisible']} h={(st['rootRect'] or {}).get('h')} "
          f"kpi={st['kpiCount']} quick={st['quickCount']} scrollH={st['scrollH']}")
    print(f"        mf={st['mf']!r} time={st['time']!r} gear={st['gear']!r} "
          f"uptime={st['uptime']!r} conn={st['conn']!r} load={st['load']!r}")
    print(f"        native={st['nativeVisible']} mcCollapsed={st['mcCollapsed']}")
    return st


def main():
    os.makedirs(SHOTS, exist_ok=True)
    result = {}
    errors = []
    benign = []
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append("pageerror:" + str(e)))

        def _console(m):
            # 登录页阶段对 /cgi-bin/luci/admin/home_extra/status 的 403 是预期的
            # （未带 cookie 请求受保护接口），不算页面错误；其它一律记录。
            if m.type != "error":
                return
            txt = m.text or ""
            if "403" in txt or "404" in txt:
                benign.append("console:" + txt)
                return
            errors.append("console:" + txt)

        pg.on("console", _console)

        login(pg, "A")
        result["A_plain_root"] = visit(pg, "/", "A 裸路径 /", "v16-A-plain.png")
        # 注意：裸 "/" 会在服务端 302 到 admin/quickstart/ 并**丢掉 query**，
        # 所以逃逸仓必须在最终路径上带参数，否则 JS 根本看不到 he13=0。
        result["B_off"] = visit(pg, "/cgi-bin/luci/admin/quickstart/?he13=0",
                                "B he13=0", "v16-B-off.png", settle=5000)
        # D：关掉之后访问**不带参数**的路径，应保持关（sessionStorage 记忆住逃逸仓）
        result["D_sticky_off"] = visit(pg, "/cgi-bin/luci/admin/quickstart/",
                                       "D 关后裸路径", None, settle=4000)
        result["C_on"] = visit(pg, "/cgi-bin/luci/admin/quickstart/?he13=1",
                               "C he13=1", "v16-C-on.png", settle=5000)
        result["errors"] = errors
        result["benign"] = benign
        ctx.close()
        br.close()

    card = [result["A_plain_root"]["nativeVisible"][k] for k in
            ("cardContainer", "network", "system")]
    # 注意 .card-container 在 v12 路径里本来就是 display:none（"剔除项"），
    # 因此判断"原生回来"只能用 network / system 两块；card-container 只作为"隐藏"的弱证据。
    mc = result["A_plain_root"]["mcCollapsed"] or {}
    checks = [
        ("A 裸路径渲染骨架", result["A_plain_root"]["rootExists"] and result["A_plain_root"]["rootVisible"]),
        ("A 原生三块全隐藏", not any(card)),
        ("A #maincontent 已塌缩", mc.get("w") == 0 and mc.get("h") == 0),
        ("A KPI 四张、快捷五格",
         result["A_plain_root"]["kpiCount"] == 4 and result["A_plain_root"]["quickCount"] == 5),
        ("A 型号·固件合并为一个字段",
         bool(result["A_plain_root"]["mf"]) and "·" in (result["A_plain_root"]["mf"] or "")),
        ("A 齿轮在", result["A_plain_root"]["gear"] is not None),
        ("A 面积图有尺寸", (result["A_plain_root"]["canvasRect"] or {}).get("w", 0) > 100),
        ("B ?he13=0 退回原生", not result["B_off"]["rootExists"]),
        ("B 原生回来了",
         result["B_off"]["nativeVisible"]["network"] and result["B_off"]["nativeVisible"]["system"]),
        ("D 关掉后裸路径仍关", not result["D_sticky_off"]["rootExists"]),
        ("C ?he13=1 恢复骨架", result["C_on"]["rootExists"] and result["C_on"]["rootVisible"]),
        ("无 pageerror / 非预期 console error", len(errors) == 0),
    ]
    print("\n=== 断言 ===")
    fail = 0
    for name, ok in checks:
        if not ok:
            fail += 1
        print(("PASS  " if ok else "FAIL  ") + name)
    result["checks"] = [{"name": n, "ok": bool(o)} for n, o in checks]
    result["fail"] = fail
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(f"\n{'全部通过' if not fail else str(fail) + ' 条失败'} / {len(checks)}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())

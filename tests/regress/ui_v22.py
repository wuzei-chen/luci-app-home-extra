# -*- coding: utf-8 -*-
"""v22 验收：出口 IP 一键隐藏（投屏/截图/远程协助场景）。

设计约束（必须验到的边界，不只是"点了有变化"）：
  1. 默认态 = 显示真实 IP，按钮写「隐藏」。
  2. 点击后：IP 位写「已隐藏」+ 置灰，按钮写「显示」，localStorage['he13.hideIp']='1'。
  3. 刷新后仍隐藏（持久化）。
  4. 点回「显示」→ 恢复真实 IP，且与后端 /status 的 wan.ip 完全一致。
  5. **不能把"没有"说成"隐藏"**：本机无全局 IPv6，隐藏态下 IPv6 地址那行
     仍须是「未获取」，不许变成「已隐藏」。
  6. 链路本地 fe80:: 不被连带隐藏（不是公网地址，排查要用）。
  7. SPA 往返（首页 → 网络向导 → 首页）后隐藏态仍生效（骨架会重建，状态在 localStorage）。
  8. 布局：IP 与按钮要贴在一起（新加的 margin-left:auto 生效，间距 <= 12px），
     且首屏不溢出。

用法: py -3.13 tests/_ui_v22.py
"""
import json
import os

from playwright.sync_api import sync_playwright

BASE = os.environ.get("XG_BASE", "http://192.168.1.2")
USER, PW = "root", "admin123"
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "ui_v22.json")
SHOTS = r"F:/BL/xg040gmd/_shots"

PROBE = r"""()=>{
  const g=id=>{const e=document.getElementById(id); return e?{
    t:e.textContent.trim(), cls:e.className, title:e.getAttribute('title')}:null;};
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();
    return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),
            right:Math.round(b.right),left:Math.round(b.left)};};
  const q=s=>document.querySelector(s);
  const ip=r(document.getElementById('he13-ip'));
  const eye=r(document.getElementById('he13-ip-eye'));
  let ls=null; try{ls=localStorage.getItem('he13.hideIp');}catch(e){}
  return {
    ip:g('he13-ip'), eye:g('he13-ip-eye'),
    v6:g('he13-v6'), v6ll:g('he13-v6ll'),
    rootH:(r(q('#he13-root'))||{}).h,
    overflow:(()=>{const m=q('.main-right');return m?m.scrollHeight-m.clientHeight:null;})(),
    gap:(ip&&eye)?(eye.left-ip.right):null,
    ls:ls,
    path:location.pathname,
    mcW:(r(q('#he13-maincontent'))||r(q('#maincontent'))||{}).w,
  };
}"""


def click_eye(pg):
    pg.evaluate("()=>{const e=document.getElementById('he13-ip-eye'); if(e) e.click();}")
    pg.wait_for_timeout(300)


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
        # 保证从干净状态开始（上个版本可能残留 he13.hideIp）。
        # 注意：不能用 add_init_script —— 它对每次导航都生效，会把我自己
        # 后面"刷新验证持久化"那一步的 localStorage 也清掉，得到假失败。
        pg.goto(BASE + "/cgi-bin/luci/admin/quickstart/", wait_until="networkidle")
        pg.wait_for_timeout(4000)
        pg.evaluate("()=>{try{localStorage.removeItem('he13.hideIp');}catch(e){}}")
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(6500)

        res["api"] = pg.evaluate(
            """async()=>{const r=await fetch('/cgi-bin/luci/admin/home_extra/status',{credentials:'include'});
               const d=await r.json(); return {ipv6:d.ipv6||null, wan:d.wan||null};}""")
        res["shown"] = pg.evaluate(PROBE)
        pg.screenshot(path=os.path.join(SHOTS, "v22-1-shown.png"), full_page=True)

        click_eye(pg)
        res["hidden"] = pg.evaluate(PROBE)
        pg.screenshot(path=os.path.join(SHOTS, "v22-2-hidden.png"), full_page=True)

        # 刷新：状态要从 localStorage 恢复
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(6500)
        res["reload"] = pg.evaluate(PROBE)

        # SPA 往返：骨架会被拆掉重建，隐藏态仍要生效
        pg.evaluate("""()=>{const a=[...document.querySelectorAll('a')]
            .find(x=>(x.innerText||'').trim()==='网络向导'); if(a) a.click();}""")
        pg.wait_for_timeout(2500)
        res["wizard"] = pg.evaluate(PROBE)
        pg.go_back()
        pg.wait_for_timeout(4000)
        res["back"] = pg.evaluate(PROBE)

        # 点回「显示」
        click_eye(pg)
        res["reshown"] = pg.evaluate(PROBE)
        pg.screenshot(path=os.path.join(SHOTS, "v22-3-reshown.png"), full_page=True)

        res["errors"] = errs
        ctx.close()
        br.close()

    api = res["api"] or {}
    wan = api.get("wan") or {}
    v6 = api.get("ipv6") or {}
    real_ip = wan.get("ip") or ""
    s, h, rl, bk, rs = (res["shown"], res["hidden"], res["reload"],
                        res["back"], res["reshown"])

    def T(x):                       # 节点可能因路由未回来而不存在，统一取文案
        return (x or {}).get("t") or ""

    def C(x):
        return (x or {}).get("cls") or ""

    checks = [
        ("按钮存在且初始为「隐藏」", T(s["eye"]) == "隐藏"),
        ("初始显示真实出口 IP", bool(real_ip) and T(s["ip"]) == real_ip),
        ("初始不置灰", "is-off" not in C(s["ip"])),
        ("点击后 IP 变「已隐藏」", T(h["ip"]) == "已隐藏"),
        ("已隐藏态置灰", "is-off" in C(h["ip"])),
        ("点击后按钮变「显示」", T(h["eye"]) == "显示"),
        ("写入 localStorage", h["ls"] == "1"),
        ("刷新后仍隐藏", T(rl["ip"]) == "已隐藏" and T(rl["eye"]) == "显示"),
        ("SPA 往返后仍隐藏", T(bk["ip"]) == "已隐藏"),
        ("隐藏态不把「没有」说成「隐藏」（IPv6 仍是未获取）",
         bool(v6.get("addr")) or T(h["v6"]) == "未获取"),
        ("链路本地 fe80 不受影响",
         T(h["v6ll"]).startswith("fe80") and "is-off" not in C(h["v6ll"])),
        ("点回「显示」恢复真实 IP", T(rs["ip"]) == real_ip),
        ("恢复后按钮回到「隐藏」", T(rs["eye"]) == "隐藏"),
        ("恢复后清掉持久化标记", rs["ls"] == "0"),
        ("IP 与按钮贴合（间距 <= 12px）", h.get("gap") is not None and 0 <= h["gap"] <= 12),
        ("首屏不溢出", (h["overflow"] or 0) <= 0),
        ("无 pageerror", len(errs) == 0),
    ]
    print("\n=== 断言 ===")
    fail = 0
    for name, ok in checks:
        fail += 0 if ok else 1
        print(("PASS  " if ok else "FAIL  ") + name)
    print("\n导出IP: 初始=%r 隐藏=%r 刷新=%r 返回=%r 恢复=%r"
          % (s["ip"]["t"], h["ip"]["t"], rl["ip"]["t"], bk["ip"]["t"], rs["ip"]["t"]))
    print("按钮:   初始=%r 隐藏=%r            localStorage 隐藏=%r 恢复=%r"
          % (s["eye"]["t"], h["eye"]["t"], h["ls"], rs["ls"]))
    print("间距 %s px  骨架 %s  溢出 %s" % (h.get("gap"), h["rootH"], h["overflow"]))
    print("后端 wan:", json.dumps(wan, ensure_ascii=False))
    print("后端 ipv6:", json.dumps(v6, ensure_ascii=False))
    res["checks"] = [{"name": n, "ok": bool(o)} for n, o in checks]
    res["fail"] = fail
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"\n{'全部通过' if not fail else str(fail) + ' 条失败'} / {len(checks)}")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())

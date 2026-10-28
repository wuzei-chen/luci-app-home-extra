# -*- coding: utf-8 -*-
"""带 cookie 登录 LuCI 后取 home_extra/status，验证真实 HTTP 响应（不经过 lua -e 桩）。"""
import http.cookiejar
import re
import sys
import urllib.parse
import urllib.request

BASE = "http://192.168.1.2"
USER, PW = "root", "admin123"


def main():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    body = urllib.parse.urlencode(
        {"luci_username": USER, "luci_password": PW}).encode()
    req = urllib.request.Request(BASE + "/cgi-bin/luci/", data=body)
    try:
        op.open(req, timeout=15).read()
    except Exception as e:      # 登录失败也会 200/302，这里只做记录
        print("login-exc:", e)

    names = [c.name for c in cj]
    print("cookies:", names)
    if not names:
        # 老式字段名再试一次
        body = urllib.parse.urlencode(
            {"username": USER, "password": PW}).encode()
        req = urllib.request.Request(BASE + "/cgi-bin/luci/", data=body)
        op.open(req, timeout=15).read()
        print("cookies(retry):", [c.name for c in cj])

    r = op.open(BASE + "/cgi-bin/luci/admin/home_extra/status", timeout=15)
    raw = r.read().decode("utf-8", "replace")
    print("http:", r.status, "len:", len(raw))
    print("body:", raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())

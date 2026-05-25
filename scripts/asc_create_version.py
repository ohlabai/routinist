#!/usr/bin/env python3
"""ASC 에 새 App Store 버전을 만듦.
사용법: python3 scripts/asc_create_version.py 1.2
없으면 만들고, 이미 있으면 그냥 알림.
"""
import os, sys, time, json
from pathlib import Path
import jwt
import urllib.request

VERSION = sys.argv[1] if len(sys.argv) > 1 else '1.2'
ROOT = Path(__file__).resolve().parent.parent
KEY_ID = os.environ.get("ASC_KEY_ID", "8SG822SXHS")
ISSUER_ID = os.environ.get("ASC_ISSUER_ID", "69a6de93-7de0-47e3-e053-5b8c7c11a4d1")
KEY_PATH = Path(os.environ.get("ASC_KEY_PATH", ROOT / "ios" / "fastlane" / "AuthKey_8SG822SXHS.p8"))
BUNDLE_ID = "com.routinist.app"

token = jwt.encode(
    {"iss": ISSUER_ID, "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
    KEY_PATH.read_text(),
    algorithm="ES256",
    headers={"kid": KEY_ID, "typ": "JWT"},
)
BASE = "https://api.appstoreconnect.apple.com/v1"

def call(method, path, body=None):
    url = BASE + path
    req = urllib.request.Request(
        url, method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    if body is not None:
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

# 1) app id 조회
_, apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}&limit=1")
app_id = apps["data"][0]["id"]
print(f"app id: {app_id}")

# 2) 이미 v{VERSION} 있는지 확인
_, vs = call("GET", f"/apps/{app_id}/appStoreVersions?limit=10")
existing = [v for v in vs["data"] if v["attributes"]["versionString"] == VERSION]
if existing:
    v = existing[0]
    print(f"이미 v{VERSION} 존재: id={v['id']} state={v['attributes']['appStoreState']}")
    sys.exit(0)

# 3) 새 버전 생성
body = {
    "data": {
        "type": "appStoreVersions",
        "attributes": {
            "platform": "IOS",
            "versionString": VERSION,
        },
        "relationships": {
            "app": {"data": {"type": "apps", "id": app_id}},
        },
    },
}
status, res = call("POST", "/appStoreVersions", body)
if status >= 300:
    print(f"실패 {status}: {json.dumps(res, indent=2, ensure_ascii=False)}")
    sys.exit(1)

new_id = res["data"]["id"]
print(f"v{VERSION} 생성 완료: id={new_id} state={res['data']['attributes']['appStoreState']}")

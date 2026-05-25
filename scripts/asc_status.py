#!/usr/bin/env python3
"""ASC 상태 확인 — App Store v1.1 + TestFlight build 처리 상태.
사용법: cd ios && python3 ../scripts/asc_status.py
"""
import os, sys, time, json
from pathlib import Path
import jwt
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
KEY_ID = os.environ.get("ASC_KEY_ID", "8SG822SXHS")
ISSUER_ID = os.environ.get("ASC_ISSUER_ID", "69a6de93-7de0-47e3-e053-5b8c7c11a4d1")
KEY_PATH = Path(os.environ.get("ASC_KEY_PATH", ROOT / "ios" / "fastlane" / "AuthKey_8SG822SXHS.p8"))
BUNDLE_ID = "com.routinist.app"

private_key = KEY_PATH.read_text()
token = jwt.encode(
    {"iss": ISSUER_ID, "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
    private_key,
    algorithm="ES256",
    headers={"kid": KEY_ID, "typ": "JWT"},
)

BASE = "https://api.appstoreconnect.apple.com/v1"
def get(path, params=None):
    url = BASE + path
    if params:
        q = "&".join(f"{k}={v}" for k, v in params.items())
        url += ("&" if "?" in url else "?") + q
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

apps = get(f"/apps?filter[bundleId]={BUNDLE_ID}&limit=1")
if not apps["data"]:
    sys.exit(f"App not found: {BUNDLE_ID}")
app = apps["data"][0]
app_id = app["id"]
print("=" * 62)
print(f"App: {app['attributes']['name']} ({BUNDLE_ID}) id={app_id}")
print("=" * 62)

print("\n📦 최근 TestFlight 빌드 (build 처리 상태)")
print("-" * 62)
builds = get(
    f"/builds?filter[app]={app_id}"
    f"&sort=-uploadedDate&limit=8"
    f"&include=preReleaseVersion,buildBetaDetail"
)
included = {(i["type"], i["id"]): i for i in builds.get("included", [])}
for b in builds["data"]:
    a = b["attributes"]
    rels = b.get("relationships", {})
    pre = rels.get("preReleaseVersion", {}).get("data")
    ver = "?"
    if pre:
        pre_obj = included.get((pre["type"], pre["id"]))
        if pre_obj:
            ver = pre_obj["attributes"]["version"]
    bbd = rels.get("buildBetaDetail", {}).get("data")
    ext_state = "-"
    if bbd:
        bbd_obj = included.get((bbd["type"], bbd["id"]))
        if bbd_obj:
            ext_state = bbd_obj["attributes"].get("externalBuildState", "-")
    bnum = a.get("version") or "?"
    state = a.get("processingState") or "?"
    uploaded = a.get("uploadedDate") or "?"
    print(f"  v{ver:<5} build {bnum:<5} | {state:<10} | ext={ext_state:<28} | uploaded={uploaded}")

print("\n🚀 App Store 버전 상태")
print("-" * 62)
versions = get(f"/apps/{app_id}/appStoreVersions?limit=5&include=build")
v_included = {(i["type"], i["id"]): i for i in versions.get("included", [])}
for v in versions["data"]:
    a = v["attributes"]
    b_rel = v.get("relationships", {}).get("build", {}).get("data")
    bnum = "-"
    if b_rel:
        b_obj = v_included.get((b_rel["type"], b_rel["id"]))
        if b_obj:
            bnum = b_obj["attributes"].get("version", "-")
    print(f"  v{a['versionString']} (build {bnum}) | {a['appStoreState']} | release={a.get('releaseType','-')}")

print("\n💡 상태 의미")
print("  PROCESSING            → Apple 빌드 처리 중 (15~30분)")
print("  VALID                 → 빌드 처리 완료, 제출 준비됨")
print("  PREPARE_FOR_SUBMISSION → 메타 작성 중 (아직 제출 안 함)")
print("  WAITING_FOR_REVIEW    → 제출 완료, 심사 대기")
print("  IN_REVIEW             → Apple 심사 중 (24~48시간)")
print("  PENDING_DEVELOPER_RELEASE → 통과, 사용자 출시 클릭 필요")
print("  READY_FOR_SALE        → 출시됨")
print("  REJECTED              → 거절 (Resolution Center 확인)")

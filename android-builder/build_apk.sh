#!/usr/bin/env bash
set -euo pipefail

SDK_ROOT="/opt/android-sdk"
BUILD_TOOLS="${SDK_ROOT}/build-tools/34.0.0"
PLATFORM_JAR="${SDK_ROOT}/platforms/android-34/android.jar"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILDER_DIR="${ROOT_DIR}/android-builder"
KEYSTORE="${BUILDER_DIR}/xerotv-signing.keystore"

PRIMARY_URL="${1:-https://ais-pre-kjqsaa2zuutrws532d2e33-328965355805.asia-east1.run.app}"
OUTPUT_APK="${2:-${ROOT_DIR}/public/apps/XEROTV.apk}"

if [[ ! -x "${BUILD_TOOLS}/aapt2" ]] || [[ ! -f "${PLATFORM_JAR}" ]]; then
  echo "Android SDK build-tools 34 or platform-34 not found under ${SDK_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/dist/index.html" ]]; then
  echo "Building production web bundle into ${ROOT_DIR}/dist ..." >&2
  (cd "${ROOT_DIR}" && npm run build >/dev/null 2>&1)
fi

mkdir -p "$(dirname "${OUTPUT_APK}")"

# Generate standard Android app signing keystore once (stored inside android-builder, never exposed in UI)
if [[ ! -f "${KEYSTORE}" ]]; then
  keytool -genkeypair \
    -v \
    -keystore "${KEYSTORE}" \
    -storetype PKCS12 \
    -storepass android \
    -alias xtvkey \
    -keypass android \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -dname "CN=XEROTV, OU=Mobile, O=XIAN IN PRODUCTION, L=Manila, S=NCR, C=PH" >/dev/null 2>&1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

mkdir -p \
  "${WORK_DIR}/res/mipmap-xxhdpi" \
  "${WORK_DIR}/res/mipmap-xxxhdpi" \
  "${WORK_DIR}/assets/www" \
  "${WORK_DIR}/obj" \
  "${WORK_DIR}/compiled-res" \
  "${WORK_DIR}/gen" \
  "${WORK_DIR}/dex"

cp "${ROOT_DIR}/public/pwa-192x192.png" "${WORK_DIR}/res/mipmap-xxhdpi/ic_launcher.png"
cp "${ROOT_DIR}/public/pwa-512x512.png" "${WORK_DIR}/res/mipmap-xxxhdpi/ic_launcher.png"
cp "${ROOT_DIR}/public/pwa-192x192.png" "${WORK_DIR}/assets/icon.png"

# Copy built XEROTV web app into assets/www (excluding apps/ directory to prevent recursive APK nesting)
python3 -c '
import os, shutil, sys
src_dir, dst_dir = sys.argv[1], sys.argv[2]
for root, dirs, files in os.walk(src_dir):
    rel_root = os.path.relpath(root, src_dir)
    if rel_root == "apps" or rel_root.startswith("apps" + os.sep):
        continue
    dirs[:] = [d for d in dirs if not (rel_root == "." and d == "apps")]
    out_root = dst_dir if rel_root == "." else os.path.join(dst_dir, rel_root)
    os.makedirs(out_root, exist_ok=True)
    for fn in files:
        shutil.copy2(os.path.join(root, fn), os.path.join(out_root, fn))
' "${ROOT_DIR}/dist" "${WORK_DIR}/assets/www"

python3 -c '
import json, sys, urllib.parse
raw = sys.argv[2].strip()
default_pub = "https://ais-pre-kjqsaa2zuutrws532d2e33-328965355805.asia-east1.run.app"
try:
    p = urllib.parse.urlparse(raw)
    host = (p.hostname or "").lower()
    if not host or host in ("localhost", "127.0.0.1", "0.0.0.0"):
        clean = default_pub
    else:
        if host.startswith("ais-dev-"):
            host = "ais-pre-" + host[len("ais-dev-"):]
        port = f":{p.port}" if p.port else ""
        scheme = p.scheme or "https"
        clean = f"{scheme}://{host}{port}"
except Exception:
    clean = default_pub
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "primaryUrl": clean,
        "fallbackUrl": default_pub
    }, f)
' "${WORK_DIR}/assets/xerotv_config.json" "${PRIMARY_URL}"

# 1. Compile Android resources
"${BUILD_TOOLS}/aapt2" compile --dir "${WORK_DIR}/res" -o "${WORK_DIR}/compiled-res/res.zip"

# 2. Link base APK with AndroidManifest + full embedded www bundle (-0 keeps mp4/media seekable via AssetFileDescriptor)
"${BUILD_TOOLS}/aapt2" link \
  -o "${WORK_DIR}/unsigned-base.apk" \
  -I "${PLATFORM_JAR}" \
  --manifest "${BUILDER_DIR}/AndroidManifest.xml" \
  -A "${WORK_DIR}/assets" \
  -0 .mp4 -0 .png -0 .jpg -0 .woff2 \
  --java "${WORK_DIR}/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  "${WORK_DIR}/compiled-res/res.zip"

# 3. Compile Java sources -> JVM bytecode (.class)
javac \
  --release 11 \
  -classpath "${PLATFORM_JAR}" \
  -d "${WORK_DIR}/obj" \
  "${WORK_DIR}/gen/com/xianinproduction/xerotv/R.java" \
  "${BUILDER_DIR}/LocalXeroServer.java" \
  "${BUILDER_DIR}/MainActivity.java"

# 4. Convert .class -> classes.dex via Android d8
CLASS_FILES=()
while IFS= read -r -d '' f; do
  CLASS_FILES+=("$f")
done < <(find "${WORK_DIR}/obj" -name '*.class' -print0)

"${BUILD_TOOLS}/d8" \
  --min-api 24 \
  --lib "${PLATFORM_JAR}" \
  --output "${WORK_DIR}/dex" \
  "${CLASS_FILES[@]}"

# 5. Merge classes.dex into APK archive cleanly (preserving uncompressed .arsc, .png, .jpg, .mp4)
python3 -c '
import zipfile, sys
base_apk, dex_path, merged_apk = sys.argv[1], sys.argv[2], sys.argv[3]
stored_exts = (".arsc", ".png", ".jpg", ".jpeg", ".mp4", ".woff2")
with zipfile.ZipFile(base_apk, "r") as zin, zipfile.ZipFile(merged_apk, "w", compression=zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        compress = zipfile.ZIP_STORED if item.filename.lower().endswith(stored_exts) else zipfile.ZIP_DEFLATED
        zout.writestr(item.filename, data, compress_type=compress)
    zout.write(dex_path, "classes.dex", compress_type=zipfile.ZIP_DEFLATED)
' "${WORK_DIR}/unsigned-base.apk" "${WORK_DIR}/dex/classes.dex" "${WORK_DIR}/unaligned.apk"

# 6. 4-byte zipalign + v1/v2/v3 APK Signature
"${BUILD_TOOLS}/zipalign" -f -p 4 "${WORK_DIR}/unaligned.apk" "${WORK_DIR}/aligned.apk"

"${BUILD_TOOLS}/apksigner" sign \
  --ks "${KEYSTORE}" \
  --ks-pass pass:android \
  --ks-key-alias xtvkey \
  --key-pass pass:android \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "${OUTPUT_APK}" \
  "${WORK_DIR}/aligned.apk"

"${BUILD_TOOLS}/apksigner" verify "${OUTPUT_APK}"
echo "Built real verified standalone APK: ${OUTPUT_APK} ($(stat -c%s "${OUTPUT_APK}") bytes)"

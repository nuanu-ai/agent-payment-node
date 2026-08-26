#!/bin/zsh

set -euo pipefail

app_path=""
entitlements_path=""
signing_identity=""
expected_team_id=""
notary_keychain_profile=""
verification_manifest=""
confirm_local_sign="false"
confirm_notary_upload="false"

while (( $# > 0 )); do
  case "$1" in
    --app) app_path="$2"; shift 2 ;;
    --entitlements) entitlements_path="$2"; shift 2 ;;
    --identity) signing_identity="$2"; shift 2 ;;
    --team-id) expected_team_id="$2"; shift 2 ;;
    --notary-keychain-profile) notary_keychain_profile="$2"; shift 2 ;;
    --verification-manifest) verification_manifest="$2"; shift 2 ;;
    --confirm-local-sign) confirm_local_sign="true"; shift ;;
    --confirm-notary-upload) confirm_notary_upload="true"; shift ;;
    *) print -u2 -- "unsupported argument"; exit 2 ;;
  esac
done

if [[ "$confirm_local_sign" != "true" ]]; then
  print -u2 -- "local Developer ID signing requires --confirm-local-sign"
  exit 2
fi
if [[ "$confirm_notary_upload" != "true" ]]; then
  print -u2 -- "Apple notary upload requires --confirm-notary-upload"
  exit 2
fi
if [[ "$app_path" != /* || "$entitlements_path" != /* || "$verification_manifest" != /* ]]; then
  print -u2 -- "--app, --entitlements and --verification-manifest must be absolute paths"
  exit 2
fi
if [[ "${app_path:t}" != "APNKeychainAgent.app" || ! -d "$app_path" ]]; then
  print -u2 -- "unexpected app bundle"
  exit 2
fi
if [[ ! -f "$app_path/Contents/embedded.provisionprofile" ]]; then
  print -u2 -- "embedded Developer ID provisioning profile is required"
  exit 2
fi
if [[ ! -f "$entitlements_path" ]]; then
  print -u2 -- "rendered entitlements file is required"
  exit 2
fi
if [[ "$signing_identity" != "Developer ID Application:"* ]]; then
  print -u2 -- "exact Developer ID Application identity is required"
  exit 2
fi
if [[ ${#expected_team_id} -ne 10 || "$expected_team_id" = *[^A-Z0-9]* ]]; then
  print -u2 -- "exact ten-character Nuanu Team ID is required"
  exit 2
fi
if [[ -z "$notary_keychain_profile" ]]; then
  print -u2 -- "a preconfigured notarytool Keychain profile name is required"
  exit 2
fi
if [[ -e "$verification_manifest" ]]; then
  print -u2 -- "refusing to overwrite verification manifest"
  exit 2
fi

release_tmp="$(mktemp -d "${TMPDIR:-/tmp}/apn-notary.XXXXXX")"
trap '[[ -n "${release_tmp:-}" && -d "${release_tmp:-}" ]] && /bin/rm -rf -- "${release_tmp}"' EXIT
submission_zip="$release_tmp/APNKeychainAgent-notary.zip"
script_dir="${0:A:h}"

/usr/bin/codesign \
  --force \
  --options runtime \
  --timestamp \
  --entitlements "$entitlements_path" \
  --sign "$signing_identity" \
  "$app_path"

/usr/bin/codesign --verify --deep --strict --verbose=2 "$app_path"
/opt/homebrew/opt/node@24/bin/node "$script_dir/verify-macos-app.mjs" \
  --app "$app_path" \
  --mode signed \
  --expected-team-id "$expected_team_id"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app_path" "$submission_zip"

/usr/bin/xcrun notarytool submit \
  --keychain-profile "$notary_keychain_profile" \
  --wait \
  "$submission_zip"

/usr/bin/xcrun stapler staple "$app_path"
/usr/bin/xcrun stapler validate "$app_path"
/usr/sbin/spctl --assess --type execute --verbose=2 "$app_path"
/opt/homebrew/opt/node@24/bin/node "$script_dir/verify-macos-app.mjs" \
  --app "$app_path" \
  --mode notarized \
  --expected-team-id "$expected_team_id" \
  --output-manifest "$verification_manifest"

print -r -- '{"schemaVersion":"apn.release.v1","artifact":"macos_app","signed":true,"notarized":true,"stapled":true,"verificationManifestWritten":true,"published":false}'

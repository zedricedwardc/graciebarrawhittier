#!/usr/bin/env bash
# Bundle / source scan for graciebarrawebsite.vercel.app
# Pure HTTP. Downloads JS/CSS/HTML, scans for leaked secrets and server-only paths.

set -u
BASE="https://graciebarrawebsite.vercel.app"
OUT="test-results/security/bundle"
mkdir -p "$OUT"

echo "=== Fetching HTML pages ==="
for path in "/" "/kickstart" "/contact"; do
  fname=$(echo "$path" | sed 's|/|_|g; s|^_||; s|^$|index|')
  [ -z "$fname" ] && fname="index"
  [ "$path" = "/" ] && fname="index"
  echo "GET $BASE$path -> $OUT/${fname}.html"
  curl -s -L -o "$OUT/${fname}.html" "$BASE$path"
done

echo "=== Fetching robots.txt, sitemap.xml, _astro/ ==="
curl -s -L -o "$OUT/robots.txt" "$BASE/robots.txt"
curl -s -L -o "$OUT/sitemap.xml" "$BASE/sitemap.xml"
curl -s -L -o "$OUT/_astro_index.html" "$BASE/_astro/"

echo "=== Fetching response headers (homepage) ==="
curl -s -D "$OUT/headers-home.txt" -o /dev/null "$BASE/"
curl -s -D "$OUT/headers-kickstart.txt" -o /dev/null "$BASE/kickstart"
curl -s -D "$OUT/headers-contact.txt" -o /dev/null "$BASE/contact"

echo "=== Parsing HTML for asset URLs ==="
ASSETS_FILE="$OUT/_assets.txt"
> "$ASSETS_FILE"

for html in "$OUT"/index.html "$OUT"/kickstart.html "$OUT"/contact.html; do
  [ -f "$html" ] || continue
  # script src
  grep -oE '<script[^>]+src="[^"]+"' "$html" | grep -oE 'src="[^"]+"' | sed 's/src="//; s/"$//' >> "$ASSETS_FILE"
  # link href (CSS, modulepreload, etc.)
  grep -oE '<link[^>]+href="[^"]+"' "$html" | grep -oE 'href="[^"]+"' | sed 's/href="//; s/"$//' >> "$ASSETS_FILE"
  # data-* URL refs (only those that look like URLs)
  grep -oE 'data-[a-zA-Z0-9_-]+="[^"]*"' "$html" | grep -oE '="[^"]*"' | sed 's/^="//; s/"$//' | grep -E '^(/|https?://)' >> "$ASSETS_FILE" || true
done

# Dedup and resolve relative URLs
sort -u "$ASSETS_FILE" -o "$ASSETS_FILE"

echo "=== Downloading discovered assets ==="
DOWNLOADED=()
while IFS= read -r url; do
  [ -z "$url" ] && continue
  # skip data: URIs and external CDNs that don't belong to the site
  case "$url" in
    data:*) continue ;;
    http://*|https://*)
      # only follow same-origin assets for download (still log others)
      case "$url" in
        "$BASE"*) full="$url" ;;
        *) echo "  external (skipping download): $url"; continue ;;
      esac
      ;;
    /*) full="$BASE$url" ;;
    *) full="$BASE/$url" ;;
  esac
  # Build a safe filename from the path
  fname=$(echo "$full" | sed "s|^$BASE/||; s|[/?&=]|_|g")
  [ -z "$fname" ] && fname="root"
  out="$OUT/$fname"
  echo "GET $full -> $out"
  curl -s -L -o "$out" "$full"
  DOWNLOADED+=("$full")
  # Try .map for JS/CSS
  case "$full" in
    *.js|*.css|*.mjs)
      mapurl="${full}.map"
      mapfname="${fname}.map"
      mapcode=$(curl -s -L -o "$OUT/$mapfname" -w "%{http_code}" "$mapurl")
      echo "  map $mapurl -> $mapcode"
      echo "$mapurl $mapcode" >> "$OUT/_map-checks.txt"
      ;;
  esac
done < "$ASSETS_FILE"

echo "=== Grep scans ==="
SCAN="$OUT/_scan-results.txt"
: > "$SCAN"

run_scan() {
  local label="$1"; shift
  echo "" >> "$SCAN"
  echo "## $label" >> "$SCAN"
  grep -RInE "$@" "$OUT" 2>/dev/null | grep -v "_scan-results.txt" >> "$SCAN" || echo "  (no hits)" >> "$SCAN"
}

run_scan "Bearer (with space)" 'Bearer '
run_scan "Authorization header" 'Authorization:'
run_scan "GHL PIT token shape (pit-...)" '(^|[^A-Za-z0-9])pit-[A-Za-z0-9_-]{10,}'
run_scan "services.leadconnectorhq.com server paths" 'services\.leadconnectorhq\.com/(calendars|contacts|conversations|locations)/'
run_scan "GHL_PIT_TOKEN literal" 'GHL_PIT_TOKEN'
run_scan "GHL_LOCATION_ID literal" 'GHL_LOCATION_ID'
run_scan "GHL_CAL_* calendar ids" 'GHL_CAL_(TINY|LC1|LC2|JUNIORS|ADULTS)'
run_scan "GHL_APPOINTMENT_WEBHOOK_URL" 'GHL_APPOINTMENT_WEBHOOK_URL'
run_scan "process.env.GHL_ in client bundle" 'process\.env\.GHL_'
run_scan "Long base64-ish strings (40+ chars)" '[A-Za-z0-9+/]{60,}={0,2}'
run_scan "PUBLIC_GHL_WEBHOOK_URL (informational)" 'PUBLIC_GHL_WEBHOOK_URL'

echo "=== Map files that returned 2xx ==="
if [ -f "$OUT/_map-checks.txt" ]; then
  awk '$2 ~ /^2/ {print}' "$OUT/_map-checks.txt" > "$OUT/_map-2xx.txt"
fi

echo "=== Asset counts ==="
JS_COUNT=$(ls "$OUT" 2>/dev/null | grep -E '\.(js|mjs)$' | wc -l)
CSS_COUNT=$(ls "$OUT" 2>/dev/null | grep -E '\.css$' | wc -l)
HTML_COUNT=$(ls "$OUT" 2>/dev/null | grep -E '\.html$' | wc -l)
echo "JS: $JS_COUNT  CSS: $CSS_COUNT  HTML: $HTML_COUNT" | tee "$OUT/_counts.txt"

echo "Done."

#!/usr/bin/env bash
set -euo pipefail

# ── تنظیمات ──────────────────────────────────────────────
PLUGIN_SLUG="dialog-theme-maker"
ROOT="$(cd "$(dirname "$0")" && pwd)"
FINAL_DIR="$ROOT/final"
RELEASE_DIR="$FINAL_DIR/$PLUGIN_SLUG"
ZIP_FILE="$FINAL_DIR/${PLUGIN_SLUG}.zip"

echo "==> Dialog Theme Maker — ساخت نسخه توزیع"
echo "    Root: $ROOT"

# ── ۱) بیلد فرانت ───────────────────────────────────────
echo "==> نصب وابستگی‌های npm و بیلد production..."
cd "$ROOT"
npm ci
npm run build

# بررسی خروجی بیلد
for f in "assets/chat/chat.js" "assets/chat/chat.css"; do
  if [[ ! -s "$ROOT/$f" ]]; then
    echo "ERROR: فایل بیلد نشده یا خالی است: $f" >&2
    exit 1
  fi
done

# ── ۲) وابستگی‌های PHP (production) ────────────────────
echo "==> نصب composer (بدون dev)..."
if command -v composer &>/dev/null; then
  composer install --no-dev --optimize-autoloader --no-interaction
else
  echo "WARN: composer پیدا نشد — از vendor فعلی استفاده می‌شود."
fi

# ── ۳) پاک‌سازی پوشه final ─────────────────────────────
echo "==> پاک‌سازی $FINAL_DIR ..."
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# ── ۴) کپی فایل‌های لازم ────────────────────────────────
echo "==> کپی فایل‌های production..."

INCLUDE_PATHS=(
  "dialog-theme-maker.php"
  "agent"
  "src"
  "vendor"
  "assets"
  "view"
  "LICENSE"
)

for path in "${INCLUDE_PATHS[@]}"; do
  if [[ -e "$ROOT/$path" ]]; then
    cp -a "$ROOT/$path" "$RELEASE_DIR/"
  else
    echo "WARN: مسیر وجود ندارد: $path"
  fi
done

# ── ۵) حذف فایل‌های اضافی احتمالی ─────────────────────
echo "==> حذف فایل‌های توسعه..."

rm -rf \
  "$RELEASE_DIR/frontend" \
  "$RELEASE_DIR/node_modules" \
  "$RELEASE_DIR/.git" \
  "$RELEASE_DIR/.cursor" \
  "$RELEASE_DIR/.vscode" \
  "$RELEASE_DIR/.idea"

find "$RELEASE_DIR" -type f \( \
  -name "package.json" -o \
  -name "package-lock.json" -o \
  -name "vite.config.js" -o \
  -name "composer.json" -o \
  -name "composer.lock" -o \
  -name ".gitignore" -o \
  -name ".env" -o \
  -name ".env.*" -o \
  -name "*.mdc" -o \
  -name "AGENT_README.md" \
\) -delete 2>/dev/null || true

# ── ۶) ساخت zip برای مشتری ─────────────────────────────
echo "==> ساخت zip..."
rm -f "$ZIP_FILE"
(
  cd "$FINAL_DIR"
  if command -v zip &>/dev/null; then
    zip -rq "$ZIP_FILE" "$PLUGIN_SLUG"
  else
    tar -czf "${PLUGIN_SLUG}.tar.gz" "$PLUGIN_SLUG"
    echo "    (zip نبود — ${PLUGIN_SLUG}.tar.gz ساخته شد)"
  fi
)

# ── ۷) گزارش نهایی ─────────────────────────────────────
echo ""
echo "✓ نسخه آماده:"
echo "  پوشه: $RELEASE_DIR"
if [[ -f "$ZIP_FILE" ]]; then
  echo "  zip:   $ZIP_FILE"
fi
echo ""
echo "محتوای نهایی:"
find "$RELEASE_DIR" -maxdepth 2 -type d | sort
echo ""
echo "حجم chat.js: $(du -h "$RELEASE_DIR/assets/chat/chat.js" | cut -f1)"

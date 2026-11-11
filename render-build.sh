#!/usr/bin/env bash
# Exit on any error
set -o errexit

echo "==> Installing Node dependencies..."
npm install

echo "==> Building Vite frontend..."
npm run build

echo "==> Ensuring Chromium binary is cached for Puppeteer..."
npx puppeteer browsers install chrome || true

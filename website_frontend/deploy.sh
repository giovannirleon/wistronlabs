#!/bin/bash

set -e  # exit on error

BUILD_BRANCH="build"
BUILD_DIR="dist"
DEPLOY_MSG=${1:-"deploy $(date +'%Y-%m-%d %H:%M:%S')"}

echo "📦 Building React app..."
npm run build

echo "🌿 Creating commit from $BUILD_DIR and pushing to $BUILD_BRANCH branch..."

git add -A  # just in case
git commit -m "WIP before deploy" || true

# Create a temp index for dist only
git --work-tree $BUILD_DIR checkout -B $BUILD_BRANCH

git --work-tree $BUILD_DIR add --all
git --work-tree $BUILD_DIR commit -m "$DEPLOY_MSG" || echo "⚠️ Nothing to commit."

git push origin HEAD:$BUILD_BRANCH --force

echo "🔙 Returning to main branch..."
git checkout main

echo "✅ Done! Deployed to '$BUILD_BRANCH' branch at $(date)."


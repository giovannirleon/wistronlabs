#!/bin/bash

set -e  # exit on any error

BUILD_BRANCH="build"
BUILD_DIR="dist"
DEPLOY_MSG=${1:-"deploy $(date +'%Y-%m-%d %H:%M:%S')"}

echo "📦 Building React app..."
npm run build

echo "🌿 Switching to orphan $BUILD_BRANCH branch..."
if git rev-parse --verify $BUILD_BRANCH >/dev/null 2>&1; then
    echo "🌿 Switching to existing $BUILD_BRANCH branch..."
    git checkout $BUILD_BRANCH
else
    echo "🌿 Creating new orphan $BUILD_BRANCH branch..."
    git checkout --orphan $BUILD_BRANCH
fi

echo "🧹 Cleaning up previous branch contents..."
git reset
git clean -fdx

echo "📂 Adding $BUILD_DIR to branch..."
git --work-tree $BUILD_DIR add --all

echo "💾 Committing deployment: \"$DEPLOY_MSG\"..."
if ! git --work-tree $BUILD_DIR commit -m "$DEPLOY_MSG"; then
    echo "⚠️ Nothing to commit — already up to date."
fi

echo "🚀 Pushing to origin/$BUILD_BRANCH..."
git push origin HEAD:$BUILD_BRANCH --force

echo "🔙 Cleaning up working tree..."
git reset --hard
git clean -fdx

echo "🔙 Switching back to main branch..."
git checkout -f main

echo "✅ Done! Deployed to '$BUILD_BRANCH' branch at $(date)."


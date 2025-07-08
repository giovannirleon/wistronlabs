#!/bin/bash

set -e  # exit immediately if a command fails

BUILD_BRANCH="build"
BUILD_DIR="dist"
DEPLOY_MSG=${1:-"deploy $(date +'%Y-%m-%d %H:%M:%S')"}

echo "📦 Building React app..."
npm run build

echo "🌿 Switching to orphan $BUILD_BRANCH branch..."
git checkout --orphan $BUILD_BRANCH

echo "🧹 Cleaning up previous build branch contents..."
git reset
git clean -fd

echo "📂 Adding $BUILD_DIR to branch..."
git --work-tree $BUILD_DIR add --all

echo "💾 Committing deployment: \"$DEPLOY_MSG\"..."
git --work-tree $BUILD_DIR commit -m "$DEPLOY_MSG" || echo "⚠️ Nothing to commit, skipping."

echo "🚀 Pushing to origin/$BUILD_BRANCH..."
git push origin HEAD:$BUILD_BRANCH --force

echo "🔙 Switching back to main branch..."
git checkout main

echo "✅ Done! Deployed to build branch at $(date)."


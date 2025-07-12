#!/bin/bash

# Usage: ./git-commit.sh "your commit message"

if [[ -z "$1" ]]; then
    echo "Error: Missing commit message."
    echo "Usage: ./git-commit.sh \"your commit message\""
    exit 1
fi

# Show status before
echo "Git status before committing:"
git status -s

# Add all changes
echo "Staging all changes…"
git add -A

# Commit
echo "Committing with message: $1"
git commit -m "$1"

if [[ $? -ne 0 ]]; then
    echo "Commit failed. Possibly nothing to commit."
    exit 1
fi

# Ask if they want to push
read -p "Do you want to push to remote as well? (y/n): " yn
case $yn in
    [Yy]* )
        echo "Pushing to remote…"
        git push
        ;;
    * )
        echo "Commit complete. Not pushing to remote."
        ;;
esac

echo "Done."

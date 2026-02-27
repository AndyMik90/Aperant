#!/bin/bash
set -e

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="develop"
LOCAL_BRANCH="develop"

echo "=== Sync Fork with Upstream ==="

# Check if upstream remote exists
if ! git remote | grep -q "^${UPSTREAM_REMOTE}$"; then
    echo "Adding upstream remote..."
    git remote add "$UPSTREAM_REMOTE" https://github.com/AndyMik90/Auto-Claude.git
fi

# Fetch upstream
echo "Fetching updates from upstream..."
git fetch "$UPSTREAM_REMOTE"

# Check current branch
CURRENT_BRANCH=$(git branch --show-current)

# Ensure local branch exists before comparing
if ! git show-ref --verify --quiet "refs/heads/${LOCAL_BRANCH}"; then
    echo "Local branch '$LOCAL_BRANCH' does not exist. Creating from upstream..."
    git checkout -b "$LOCAL_BRANCH" "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
fi

# Check for new commits
BEHIND=$(git rev-list --count "${LOCAL_BRANCH}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")

if [ "$BEHIND" -eq 0 ]; then
    echo "Already up to date. Nothing to sync."
    exit 0
fi

echo "Found $BEHIND new commits in upstream."

# If on develop, merge directly
if [ "$CURRENT_BRANCH" = "$LOCAL_BRANCH" ]; then
    echo "Merging from upstream/${UPSTREAM_BRANCH}..."
    if ! git merge "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" --no-edit; then
        echo "Merge conflict detected. Resolve conflicts manually, then:"
        echo "  git add ."
        echo "  git commit"
        echo "  git push origin $LOCAL_BRANCH"
        exit 1
    fi
    git push origin "$LOCAL_BRANCH"
    echo "develop branch updated successfully!"
else
    # If on another branch, guide user to switch instead of force-pushing
    echo "You are on branch '$CURRENT_BRANCH'. Please switch to develop to safely merge:"
    echo "  git checkout develop"
    echo "  ./scripts/sync-upstream.sh"
    echo ""
    echo "Or merge manually:"
    echo "  git fetch upstream"
    echo "  git checkout develop"
    echo "  git merge upstream/develop"
    exit 1
fi

echo ""
echo "=== Sync complete ==="

#!/bin/bash

###############################################################################
# Jerry - Version Branch Cleanup Script
###############################################################################
#
# PURPOSE:
# This script identifies and provides commands to delete version branches
# that collide with release tags, which causes HTTP 300 errors in the
# auto-updater.
#
# ISSUE: https://github.com/AndyMik90/Auto-Claude/issues/89
#
# BACKGROUND:
# When both a branch and tag share the same name (e.g., "v2.6.5"), GitHub's
# API returns HTTP 300 (Multiple Choices) when requesting tarball downloads.
# This breaks the auto-updater for users on older versions.
#
# The code fix (commit 69d5c73) now uses explicit "refs/tags/" prefix, but
# users on older versions can't update until the branch/tag collision is
# resolved.
#
# SAFETY:
# This script DOES NOT delete anything automatically. It only prints commands
# that the repository maintainer can review and execute manually.
#
###############################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Jerry - Version Branch Cleanup Tool                  ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Get all tags and branches matching version pattern
echo -e "${YELLOW}Analyzing repository for version collisions...${NC}"
echo ""

# Get all version tags (including pre-release versions like v1.0.0-beta.1)
tags=$(git tag | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?$" | sort -V || true)

# Get all local version branches (including pre-release versions)
local_branches=$(git branch --format='%(refname:short)' | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?$" || true)

# Get all remote version branches (including pre-release versions)
remote_branches=$(git branch -r --format='%(refname:short)' | sed 's|origin/||' | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z]+\.[0-9]+)?$" || true)

# Find collisions
colliding_branches=()

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}COLLISION ANALYSIS${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

for tag in $tags; do
    # Check if a local branch exists with same name
    if echo "$local_branches" | grep -q "^${tag}$"; then
        echo -e "${RED}⚠️  COLLISION FOUND:${NC} Tag ${GREEN}${tag}${NC} collides with ${RED}local branch${NC}"
        colliding_branches+=("$tag")
    fi

    # Check if a remote branch exists with same name
    if echo "$remote_branches" | grep -q "^${tag}$"; then
        echo -e "${RED}⚠️  COLLISION FOUND:${NC} Tag ${GREEN}${tag}${NC} collides with ${RED}remote branch${NC}"
        # Check if not already in array
        already_added=false
        for existing in "${colliding_branches[@]+"${colliding_branches[@]}"}"; do
            if [ "$existing" = "$tag" ]; then
                already_added=true
                break
            fi
        done
        if [ "$already_added" = false ]; then
            colliding_branches+=("$tag")
        fi
    fi
done

echo ""

if [ "${#colliding_branches[@]}" -eq 0 ]; then
    echo -e "${GREEN}✓ No collisions found!${NC}"
    echo -e "${GREEN}  All version tags are unique.${NC}"
    echo ""
    exit 0
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}CLEANUP COMMANDS${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}The following commands will delete colliding branches:${NC}"
echo ""
echo -e "${RED}⚠️  WARNING: Review these carefully before executing!${NC}"
echo ""

# Generate deletion commands
for branch in "${colliding_branches[@]}"; do
    echo -e "${YELLOW}# Delete local and remote branch: ${branch}${NC}"

    # Check if local branch exists
    if echo "$local_branches" | grep -q "^${branch}$"; then
        echo "git branch -D $branch"
    fi

    # Check if remote branch exists
    if echo "$remote_branches" | grep -q "^${branch}$"; then
        echo "git push origin --delete $branch"
    fi

    echo ""
done

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}RECOMMENDATIONS${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}1.${NC} Review the commands above carefully"
echo -e "${GREEN}2.${NC} Verify that these branches are no longer needed"
echo -e "${GREEN}3.${NC} Check if any open PRs reference these branches"
echo -e "${GREEN}4.${NC} Execute the commands manually (copy/paste)"
echo -e "${GREEN}5.${NC} After cleanup, users on old versions can update successfully"
echo ""
echo -e "${YELLOW}WHY THIS MATTERS:${NC}"
echo -e "  • Users on versions before v2.6.5 get HTTP 300 errors when updating"
echo -e "  • GitHub API can't distinguish between branch and tag with same name"
echo -e "  • Code fix (commit 69d5c73) uses explicit refs/tags/ prefix"
echo -e "  • But users need to update first - creating a chicken/egg problem"
echo ""
echo -e "${YELLOW}BEST PRACTICE GOING FORWARD:${NC}"
echo -e "  • Use ${GREEN}release tags${NC} (vX.Y.Z) for versioned releases"
echo -e "  • Use ${GREEN}feature branches${NC} (feature/xxx) for development"
echo -e "  • Never create branches with version tag names"
echo ""

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}SUMMARY${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Total version tags: ${GREEN}$(echo "$tags" | grep -c ^ || echo 0)${NC}"
echo -e "  Colliding branches: ${RED}${#colliding_branches[@]}${NC}"
echo ""

if [ "${#colliding_branches[@]}" -gt 0 ]; then
    echo -e "${YELLOW}Action required: Execute cleanup commands above${NC}"
    echo ""
fi

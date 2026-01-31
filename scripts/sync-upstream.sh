#!/bin/bash
set -e

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="develop"
LOCAL_BRANCH="develop"

echo "=== Sync Fork com Upstream ==="

# Verificar se upstream existe
if ! git remote | grep -q "^${UPSTREAM_REMOTE}$"; then
    echo "Adicionando remote upstream..."
    git remote add "$UPSTREAM_REMOTE" https://github.com/AndyMik90/Auto-Claude.git
fi

# Fetch upstream
echo "Buscando atualizacoes do upstream..."
git fetch "$UPSTREAM_REMOTE"

# Verificar branch atual
CURRENT_BRANCH=$(git branch --show-current)

# Verificar se há commits novos
BEHIND=$(git rev-list --count "${LOCAL_BRANCH}..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")

if [ "$BEHIND" -eq 0 ]; then
    echo "Ja esta atualizado. Nada para sincronizar."
    exit 0
fi

echo "Encontrados $BEHIND commits novos no upstream."

# Se estiver na develop, fazer merge direto
if [ "$CURRENT_BRANCH" = "$LOCAL_BRANCH" ]; then
    echo "Fazendo merge do upstream/${UPSTREAM_BRANCH}..."
    git merge "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" --no-edit
    git push origin "$LOCAL_BRANCH"
    echo "Branch develop atualizada com sucesso!"
else
    # Se estiver em outra branch, atualizar develop sem sair da branch atual
    echo "Voce esta na branch '$CURRENT_BRANCH'. Atualizando develop sem trocar de branch..."
    git fetch origin "$LOCAL_BRANCH"
    git push origin "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}:refs/heads/${LOCAL_BRANCH}"
    echo "Branch develop atualizada no origin!"

    echo ""
    echo "Para atualizar sua branch atual com as mudancas do develop:"
    echo "  git rebase develop"
fi

echo ""
echo "=== Sync concluido ==="

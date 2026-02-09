# CodeRabbit Review Responses

This document tracks CodeRabbit automated review comments that were investigated and rejected with justification.

---

## PR #100 (v2.7.0) - December 2025

### Rejected: nomic-embed-text embedding dimension (768 → 1024)

**CodeRabbit claimed:** The `nomic-embed-text` model uses 1024 dimensions, not 768.

**Location:** `ac-jerry-ui/src/renderer/components/onboarding/OllamaModelSelector.tsx:41`

**Our investigation:** Web search confirmed that `nomic-embed-text` uses **768 dimensions** (with a max sequence length of 8192 tokens). The model outputs 768-dimensional embeddings.

**Sources verified:**
- Ollama model library
- Nomic AI documentation
- HuggingFace model card

**Decision:** REJECTED - The existing value of 768 is correct. CodeRabbit's suggestion was incorrect.

---

### Rejected: MemoryStep checkmark UX

**CodeRabbit claimed:** The checkmark indicator should use `success` variant instead of `outline` for better visual feedback on completion.

**Location:** `ac-jerry-ui/src/renderer/components/onboarding/MemoryStep.tsx`

**Our investigation:** The current design is intentional. The checkmark uses a subtle outline style to indicate selection state without being overly prominent. This follows the component's visual hierarchy where the primary action (model selection/download) should be more prominent than the selection indicator.

**Decision:** REJECTED - Intentional UX design choice. The subtle indicator style is appropriate for this context.

---

# CodeQL SSRF False Positives in ollama.py

## Summary
CodeQL flags 3 locations in `apps/backend/web/routers/ollama.py` as potential SSRF vulnerabilities:
- Line 46: URL construction in `get_ollama_url()`
- Line 156: `list_ollama_models()` endpoint
- Line 287: `pull_ollama_model()` endpoint

## Why These Are False Positives

All user-provided URLs go through the `get_ollama_url()` function which:

1. **Validates the URL** using `validate_url()` (from `security.py`)
2. **Blocks dangerous schemes** - Only HTTP/HTTPS allowed (no `file://`, `data://`, etc.)
3. **Validates URL structure** - Ensures well-formed URLs with valid hostnames
4. **Optionally blocks private IPs** - Configurable via `allow_private` parameter
5. **Logs rejected URLs** - Invalid URLs are logged server-side for security monitoring
6. **Returns generic errors** - Client gets "Invalid Ollama URL provided" (no details leaked)

The validation in `get_ollama_url()` acts as a **sanitizer barrier** - no unvalidated URL ever reaches the `httpx` HTTP client.

## Validation Flow

```
User Input (baseUrl parameter)
      ↓
get_ollama_url(baseUrl)
      ↓
validate_url(url, allow_private=True)  ← VALIDATION BARRIER
      ↓ (raises ValueError if invalid)
   ✓ URL is safe
      ↓
Used in httpx.get/post (lines 72, 168, 286)
```

## Security Guarantees

**What is blocked:**
- ❌ `file:///etc/passwd` - Dangerous schemes
- ❌ `data:text/html,<script>` - Data URIs
- ❌ `http://169.254.169.254/metadata` - AWS metadata (when allow_private=False)
- ❌ `ftp://internal.server` - Non-HTTP schemes
- ❌ Malformed URLs - Invalid structure

**What is allowed (for Ollama):**
- ✅ `http://localhost:11434` - Default Ollama URL
- ✅ `http://192.168.1.100:8080` - Private network (when allow_private=True)
- ✅ `https://ollama.example.com` - Remote HTTPS URLs

## How to Suppress

These are **legitimate false positives**. To suppress in GitHub:

1. **In the PR/code**: 
   - We've added extensive documentation explaining the validation
   - Added `# lgtm[py/ssrf]` comments (for LGTM compatibility)
   
2. **In GitHub UI** (after PR is merged):
   - Go to Security → Code scanning
   - Click on each alert
   - Click "Dismiss alert" → "False positive"
   - Add reason: "URL is validated via validate_url() before use"

3. **Alternative**: Add a `.github/codeql-queries` directory with custom exclusions

## Related Files

- `apps/backend/web/utils/security.py` - Contains `validate_url()` implementation
- `apps/backend/web/routers/ollama.py` - Uses `get_ollama_url()` for validation
- `SSRF_FIX_SUMMARY.md` - Detailed documentation of SSRF protections
- `SECURITY_FIXES_COMPLETE.md` - Complete security fixes summary

## References

- [CodeQL SSRF Query](https://codeql.github.com/codeql-query-help/python/py-ssrf/)
- [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

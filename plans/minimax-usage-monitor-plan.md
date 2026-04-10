# MiniMax Usage Monitoring Implementation Plan

## Overview

Add support for MiniMax API usage/quota monitoring to Aperant-MCP. MiniMax provides a Coding Plan with a 5-hour session quota that can be queried via API.

## MiniMax API Details

### Usage Endpoint
- **URL**: `https://www.minimax.io/v1/api/openplatform/coding_plan/remains`
- **Authentication**: Bearer token (API key)
- **Returns**: Remaining quota for the 5-hour session window

### Key Differences from Other Providers
- **No weekly limit** - Only has the 5-hour session window (unlike Anthropic which has both session + weekly)
- **Session-based** - Usage resets every 5 hours
- **Prompt-based** - Usage measured in "prompts" not tokens

---

## Implementation Steps

### Phase 1: Backend Changes (usage-monitor.ts)

#### 1.1 Add MiniMax to Allowed Domains
**File**: `apps/frontend/src/main/claude-profile/usage-monitor.ts`
**Location**: Lines 45-49

```typescript
const ALLOWED_USAGE_API_DOMAINS = new Set([
  'api.anthropic.com',
  'api.z.ai',
  'open.bigmodel.cn',
  'www.minimax.io',  // Add MiniMax
  'api.minimax.io',  // Add MiniMax alternative
]);
```

#### 1.2 Add MiniMax Provider Endpoint
**File**: `apps/frontend/src/main/claude-profile/usage-monitor.ts`
**Location**: Lines 60-73

```typescript
const PROVIDER_USAGE_ENDPOINTS: readonly ProviderUsageEndpoint[] = [
  { provider: 'anthropic', usagePath: '/api/oauth/usage' },
  { provider: 'zai', usagePath: '/api/monitor/usage/quota/limit' },
  { provider: 'zhipu', usagePath: '/api/monitor/usage/quota/limit' },
  { provider: 'minimax', usagePath: '/v1/api/openplatform/coding_plan/remains' }, // Add MiniMax
];
```

#### 1.3 Add Response Normalizer
**File**: `apps/frontend/src/main/claude-profile/usage-monitor.ts`

Add new method to handle MiniMax response format:

```typescript
private normalizeMiniMaxResponse(
  data: any,
  profileId: string,
  profileName: string,
  profileEmail?: string
): ClaudeUsageSnapshot | null {
  // Expected response format from MiniMax:
  // { code: 0, msg: "success", data: { remains: number, total: number, ... } }
  
  try {
    const inner = data.data ?? data;
    const remains = inner.remains;
    const total = inner.total;
    
    if (remains === undefined || total === undefined) {
      return null;
    }
    
    // Calculate percentage used
    const used = total - remains;
    const sessionPercent = Math.round((used / total) * 100);
    
    // MiniMax doesn't have weekly limits - set to 0
    const weeklyPercent = 0;
    
    // Extract reset time if available
    const now = new Date();
    let sessionResetTimestamp: string;
    
    if (inner.next_reset_time) {
      sessionResetTimestamp = new Date(inner.next_reset_time).toISOString();
    } else {
      // Default: 5 hours from now
      sessionResetTimestamp = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
    }
    
    return {
      sessionPercent,
      weeklyPercent,
      sessionResetTime: undefined,
      weeklyResetTime: undefined,
      sessionResetTimestamp,
      weeklyResetTimestamp: undefined, // No weekly reset for MiniMax
      profileId,
      profileName,
      profileEmail,
      fetchedAt: new Date(),
      limitType: 'session',
      usageWindows: {
        sessionWindowLabel: 'common:usage.window5HoursQuota',
        // No weekly label for MiniMax
      }
    };
  } catch (error) {
    console.error('[UsageMonitor:MINIMAX] Failed to parse response:', error);
    return null;
  }
}
```

#### 1.4 Update Switch Statement
**File**: `apps/frontend/src/main/claude-profile/usage-monitor.ts`
**Location**: Around line 1827

Add MiniMax case to the switch statement:

```typescript
switch (provider) {
  case 'anthropic':
    normalizedUsage = this.normalizeAnthropicResponse(rawData, profileId, profileName, profileEmail);
    break;
  case 'zai':
    normalizedUsage = this.normalizeZAIResponse(responseData, profileId, profileName, profileEmail);
    break;
  case 'zhipu':
    normalizedUsage = this.normalizeZhipuResponse(responseData, profileId, profileName, profileEmail);
    break;
  case 'minimax':  // Add MiniMax case
    normalizedUsage = this.normalizeMiniMaxResponse(rawData, profileId, profileName, profileEmail);
    break;
  default:
    // ...
}
```

---

### Phase 2: Provider Detection Updates

#### 2.1 Update Provider Detection Type
**File**: `apps/frontend/src/shared/utils/provider-detection.ts`
**Location**: Line 14

```typescript
export type ApiProvider = 'anthropic' | 'zai' | 'zhipu' | 'minimax' | 'unknown';
```

#### 2.2 Add MiniMax Domain Patterns
**File**: `apps/frontend/src/shared/utils/provider-detection.ts`
**Location**: Lines 25-38

```typescript
const PROVIDER_PATTERNS: readonly ProviderPattern[] = [
  { provider: 'anthropic', domainPatterns: ['api.anthropic.com'] },
  { provider: 'zai', domainPatterns: ['api.z.ai', 'z.ai'] },
  { provider: 'zhipu', domainPatterns: ['open.bigmodel.cn', 'dev.bigmodel.cn', 'bigmodel.cn'] },
  { provider: 'minimax', domainPatterns: ['api.minimax.io', 'www.minimax.io', 'minimax.io'] }, // Add MiniMax
];
```

#### 2.3 Add MiniMax Label
**File**: `apps/frontend/src/shared/utils/provider-detection.ts`
**Location**: Lines 82-93

```typescript
export function getProviderLabel(provider: ApiProvider): string {
  switch (provider) {
    case 'anthropic': return 'Anthropic';
    case 'zai': return 'z.ai';
    case 'zhipu': return 'ZHIPU AI';
    case 'minimax': return 'MiniMax';  // Add
    case 'unknown': return 'Unknown';
  }
}
```

#### 2.4 Add MiniMax Badge Color
**File**: `apps/frontend/src/shared/utils/provider-detection.ts`
**Location**: Lines 101-112

```typescript
export function getProviderBadgeColor(provider: ApiProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/15';
    case 'zai':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/15';
    case 'zhipu':
      return 'bg-purple-500/10 text-purple-500 border-purple-500/20 hover:bg-purple-500/15';
    case 'minimax':  // Add MiniMax color (using cyan/teal)
      return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20 hover:bg-cyan-500/15';
    case 'unknown':
      return 'bg-gray-500/10 text-gray-500 border-gray-500/20 hover:bg-gray-500/15';
  }
}
```

---

### Phase 3: Frontend UI Updates

#### 3.1 Update UsageIndicator.tsx for Session-Only Display
**File**: `apps/frontend/src/renderer/components/UsageIndicator.tsx`

The UI needs to handle the case where `weeklyPercent` is 0 or undefined for MiniMax:
- Hide weekly display when provider is MiniMax
- Show only session usage
- Display "5-hour session" label

#### 3.2 Update AuthStatusIndicator.tsx
**File**: `apps/frontend/src/renderer/components/AuthStatusIndicator.tsx`

Similar changes - handle session-only display for MiniMax.

#### 3.3 Update AccountSettings.tsx
**File**: `apps/frontend/src/renderer/components/settings/AccountSettings.tsx`

Hide weekly usage bar for API profiles (already done - check line 195):
```typescript
hasUnlimitedUsage: true, // API profiles have no rate limits
sessionPercent: undefined,
weeklyPercent: undefined,
```

This should already work for MiniMax since it's an API profile.

#### 3.4 Add i18n Translations
**File**: `apps/frontend/src/shared/i18n/locales/en/common.json`

Add MiniMax-specific labels if needed:
```json
"usage": {
  "window5HoursQuota": "5-Hour Session",
  "windowMonthlyToolsQuota": "Monthly Tools"
}
```

---

### Phase 4: Testing

#### 4.1 Test MiniMax Usage Fetch
- Verify API endpoint returns correct data
- Verify percentage calculation is accurate
- Verify reset time is extracted correctly

#### 4.2 Test UI Display
- Verify session percentage shows correctly
- Verify weekly percentage is hidden (or shows 0)
- Verify reset time displays correctly

#### 4.3 Test Rate Limit Behavior
- Verify 100% triggers rate limit warning
- Verify auto-recovery works

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/frontend/src/main/claude-profile/usage-monitor.ts` | Add MiniMax endpoint, normalizer, switch case |
| `apps/frontend/src/shared/utils/provider-detection.ts` | Add MiniMax to type, patterns, labels |
| `apps/frontend/src/renderer/components/UsageIndicator.tsx` | Handle session-only display |
| `apps/frontend/src/renderer/components/AuthStatusIndicator.tsx` | Handle session-only display |
| `apps/frontend/src/shared/i18n/locales/en/common.json` | Add translations (if needed) |

---

## Risk Assessment

- **Low Risk**: Adding new provider support doesn't affect existing functionality
- **Dependencies**: None - MiniMax API is already used for chat, just adding usage monitoring
- **Testing**: Should verify actual API response format matches expected schema

---

## Notes

- MiniMax Coding Plan is session-only (no weekly limit) - this is actually simpler than other providers
- The 5-hour session is similar to Anthropic's session window
- Auto-Claude already has the infrastructure - just need to plug in MiniMax

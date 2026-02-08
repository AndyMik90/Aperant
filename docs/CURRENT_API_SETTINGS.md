# Jerry Current API Settings Documentation

**Date**: February 8, 2026
**Profile**: Auto (Optimized)

## Overview
This document captures the current API model and thinking level configuration across all Jerry features. These settings represent the optimized balance between quality, speed, and cost discovered through extensive testing.

---

## 1. Task Pipeline (Main Workflow)

### Phase Configuration

| Phase | Model | Thinking Level | Purpose | Rationale |
|-------|-------|----------------|---------|-----------|
| **Spec Creation** | Claude Opus 4.6 | Ultra Think (63,999 tokens) | Discovery, requirements, context gathering | Requires deep analysis to understand user intent and project context. Most critical phase for task success. |
| **Planning** | Claude Opus 4.6 | High (16,384 tokens) | Implementation planning and architecture | Complex architectural reasoning needed. Plan quality determines coding success. |
| **Coding** | Claude Opus 4.6 | Low (1,024 tokens) | Actual code implementation | Plan already exists, so less thinking needed. Opus ensures quality execution. |
| **QA Review** | Claude Opus 4.6 | Low (1,024 tokens) | Quality assurance and validation | Follows existing plan and checks against spec. Straightforward review task. |

**Token Costs Per Phase** (approximate):
- Spec Creation: ~200K-500K input + 50K-100K output (with Ultra Think)
- Planning: ~100K-200K input + 30K-50K output (with High Think)
- Coding: ~50K-150K input + 20K-40K output per file
- QA Review: ~50K-100K input + 10K-20K output

---

## 2. Feature-Specific Settings (Non-Pipeline)

### Jerry Chat (Insights)
- **Model**: Claude Sonnet 4.5
- **Thinking Level**: Medium (4,096 tokens)
- **Use Case**: Codebase questions, quick analysis, conversational assistance
- **Rationale**: Good balance of quality and speed for chat. Medium thinking provides enough depth for multi-step tasks without over-thinking simple questions.
- **Changed**: February 8, 2026 (was Opus + Low, causing short responses)

### Ideation
- **Model**: Claude Opus 4.6
- **Thinking Level**: High (16,384 tokens)
- **Use Case**: Generate creative feature ideas and improvements
- **Rationale**: Creative ideation benefits from Opus's superior reasoning and high thinking budget for exploring possibilities.

### Roadmap Generation
- **Model**: Claude Opus 4.6
- **Thinking Level**: High (16,384 tokens)
- **Use Case**: Create strategic feature roadmaps
- **Rationale**: Strategic planning requires deep thinking about dependencies, priorities, and long-term vision.

### GitHub Issues Automation
- **Model**: Claude Opus 4.6
- **Thinking Level**: Medium (4,096 tokens)
- **Use Case**: Automated issue triage and labeling
- **Rationale**: Issue analysis benefits from thorough Opus comprehension, but doesn't need ultra-deep thinking.

### GitHub PR Review
- **Model**: Claude Opus 4.6
- **Thinking Level**: Medium (4,096 tokens)
- **Use Case**: AI-powered pull request reviews
- **Rationale**: PR review requires careful analysis but follows established patterns, so medium thinking suffices.

### Utility Agents
- **Model**: Claude Haiku 4.5
- **Thinking Level**: Low (1,024 tokens)
- **Use Cases**: Commit messages, merge conflict resolution
- **Rationale**: Fast, straightforward operations that don't require deep reasoning.

---

## 3. Agent Profile Settings

### Current Profile: Auto (Optimized)
- **Description**: Uses Opus across all phases with optimized thinking levels
- **Primary Model Display**: Opus 4.6
- **Primary Thinking Display**: High

### Alternative Profiles Available

| Profile | Model | Thinking | Use Case |
|---------|-------|----------|----------|
| **Complex Tasks** | Opus 4.6 | Ultra Think | All phases use ultra think for maximum depth |
| **Balanced** | Sonnet 4.5 | Medium | Good balance for most tasks |
| **Quick Edits** | Haiku 4.5 | Low | Fast iterations for simple changes |

---

## 4. Cost Analysis (Monthly Estimates)

**Assumptions**:
- 20 tasks per month (mix of small/medium/large)
- Average task: 4 spec phases + 1 plan + 3 coding sessions + 2 QA reviews

### Per-Task Cost (Opus-based pipeline)
- Spec Creation (Ultra Think): ~$15-30
- Planning (High Think): ~$5-10
- Coding (Low Think): ~$10-20 (3 sessions)
- QA Review (Low Think): ~$2-4 (2 reviews)
- **Total per task**: ~$32-64

### Monthly Usage
- Pipeline tasks (20 × $48 avg): ~$960/month
- Jerry Chat (Sonnet): ~$50-100/month (200 messages avg)
- Ideation/Roadmap: ~$20-40/month (occasional use)
- GitHub automation: ~$30-50/month
- **Total estimated**: ~$1,060-1,150/month

---

## 5. Performance Characteristics

### Speed vs Quality Trade-offs

| Configuration | Speed | Quality | Cost | Best For |
|---------------|-------|---------|------|----------|
| **Current (Auto)** | Medium | Excellent | High | Production work, critical features |
| **Balanced (All Sonnet)** | Fast | Good | Medium | Most tasks, rapid iteration |
| **Quick (All Haiku)** | Very Fast | Adequate | Low | Simple fixes, experiments |
| **Complex (All Ultra)** | Slow | Maximum | Very High | Mission-critical, novel problems |

---

## 6. Optimization Opportunities

### Potential Cost Savings (without quality loss)

1. **Coding Phase** → Switch to Sonnet for routine implementations
   - Savings: ~$5-10 per task
   - Risk: Low (plan already provides structure)

2. **QA Review** → Switch to Sonnet
   - Savings: ~$1-2 per task
   - Risk: Very Low (follows checklist)

3. **Jerry Chat** → Already optimized (using Sonnet)
   - Current: $0.50-1.00 per chat session
   - No further optimization needed

### Recommended Adjustments for Cost Reduction

```typescript
// Revised "Auto (Cost-Optimized)" Profile
const costOptimizedProfile = {
  spec: { model: 'opus', thinking: 'ultrathink' },      // Keep (critical)
  planning: { model: 'opus', thinking: 'high' },        // Keep (critical)
  coding: { model: 'sonnet', thinking: 'low' },         // Change (save $10/task)
  qa: { model: 'sonnet', thinking: 'low' }              // Change (save $2/task)
};

// Potential savings: ~$240/month (20% reduction)
// Quality impact: Minimal (plan guides coding, QA is checklist-driven)
```

---

## 7. Configuration Files

### App Settings Location
```
~/Library/Application Support/jerry-ui/settings.json
```

### Current Settings Snapshot
```json
{
  "selectedAgentProfile": "auto",
  "defaultModel": "opus",
  "featureModels": {
    "insights": "sonnet",
    "ideation": "opus",
    "roadmap": "opus",
    "githubIssues": "opus",
    "githubPrs": "opus",
    "utility": "haiku"
  },
  "featureThinking": {
    "insights": "medium",
    "ideation": "high",
    "roadmap": "high",
    "githubIssues": "medium",
    "githubPrs": "medium",
    "utility": "low"
  }
}
```

### Code Defaults Location
```
apps/frontend/src/shared/constants/models.ts
```

---

## 8. Thinking Budget Reference

| Level | Tokens | Best For | Cost Multiplier |
|-------|--------|----------|----------------|
| None | 0 | Simple, deterministic tasks | 1.0x |
| Low | 1,024 | Straightforward with existing context | 1.1x |
| Medium | 4,096 | Multi-step reasoning | 1.3x |
| High | 16,384 | Complex planning, architecture | 1.8x |
| Ultra Think | 63,999 | Novel problems, deep analysis | 3.0x+ |

---

## 9. Model Comparison

### Claude Opus 4.6
- **Strengths**: Superior reasoning, complex tasks, novel problems
- **Speed**: Slower (2-5 sec first token)
- **Cost**: Highest ($15/$75 per million tokens)
- **Use**: Critical phases, quality-sensitive work

### Claude Sonnet 4.5
- **Strengths**: Fast, good quality, balanced cost
- **Speed**: Fast (0.5-2 sec first token)
- **Cost**: Medium ($3/$15 per million tokens)
- **Use**: Most tasks, rapid iteration, chat

### Claude Haiku 4.5
- **Strengths**: Very fast, low cost
- **Speed**: Very fast (0.3-1 sec first token)
- **Cost**: Low ($1/$5 per million tokens)
- **Use**: Utility tasks, simple operations

---

## 10. Recommendations

### Keep Current Settings For:
1. **Spec Creation (Opus + Ultra Think)** - Most critical phase, determines task success
2. **Planning (Opus + High)** - Plan quality directly impacts coding efficiency
3. **Jerry Chat (Sonnet + Medium)** - Optimal balance for conversational assistance

### Consider Changing:
1. **Coding (Opus → Sonnet)** - Plan already provides structure, Sonnet executes well
2. **QA (Opus → Sonnet)** - Checklist-driven, doesn't need Opus-level reasoning

### Monitor:
- **Task success rate** - If drops below 85%, revert Coding/QA to Opus
- **Re-work frequency** - If QA catches fewer issues, increase QA thinking level
- **User satisfaction** - Collect feedback on Jerry Chat response quality

---

## Next Steps

1. **Document these as "Production Defaults"** in the codebase
2. **Add Profile Presets**:
   - "Production" (current)
   - "Cost-Optimized" (Sonnet coding/QA)
   - "Speed-Optimized" (Sonnet everywhere except Spec)
3. **Add Usage Tracking** to dashboard showing monthly API costs by feature
4. **Implement Profile Switching** to easily test different configurations


# GitHub Review App - Comprehensive Testing Strategy

**Date:** December 20, 2025  
**Status:** Pre-Implementation Planning  
**Current Test Coverage:** 0%  
**Target Coverage:** 80%+ for critical paths

## Executive Summary

This document outlines the testing strategy for the GitHub Review App before a major refactoring effort. The application currently has 15,000+ lines of code with zero test coverage, making refactoring risky. This strategy establishes a comprehensive test suite to prevent functionality loss during architectural changes.

### Current State Analysis

- **Codebase Size:** 15,000+ LOC (9,000+ in App.tsx alone)
- **Architecture:** Tauri (Rust backend) + React (TypeScript frontend)
- **Complexity:** 52 Tauri commands, 80+ useState hooks, complex retry logic
- **Test Coverage:** 0% (no tests exist)
- **Technical Debt:** Massive monolithic component, no separation of concerns

### High-Risk Areas Requiring Testing

1. **Comment submission** - Complex retry logic with rate limiting, exponential backoff, line-to-file fallback
2. **Scroll synchronization** - Anchor-based mapping between Monaco editor and preview pane
3. **Offline caching** - IndexedDB with TTL, fallback chains, SHA validation
4. **OAuth authentication** - PKCE flow, local HTTP server, timing constraints
5. **Draft management** - SQLite storage, localStorage persistence, restoration logic

---

## Testing Infrastructure Setup

### Phase 0: Install Dependencies & Configure

#### Frontend (Vitest + React Testing Library)

**Dependencies to add:**
```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "jsdom": "^23.0.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/user-event": "^14.0.0",
    "msw": "^2.0.0",
    "@vitest/ui": "^1.0.0"
  }
}
```

**Configuration:** `vitest.config.ts`
- Environment: jsdom
- Setup file: `src/setupTests.ts`
- Coverage provider: v8
- Mock Tauri `invoke()` globally

#### Backend (Rust Testing Crates)

**Dependencies to add to Cargo.toml:**
```toml
[dev-dependencies]
mockall = "0.12"
mockito = "1.2"
insta = "1.34"
tempfile = "3.8"
tokio-test = "0.4"
```

**Configuration:**
- Use `#[cfg(test)]` modules
- Create `tests/` directory for integration tests
- Mock HTTP with `mockito`
- Mock keyring operations with traits

#### Fixture Data

**Create:** `app/tests/fixtures/`
- `github-api-responses.json` - Sample PR, comments, files
- `review-data.json` - Sample local reviews
- `diff-samples.txt` - Various diff formats
- `oauth-responses.json` - Token exchange responses

---

## Phase 1: Backend Unit Tests (Week 1)

**Goal:** Test isolated business logic without external dependencies

### Target Modules

1. **error.rs** - Error type conversions
2. **models.rs** - Data structure validation
3. **github.rs** - Diff parsing, position calculations
4. **review_storage.rs** - CRUD operations (in-memory SQLite)

**Coverage Target:** 80%+ of pure functions

**Deliverables:**
- 30-40 unit tests
- Test fixtures for diff formats
- In-memory SQLite for storage tests

---

## Phase 2: Backend Integration Tests (Week 2)

**Goal:** Test component interactions with mocked external dependencies

### Target Flows

1. **GitHub API client** (`github.rs`)
   - Mock HTTP responses with `mockito`
   - Test pagination logic
   - Test retry with exponential backoff
   - Test rate limiting detection

2. **Comment submission** (`github.rs`)
   - Test "submitted too quickly" retry
   - Test line-to-file comment fallback
   - Test PR locked detection
   - Test partial batch success tracking

3. **OAuth flow** (`auth.rs`)
   - Mock OAuth server
   - Test PKCE flow
   - Test timeout handling
   - Test state validation

4. **Review storage** (`review_storage.rs`)
   - Use temp database
   - Test log file generation
   - Test concurrent operations

**Coverage Target:** 70%+ of integration points

**Deliverables:**
- 50-60 integration tests
- Mock HTTP server setup
- Mock keyring trait implementation

---

## Phase 3: Frontend Refactoring (Week 3)

**Goal:** Extract business logic from App.tsx for testability

### Custom Hooks to Extract

1. **useAuth** - Authentication state, token management
2. **useCommentSubmission** - Comment posting logic, retry handling
3. **usePRData** - PR fetching, caching, pagination
4. **useOfflineCache** - IndexedDB operations, TTL validation
5. **useScrollSync** - Anchor-based scroll synchronization
6. **useDraftManagement** - LocalStorage draft persistence
7. **useFileNavigation** - History stack, viewed files tracking
8. **useNetworkStatus** - Online/offline detection

### Refactoring Strategy

- Extract one hook at a time
- Keep original code in place initially
- Run manual tests after each extraction
- Use feature flag to toggle between old/new

**Deliverables:**
- 8 custom hooks with clean interfaces
- Reduced App.tsx to ~2000 lines
- Error boundaries for React errors

---

## Phase 4: Frontend Unit Tests (Week 4)

**Goal:** Test extracted hooks and utility functions in isolation

### Target Components

1. **offlineCache.ts** - TTL logic, cache operations
2. **useNetworkStatus.ts** - Online/offline detection
3. **Custom hooks** - Business logic without UI
4. **Utility functions** - Helpers, formatters, validators

**Coverage Target:** 80%+ of business logic

**Deliverables:**
- 40-50 unit tests
- Mock Tauri commands
- Test utilities for common patterns

---

## Phase 5: Frontend Integration Tests (Week 5)

**Goal:** Test user interactions with mocked backend

### Target Flows

1. **Comment submission**
   - Single comment, review comment, reply
   - Draft persistence to localStorage
   - Error handling and retry UI
   - Mode switching (single vs review)

2. **File navigation**
   - File list rendering
   - Viewed state tracking
   - History navigation (back/forward)
   - File switching with scroll restoration

3. **Offline mode**
   - Cache miss handling
   - Network recovery
   - Cached data display
   - Stale data indicators

4. **Draft management**
   - Draft creation/restoration
   - Multi-file draft tracking
   - Draft cleanup on submission

**Coverage Target:** 70%+ of user interactions

**Deliverables:**
- 60-70 integration tests
- MSW handlers for Tauri commands
- Component test utilities

---

## Phase 6: E2E Tests (Week 6)

**Goal:** Test complete user workflows in browser environment

### Critical Paths

1. **Happy path:** Login → Select repo → View PR → Add comment → Submit
2. **Offline path:** Start offline → Load cached PR → Go online → Submit comment
3. **Review path:** Add multiple comments → Submit batch → Handle rate limiting
4. **Error path:** PR locked → Show error → Retry different PR

**Tools:** Playwright with Tauri

**Coverage Target:** 5-10 critical user journeys

**Deliverables:**
- 10-15 E2E tests
- GitHub API mock server
- Test data seeding

---

## Phase 7: Snapshot Testing (Ongoing)

**Goal:** Catch unintended changes during refactoring

### Backend Snapshots (insta)

- API response parsing
- Review log file format
- Error message formatting

### Frontend Snapshots (Vitest)

- Component rendering
- Comment thread structure
- PR list layout
- File diff display

**Deliverables:**
- 20-30 snapshot tests
- Baseline snapshots committed to git

---

## Phase 8: Performance Benchmarks (Week 7)

**Goal:** Prevent performance regressions during refactor

### Metrics to Track

1. **Typing latency** - Comment editor responsiveness (< 16ms)
2. **Scroll sync delay** - Source ↔ Preview lag (< 50ms)
3. **App startup time** - Ready to interact (< 2s)
4. **PR load time** - First paint with data (< 3s)
5. **Batch comment submission** - 50 comments (< 60s with spacing)

**Tools:**
- Vitest benchmarks
- Playwright performance API
- Custom timing instrumentation

**Deliverables:**
- Baseline performance metrics
- Automated performance tests
- Regression alerts

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Tests
on: [push, pull_request]
jobs:
  backend-tests:
    runs-on: [ubuntu, windows, macos]
    steps:
      - cargo test --all
      - cargo test --tests (integration)
  
  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - npm run test:unit
      - npm run test:integration
      - npm run test:e2e
      - npm run test:coverage
  
  coverage:
    - Upload to Codecov
    - Fail if coverage < 75%
```

### Branch Protection Rules

- Require all tests pass before merge
- Require coverage not to decrease
- Block direct commits to main
- Require code review

---

## Pre-Refactor Baseline

### Establish Green Baseline

1. **Run full test suite** - All tests pass (green)
2. **Capture coverage report** - Baseline coverage percentage
3. **Record performance metrics** - Baseline timing data
4. **Snapshot current UI** - Before/after visual comparison
5. **Document known issues** - Expected failures

### Refactoring Rules

- **Never refactor and fix bugs simultaneously** - One change type at a time
- **Keep tests green** - If tests fail, rollback immediately
- **Refactor in small increments** - One hook, one module at a time
- **Test after each change** - Run relevant test suite
- **Monitor coverage** - Should not decrease during refactor

---

## Incremental Refactoring Strategy

### Phase-by-Phase Approach

**Phase 1: Extract useAuth hook**
1. Write tests for current auth behavior
2. Extract hook from App.tsx
3. Run tests to verify equivalence
4. Deploy behind feature flag
5. Monitor production for 1 week
6. Remove old code

**Phase 2-8: Repeat for each hook**

### Feature Flag Implementation

```typescript
const USE_REFACTORED_HOOKS = import.meta.env.VITE_USE_REFACTORED || false;

function App() {
  if (USE_REFACTORED_HOOKS) {
    return <AppRefactored />;
  }
  return <AppLegacy />;
}
```

---

## Test Organization

### Directory Structure

```
app/
├── src/
│   ├── __tests__/           # Frontend unit tests
│   │   ├── hooks/
│   │   ├── utils/
│   │   └── components/
│   ├── __integration__/     # Frontend integration tests
│   └── setupTests.ts
├── tests/                   # E2E tests
│   ├── fixtures/
│   ├── e2e/
│   └── helpers/
└── src-tauri/
    ├── src/
    │   └── tests/           # Inline unit tests (#[cfg(test)])
    └── tests/               # Backend integration tests
        ├── github_api.rs
        ├── auth_flow.rs
        └── review_storage.rs
```

---

## Success Criteria

### Test Coverage Targets

- **Backend:** 80%+ line coverage
- **Frontend hooks:** 90%+ line coverage
- **Frontend components:** 70%+ line coverage
- **E2E critical paths:** 100% coverage

### Quality Gates

- ✅ All tests pass before refactoring starts
- ✅ Tests remain green during refactoring
- ✅ No coverage decrease during refactoring
- ✅ Performance metrics within 10% of baseline
- ✅ Zero critical bugs introduced by refactoring

### Timeline

- **Weeks 1-2:** Backend tests
- **Week 3:** Frontend refactoring
- **Weeks 4-5:** Frontend tests
- **Week 6:** E2E tests
- **Week 7:** Performance benchmarks
- **Week 8+:** Incremental refactoring with tests

---

## Risk Mitigation

### High-Risk Refactoring Areas

1. **Comment submission flow** - Most complex, highest user impact
   - Strategy: Extract last, test most thoroughly
   - Fallback: Keep old code path for 1 month

2. **Scroll sync** - Performance-critical, complex geometry
   - Strategy: Performance tests + visual regression
   - Fallback: Feature flag for gradual rollout

3. **Offline cache** - Data integrity risk
   - Strategy: Extensive testing with timing variations
   - Fallback: Cache version bump forces rebuild

### Rollback Plan

- Keep old code in separate branch
- Feature flags for instant rollback
- Database migration reversibility
- User data backup before refactor

---

## Next Steps

1. ✅ Review and approve this strategy document
2. ✅ Review backend test cases document
3. ✅ Review frontend test cases document
4. ⏳ Install testing dependencies
5. ⏳ Set up test infrastructure
6. ⏳ Create fixture data
7. ⏳ Begin Phase 1: Backend unit tests

---

## Appendix: Testing Philosophy

### Principles

- **Test behavior, not implementation** - Tests should survive refactoring
- **Arrange-Act-Assert pattern** - Clear test structure
- **One assertion per test** - Easy to identify failures
- **Descriptive test names** - Read like documentation
- **Fast feedback** - Unit tests < 1s total

### Anti-Patterns to Avoid

- ❌ Testing internal state
- ❌ Mocking too much (testing mock behavior)
- ❌ Brittle tests (break on unrelated changes)
- ❌ Flaky tests (non-deterministic failures)
- ❌ Slow tests (> 10s for integration)

### When to Write Tests

- ✅ Before fixing bugs (regression test)
- ✅ Before refactoring (safety net)
- ✅ After adding features (prevent breakage)
- ✅ When encountering edge cases (document behavior)

---

**Document Version:** 1.0  
**Last Updated:** December 20, 2025  
**Next Review:** After test case approval

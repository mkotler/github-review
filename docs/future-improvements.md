# Future Improvements

This document tracks potential enhancements and features for the GitHub Review application.

## Thread Resolution Support

### Overview

Add the ability to resolve/unresolve comment threads in pull request reviews, similar to the native GitHub interface. This would allow users to mark conversations as resolved once the feedback has been addressed.

### Current State

The application uses the GitHub REST API v3 exclusively for all GitHub interactions. The REST API does **not** support resolving or unresolving review comment threads.

### Technical Requirements

#### API Support

Thread resolution is only available through the **GitHub GraphQL API v4**, not the REST API. The relevant GraphQL mutations are:

- **`resolveReviewThread`** - Marks a review thread as resolved
  - Input: `ResolveReviewThreadInput!`
  - Returns: `PullRequestReviewThread`
  - Requires the thread ID (GraphQL node ID)

- **`unresolveReviewThread`** - Marks a review thread as unresolved
  - Input: `UnresolveReviewThreadInput!`
  - Returns: `PullRequestReviewThread`
  - Requires the thread ID (GraphQL node ID)

#### Implementation Considerations

1. **Add GraphQL Support to Backend**
   - Current implementation (`app/src-tauri/src/github.rs`) only uses REST API endpoints
   - Need to add GraphQL client/HTTP handler for mutations and queries
   - GraphQL endpoint: `https://api.github.com/graphql` (POST requests)
   - Authentication: Same token, passed as `Authorization: Bearer <token>`

2. **ID Translation**
   - GraphQL uses global node IDs (e.g., `MDI0OlB1bGxSZXF1ZXN0UmV2aWV3Q29tbWVudDEw`)
   - REST API uses numeric IDs (e.g., `10`)
   - REST API responses include `node_id` field that can be used for GraphQL queries
   - Need to store/track node IDs alongside numeric IDs

3. **Query Thread Resolved Status**
   - When fetching PR comments, need to also query the resolved status
   - GraphQL query example:

     ```graphql
     query {
       repository(owner: "owner", name: "repo") {
         pullRequest(number: 123) {
           reviewThreads(first: 100) {
             nodes {
               id
               isResolved
               comments(first: 100) {
                 nodes {
                   id
                   databaseId
                   body
                 }
               }
             }
           }
         }
       }
     }
     ```

4. **UI Changes Required**
   - Add "Resolve conversation" / "Unresolve conversation" buttons to comment threads
   - Visual indicator for resolved threads (e.g., collapsed view, different styling)
   - Filter option to show/hide resolved threads
   - Update thread state in local storage for offline reviews

5. **Local Review Integration**
   - Decide how resolved state should work for local (unpublished) reviews
   - Store resolved status in local review data structure
   - Sync resolved state when publishing review to GitHub

### Alternative Approaches

#### Option 1: Full GraphQL Migration

- Migrate all GitHub API calls to GraphQL
- Pros: Access to all GitHub features, more flexible queries
- Cons: Major refactor, GraphQL has different query patterns


#### Option 2: Hybrid Approach (Recommended)

- Keep REST API for existing functionality
- Add GraphQL client specifically for thread resolution
- Pros: Minimal changes to working code, targeted feature addition
- Cons: Maintaining two API clients


#### Option 3: Defer Until REST API Support

- Wait for GitHub to add thread resolution to REST API
- Pros: No architectural changes needed
- Cons: May never happen (feature request discussions date back to 2017)


### References

- [GitHub GraphQL API Mutations - resolveReviewThread](https://docs.github.com/en/graphql/reference/mutations#resolvereviewthread)
- [GitHub GraphQL API Mutations - unresolveReviewThread](https://docs.github.com/en/graphql/reference/mutations#unresolvereviewthread)
- [Reddit Discussion: Fetching resolved PR reviews in REST API](https://www.reddit.com/r/github/comments/qh9lib/fetching_resolved_pull_request_reviews_in_the/)
- [VS Code Issue #127473: Comments API resolved/unresolved threads](https://github.com/microsoft/vscode/issues/127473)

### Estimated Effort

- **Medium-Large** (2-3 days)
  - GraphQL client setup: 4-6 hours
  - Resolve/unresolve mutations: 2-3 hours
  - Query integration for resolved status: 3-4 hours
  - UI implementation: 4-6 hours
  - Local storage integration: 2-3 hours
  - Testing: 3-4 hours


### Priority

- **Medium** - Nice to have for feature parity with GitHub's native interface, but not critical for core review functionality


---

## Other Potential Improvements

_This section can be expanded with additional future enhancement ideas as they are identified._

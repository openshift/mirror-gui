# Mirror-GUI — Architecture Evaluation Report

**Date:** July 2026  
**Sources:** Codebase analysis + two independent architecture reviews  
**Audience:** Engineering team (mixed background)

---

## Deployment Context

Mirror-GUI is a **single-user, localhost tool**. The user runs it on their own machine and accesses it from their own browser on a local port (default `3000`). It is never exposed to the internet or to other users on a network.

**Workflow:**
1. **Connected side** — user runs the app on a machine with internet access; the app downloads content from Red Hat registries via `oc-mirror`
2. **Disconnected side** — user runs the app on an air-gapped machine; the app pushes the mirrored content to internal registries

This is the same deployment model as tools like Jupyter Notebook or pgAdmin. It shapes the security evaluation significantly.

---

## Overall Verdict

> The project is a **solid, well-built tool** with good engineering practices.  
> The main action items are **reliability and maintainability**, not security.

| Area | Grade |
|---|---|
| Security | B (acceptable for single-user localhost tool) |
| Code Quality | B |
| Architecture | B |
| Testing | B+ |
| UI/UX | A |
| Build & Deploy | B |
| Documentation | A |

---

## 🟠 High Priority — Reliability & Correctness

### 1. Running Jobs Are Lost on Server Restart
**What it means:** The list of active mirror jobs lives only in memory. If the app is restarted or crashes while `oc-mirror` is running:
- The `oc-mirror` process keeps running in the background (invisible, consuming disk/CPU)
- The job record stays permanently stuck as "running" in the UI with no way to recover it

**Fix:** On startup, scan saved job records for any stuck in `running` status and mark them `failed`.

---

### 2. The Server File Is Too Large to Maintain
**What it means:** All backend logic — routes, business logic, process management, credential handling — lives in a single 2,351-line file (`server/index.ts`). Finding, changing, or testing any individual behaviour requires navigating the whole file.

**Fix:** Split into dedicated folders: `routes/`, `services/`, `middleware/`.

---

### 3. The Largest UI Page Is Too Large to Maintain
**What it means:** The mirror configuration page (`MirrorConfig.tsx`, 2,401 lines) mixes layout, form logic, YAML generation, and validation in one file. Any change risks breaking unrelated things.

**Fix:** Break into smaller focused components (e.g. `PlatformChannelForm`, `OperatorsForm`, `YamlPreviewTab`).

---

### 4. No Error Boundaries in the UI
**What it means:** If any part of the UI crashes due to unexpected data, the **entire application goes blank** with no way to recover other than a full page refresh.

**Fix:** Add React Error Boundaries around each page so a crash in one section doesn't take down the whole app.

---

### 5. No Frontend Component Tests
**What it means:** Backend code has strong test coverage. The frontend — including complex logic like YAML generation and form validation — is only tested through high-level end-to-end tests. Bugs in that logic can go undetected.

**Fix:** Add React Testing Library tests for the main page components, especially `MirrorConfig`.

---

## 🟡 Medium Priority — Code Quality

### 6. File Path Parameters Not Explicitly Validated
**What it means:** Some API parameters that accept file paths rely on an implicit filesystem check rather than validating the format upfront. A crafted path could access unintended files on the machine.

**Fix:** Apply an explicit pattern check to reject paths containing unexpected characters (e.g. `..`).

---

### 7. API Calls Are Scattered Across All Pages
**What it means:** Every UI page calls the API directly, with duplicated error handling and no caching. This makes it harder to change the API or add features like retry logic.

**Fix:** Create a single `src/api/client.ts` module that all pages use.

---

### 8. Duplicate Utility Functions
**What it means:** Functions like `formatDuration()` and `formatBytes()` are copy-pasted across multiple files. A bug fix must be applied in every copy.

**Fix:** Move them to a single shared `src/utils.ts` file.

---

### 9. Dead Dependencies
**What it means:** `node-cron` and `multer` are listed as dependencies but are not used anywhere. They add maintenance overhead and a potential future vulnerability surface.

**Fix:** Remove them from `package.json`.

---

### 10. YAML Viewer Injects HTML Without Sanitization
**What it means:** The YAML syntax highlighter renders HTML directly into the page. The library used (highlight.js) is generally safe, but there is no backup sanitization layer.

**Fix:** Pass output through `DOMPurify` before rendering — a one-line addition.

---

### 11. Status Updates Feel Slow
**What it means:** After starting or stopping an operation, the UI waits for the next polling cycle (up to 5 seconds) before reflecting the change.

**Fix:** Update the UI immediately on user action, then confirm with the server response.

---

### 12. Large Lists Have No Performance Optimization
**What it means:** The operators list and operation history render all items at once. With large datasets this can slow down or freeze the browser tab.

**Fix:** Add virtual scrolling so only visible rows are rendered.

---

### 13. Redundant Data Fetching
**What it means:** Multiple pages independently call the same system status endpoints, causing duplicate network requests every time the user navigates.

**Fix:** Use a shared cache layer (e.g. TanStack Query) for server state.

---

## 🔵 Good Practice — Low Priority for This Use Case

These items are standard recommendations for internet-facing or multi-user apps. They are not blockers for a single-user localhost tool, but worth keeping in mind if the scope ever expands.

| Item | Note |
|---|---|
| Authentication | Not needed when only the operator can reach the port. Revisit if ever run on a shared machine or LAN. |
| Restrict CORS to localhost | A malicious website visited in the same browser could theoretically call the API. Very low risk for a local tool. |
| Validate registry URLs against an allow-list | Relevant if the tool were exposed to untrusted users. |
| HTTP security headers | Relevant mainly for internet-facing apps. |
| Disable source maps in production build | Only the operator can open dev tools, so this is not a concern. |

---

## 🟢 What Is Already Good

These are genuine strengths — no action needed:

- **TypeScript everywhere** — both frontend and backend, with strict mode, catching many bugs before runtime
- **271 automated tests** across unit, integration, end-to-end, and data integrity tiers
- **PatternFly design system** — accessibility (WCAG 2.1) built in by the UI framework
- **Real-time log streaming** — uses Server-Sent Events (SSE), the right approach for unidirectional live data
- **Multi-stage container build** — clean, minimal production image with proper privilege dropping
- **Dual CI pipeline** (GitHub Actions + Prow) runs on every pull request
- **Catalog fallback** — app works on first boot without requiring a catalog sync
- **Strong documentation** — `API.md`, `TESTS.md`, `README.md` are all thorough
- **Dark mode support** with system preference detection
- **Accessible by default** via PatternFly components

---

## Summary Checklist

| # | Item | Priority |
|---|---|---|
| 1 | Reconcile orphaned jobs on server restart | 🟠 High |
| 2 | Split `server/index.ts` into modules | 🟠 High |
| 3 | Split `MirrorConfig.tsx` into sub-components | 🟠 High |
| 4 | Add React Error Boundaries | 🟠 High |
| 5 | Add frontend component tests | 🟠 High |
| 6 | Validate file path parameters explicitly | 🟡 Medium |
| 7 | Create a shared API client module | 🟡 Medium |
| 8 | Centralize duplicate utility functions | 🟡 Medium |
| 9 | Remove unused dependencies | 🟡 Medium |
| 10 | Sanitize YAML viewer HTML output | 🟡 Medium |
| 11 | Add optimistic UI updates | 🟡 Medium |
| 12 | Add virtual scrolling for large lists | 🟡 Medium |
| 13 | Add shared server-state cache layer | 🟡 Medium |
| 14 | Add authentication | 🔵 Good practice (revisit if scope expands) |
| 15 | Restrict CORS to localhost | 🔵 Good practice |
| 16 | Validate registry URLs against allow-list | 🔵 Good practice |
| 17 | Add HTTP security headers | 🔵 Good practice |
| 18 | Disable source maps in production | 🔵 Good practice |

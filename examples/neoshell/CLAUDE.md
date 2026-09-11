## Working on the shell

This is the GTK build: one GJS process, Svelte components compiled to GTK4
widgets through `@neoworks/svelte-gtk4` (the repository root), one
gtk4-layer-shell window per top-level view-tree node. `ARCHITECTURE.md`,
`README.md` and `Taskfile.yml` here still describe the earlier webview/bun
build and are out of date; `apps/` and `packages/` are that build's remains.

- **Entry points.** `src/main.ts` boots kernel + bus + `Shell.svelte`;
  `src/host/plugins/viewTree.ts` holds the default view tree (the user's
  `~/.config/neoshell/config.json` has no `views` key, so this is what runs).
  Views live in `src/extensions/<id>/`, styles in `style.css` (GTK CSS, see
  the root `CLAUDE.md` for what GTK CSS lacks and how the cascade behaves).
- **Verify with**, from the repository root: `task typecheck`, then in this
  directory `node build.mjs` and `task neoshell:smoke` (builds every view in
  a plain window and exits). `bun run lint` has a pre-existing baseline of
  ~60 errors in the old `apps/`/`packages/` trees and a few `Set`-reactivity
  nits; only new findings in files you touched count.
- **The shell is running in the user's session** (`task neoshell` under
  go-task). Do not restart it or take screenshots yourself — ask the user to
  capture what you need to see, and tell them when a rebuild is needed for a
  change to show.
- **Desktop interaction model** (`src/extensions/neoshell/`): Finder-like.
  A press on an icon selects on mouse-down; a drag carries translucent ghosts
  that track the pointer 1:1 while the originals stay; only the drop is
  snapped (`freeform.ts` — screen edges and neighbours' edges), then the
  icons glide into place (`glide.ts`). Rubber band on the background,
  ctrl-click toggles. Widgets lift on grab, show a filled placeholder at the
  landing, and glide there or back if the spot is taken.
- **Quick settings** is a full-output `top` window: a transparent `input`
  backdrop dismisses it on click-away; the panel hangs at
  `args.offsetTop`/`args.offsetEnd`.

## Style

Neoworks uses a shared design system defined in the `@neoworks-dev/ui`
package. It is a local package symlinked into projects via `bun link` — the
copy under `node_modules/@neoworks-dev/ui` is the real package source, not a
vendored dependency.

- Before creating a new component, check `@neoworks-dev/ui` for an existing
  one that fits. If you create a new one, follow the design system
  guidelines and briefly note which existing components you considered and
  why they didn't fit.
- Never edit anything under `node_modules/`, including
  `node_modules/@neoworks-dev/ui`. Changes to the design system happen in
  the ui package's own repository, and only when explicitly asked.
- If `@neoworks-dev/ui` is missing or unresolved, restore it with
  `bun link @neoworks-dev/ui`. Do not install it from a registry, remove
  the dependency, or copy components into the app as a workaround. If
  linking fails, report it and stop.

## Code Style

Prioritize readability and maintainability over cleverness.

- Preserve descriptive names. Do not shorten identifiers.
  - Good: `recordId`, `customerAccount`, `paymentMethod`
  - Bad: `rid`, `acct`, `pm`
- Use `camelCase` for variables, functions, parameters, and object fields
  unless the language, framework, or existing codebase requires otherwise.
- Prefer explicit control flow. Avoid `??`, ternary `?:`, and compact
  conditionals; the only exception is when the explicit form would require
  duplicating a non-trivial expression — a preference for brevity alone is
  not an exception.
- Maximum 2 indentation levels inside a function body. Use guard clauses,
  early returns, or helper functions instead. Extracted helpers must be
  self-contained and meaningfully named — do not split a function into
  arbitrary fragments just to satisfy the indent limit.
- Keep functions short, with one clear responsibility each.
- Comments: only where the code is not readable when skimming. Comments must
  be technical and concise. Never write comments that restate the code, and
  never write historical comments — these are dev projects, so do not
  document old decisions, previous implementations, or what changed
  (no "previously...", "changed from...", "used to...").
- Do not change behavior, public APIs, data shapes, validation rules, or
  side effects unless explicitly asked. If a required refactor (e.g. for the
  indent rule) would change behavior, stop and ask instead.
- Matching surrounding code style applies only to surface conventions
  (naming casing, quoting, import order, formatting). Existing code that
  violates the structural rules above is not a license to violate them in
  new code — these rules take precedence.

## Tests

After completing your changes, and before committing:

1. Decide whether any change needs a new test. Behavior changes and bug
   fixes need one; pure refactors and comment/style edits do not. If you
   decide no new test is needed, say so in one sentence.
2. Run the project's test suite regardless of whether you wrote a new test.
   Determine the command in this order:
   - a repo-specific instruction file (CLAUDE.md / AGENTS.md) or README
     that names a test command
   - a task runner target: `Makefile`, `justfile`, `Taskfile`, or package
     scripts (`test` target/script)
   - the ecosystem default: `bun test` / `npm test` for JS/TS, `go test
./...` for Go, `ctest` or the configured test target for C++/CMake
3. If no test setup exists, do not invent one and do not silently skip:
   state that the project has no tests, and at minimum verify the project
   still builds/compiles (or runs, for interpreted projects).
4. If tests fail, fix the code until they pass. Never delete, skip, weaken,
   or rewrite a test to make it pass unless the test itself is wrong — and
   if so, say so explicitly and explain why.

## Git

You may use git. Work in this order: change → test → commit → push.

- If the worktree is dirty before you start, commit the existing state
  separately with the message `wip: pre-existing changes`. Never mix pre-existing changes into your own commits.
- Commit at each logically complete step (a step that builds and passes
  tests), not one giant commit at the end.
- Commit messages: short, to-the-point title; add a body only when the
  change is not obvious from the title. If a change spans unrelated
  concerns, split it into multiple commits.
- No commit you author may include the trailer
  `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Push only after tests pass. Never force-push.

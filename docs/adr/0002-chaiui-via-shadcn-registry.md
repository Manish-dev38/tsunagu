# ChaiUI via the shadcn registry

We restyle the entire app to the ChaiUI design system (the chaicode.com look) by bootstrapping shadcn into this Next.js repo: a `components.json` pointing at the `@chaiui` registry (`https://ui.chaicode.com/r/{name}.json`), `@chaiui/chaiui` installed as the theme first, then components pulled with `npx shadcn@latest add @chaiui/<name>` into `src/registry/chaiui/ui/`. Tokens, backdrop, and utilities with no shipped component are hand-ported from the prototype's `styles.css` into `src/app/globals.css`. The rewrite is built one screen at a time so each unit ships, verifies, and closes independently.

## Considered Options

- **Hand-port only (rejected)** — copy the token blocks and utilities straight from `styles.css` into `globals.css` and build every screen from the prototype's markup. Recommended first for being the smallest change with no new dependency. Rejected: the user chose the registry path to get the real component implementations (focus states, `cva` variants, Radix behaviour) rather than approximating them, accepting the cost of new runtime deps (`@radix-ui/react-slot`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`) and a `src/registry/` tree.
- **ChaiUI via the shadcn registry (chosen)** — one `components.json` + `@chaiui/chaiui` theme install, components as code we own and can edit, tokens hand-ported where nothing ships.

## Consequences

- `components.json`, `src/registry/chaiui/`, and the `@radix-ui`/`lucide-react`/`cva` dependencies become permanent app surface; a future reader must check this ADR to see why a Next.js app carries shadcn machinery.
- Components land as editable source, not `node_modules` imports — local edits are allowed but drift from the registry on upgrade; re-adding an item overwrites local changes.
- Every unit's review must hold against the ChaiUI rules (dark default, orange never a fill, one white asymmetric button per screen, no shadows, sentence case, status as text+dot) rather than "looks close".
- The prototype wins every conflict with previously shipped decisions (explicitly superseding the #14 Routine day labels), so earlier tickets are history, not contract.

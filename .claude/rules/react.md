# React
Conventions for writing React components with modern patterns.

## Components
- Use functional components exclusively. No class components.
- One component per file; export the component as the default export.
- Keep components small and focused — extract sub-components or hooks when a file exceeds ~150 lines or a single responsibility.
- Use composition (children prop, render props, or slots) over inheritance and deep prop drilling.
- Read the existing component before editing — match its style, export pattern, and surrounding conventions.

## Hooks
- Follow the Rules of Hooks: call only at the top level, only in components or custom hooks.
- Extract reusable stateful logic into custom hooks (`use*.ts`) rather than duplicating in components.
- Get dependency arrays right in `useEffect` and `useMemo`. Include every reactive value the effect reads; run `tsc` to catch React compilation warnings.
- Add cleanup functions for subscriptions, timers, and event listeners in `useEffect`.

## State
- Use `useState` for simple local state, `useReducer` for state with complex transitions.
- Keep state as close to where it is consumed as possible. Lift state up only when sibling components need it.
- Use Context only when prop drilling through more than 3 levels is unavoidable.
- Prefer server state libraries (TanStack Query, SWR) over `useState`+`useEffect` for fetched data.

## Rendering Performance
- Use `React.memo` only when profiling shows unnecessary re-renders on a pure component with stable props.
- Use `useMemo` and `useCallback` only when the computation or reference identity matters (e.g., as a dependency or prop to a memoized child), not preemptively.
- Always provide a stable `key` prop for list items — never use array index as key when items can reorder or be removed.

## Forms and Errors
- Use controlled components. Wire up validation and show field-level errors before submission.
- Wrap feature trees in Error Boundaries with fallback UI so one broken component does not crash the whole page.

## Testing
- Write tests with React Testing Library. Test user behavior (queries by role/text, userEvent), not implementation details.
- Run the relevant test suite and confirm it passes before declaring a component change done.

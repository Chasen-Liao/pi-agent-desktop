# Next.js
Conventions for building apps with Next.js App Router.

## Router and Structure
- Use the App Router (`app/` directory). Pages are `app/` route segments with `page.tsx` exports.
- Co-locate route-specific components in the same `app/` segment; shared components go in `components/`, utilities in `lib/`.
- Use lowercase-dash directory names (e.g., `components/auth-wizard/`).
- Read the existing `app/` layout and routing structure before adding new routes or components.

## Server vs Client Components
- Default to Server Components. Only add `'use client'` when the component needs interactivity, hooks, or browser APIs.
- Keep the client boundary as low as possible — push state and effects down into leaf components.
- Wrap lazy-loaded or async client components in `<Suspense>` with a meaningful fallback UI.

## Data Fetching and Caching
- Fetch data in Server Components using `async/await` or server actions. Avoid `useEffect` for data fetching.
- Respect Next.js caching defaults; use `revalidate` or `noStore` only when the use-case demands it.
- For mutations, use Server Actions or route handlers — not client-side `fetch` to own API routes.

## Performance
- Use `next/image` with explicit `width`/`height` or `fill` and proper `sizes` hints.
- Use `next/dynamic` for components that are below the fold or conditionally rendered.
- Avoid unnecessary `useState` and `useEffect` in Server Component trees.

## Forms and Validation
- Use Zod schemas (or the project's existing validation library) for both client and server-side validation.
- Show loading and error states during form submission; do not silently swallow submission errors.

## Type Safety
- Read existing types/interfaces in the project before defining new ones. Follow the project's typing patterns.
- Co-locate props interfaces with their component files; export only when shared.

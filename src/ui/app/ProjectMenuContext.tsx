import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';
import type { ProjectSession, ProjectSessionState } from '../../app/persistence';

/**
 * The project session for the shell (src/app/persistence.ts). The composition root provides it
 * (src/main.tsx); without a provider (component tests of the shell) there is no project storage and
 * the top bar's project actions say so.
 */

const ProjectSessionContext = createContext<ProjectSession | null>(null);

export function ProjectSessionProvider({ session, children }: { readonly session: ProjectSession | null; readonly children?: ReactNode }) {
  return <ProjectSessionContext value={session}>{children}</ProjectSessionContext>;
}

/** The session from the nearest provider, or null. */
export function useProjectSession(): ProjectSession | null {
  return useContext(ProjectSessionContext);
}

const noSubscribe = () => () => undefined;
const noState = () => null;

/** The session's state, re-rendering on every change; null without a session. */
export function useProjectSessionState(session: ProjectSession | null): ProjectSessionState | null {
  return useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getState ?? noState, session?.getState ?? noState);
}

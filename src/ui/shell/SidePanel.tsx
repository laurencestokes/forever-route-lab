import type { ReactNode } from 'react';
import { formatInteger } from '../lib/format';
import { describeIssueCounts, totalIssues, worstSeverity, type IssueCounts } from '../lib/issues';
import { SeverityIcon } from '../markers/SeverityIcon';
import { Tabs, type TabDefinition } from './Tabs';
import './SidePanel.css';

export type SidePanelTabId = 'available' | 'questLog' | 'details' | 'validation';

export const SIDE_PANEL_TAB_LABELS: Readonly<Record<SidePanelTabId, string>> = {
  available: 'Available',
  questLog: 'Quest log',
  details: 'Details',
  validation: 'Validation',
};

export const SIDE_PANEL_TAB_ORDER: readonly SidePanelTabId[] = ['available', 'questLog', 'details', 'validation'];

export interface SidePanelCounts {
  /** Quests available at the active step; null while unknown. */
  readonly available?: number | null | undefined;
  /** Quest log fill at the active step. */
  readonly questLog?: { readonly used: number; readonly capacity: number | null } | null | undefined;
  readonly validation?: IssueCounts | null | undefined;
}

export interface SidePanelProps {
  readonly activeTab: SidePanelTabId;
  readonly onTabChange: (tab: SidePanelTabId) => void;
  /** Panel content, one per tab; only the active one is mounted. */
  readonly available: ReactNode;
  readonly questLog: ReactNode;
  readonly details: ReactNode;
  readonly validation: ReactNode;
  readonly counts?: SidePanelCounts | undefined;
}

function tabDefinitions(counts: SidePanelCounts): TabDefinition<SidePanelTabId>[] {
  return SIDE_PANEL_TAB_ORDER.map((id): TabDefinition<SidePanelTabId> => {
    const label = SIDE_PANEL_TAB_LABELS[id];
    switch (id) {
      case 'available': {
        const n = counts.available;
        if (n === undefined || n === null) return { id, label };
        return { id, label, badge: formatInteger(n), badgeLabel: `${formatInteger(n)} available` };
      }
      case 'questLog': {
        const log = counts.questLog;
        if (log === undefined || log === null) return { id, label };
        const text = log.capacity === null ? formatInteger(log.used) : `${formatInteger(log.used)}/${formatInteger(log.capacity)}`;
        const words =
          log.capacity === null ? `${formatInteger(log.used)} quests` : `${formatInteger(log.used)} of ${formatInteger(log.capacity)} quests`;
        return { id, label, badge: text, badgeLabel: words };
      }
      case 'details':
        return { id, label };
      case 'validation': {
        const issues = counts.validation;
        if (issues === undefined || issues === null) return { id, label };
        const worst = worstSeverity(issues);
        if (worst === null) return { id, label, badgeLabel: 'no issues' };
        return {
          id,
          label,
          badge: (
            <>
              <SeverityIcon severity={worst} labelled={false} size={12} />
              {formatInteger(totalIssues(issues))}
            </>
          ),
          badgeLabel: describeIssueCounts(issues),
        };
      }
    }
  });
}

/** The right-hand panel: Available, Quest log, Details, Validation (ARCHITECTURE §12.4). */
export function SidePanel({ activeTab, onTabChange, available, questLog, details, validation, counts = {} }: SidePanelProps) {
  const content: Readonly<Record<SidePanelTabId, ReactNode>> = { available, questLog, details, validation };
  return (
    <div className="frl-sidepanel">
      <Tabs label="Side panel" tabs={tabDefinitions(counts)} selectedId={activeTab} onSelect={onTabChange}>
        {content[activeTab]}
      </Tabs>
    </div>
  );
}

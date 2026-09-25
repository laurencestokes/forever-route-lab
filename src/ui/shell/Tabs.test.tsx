// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidePanel, type SidePanelTabId } from './SidePanel';
import { Tabs, nextEnabledTab, type TabDefinition } from './Tabs';

afterEach(cleanup);

type Id = 'a' | 'b' | 'c' | 'd';
const TABS: readonly TabDefinition<Id>[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma', disabled: true },
  { id: 'd', label: 'Delta' },
];

function Harness({ onSelect }: { onSelect?: (id: Id) => void }) {
  const [selected, setSelected] = useState<Id>('a');
  return (
    <Tabs
      label="Test tabs"
      tabs={TABS}
      selectedId={selected}
      onSelect={(id) => {
        onSelect?.(id);
        setSelected(id);
      }}
    >
      <p>Panel {selected}</p>
    </Tabs>
  );
}

describe('nextEnabledTab', () => {
  const enabled = [true, true, false, true];
  it('moves right and left, wrapping, and skips disabled tabs', () => {
    expect(nextEnabledTab('ArrowRight', 0, enabled)).toBe(1);
    expect(nextEnabledTab('ArrowRight', 1, enabled)).toBe(3);
    expect(nextEnabledTab('ArrowRight', 3, enabled)).toBe(0);
    expect(nextEnabledTab('ArrowLeft', 0, enabled)).toBe(3);
    expect(nextEnabledTab('ArrowLeft', 3, enabled)).toBe(1);
  });

  it('jumps to the first and last enabled tabs', () => {
    expect(nextEnabledTab('Home', 3, [false, true, true, false])).toBe(1);
    expect(nextEnabledTab('End', 1, [false, true, true, false])).toBe(2);
  });

  it('ignores other keys and lists without enabled tabs', () => {
    expect(nextEnabledTab('ArrowDown', 0, enabled)).toBeNull();
    expect(nextEnabledTab('ArrowRight', 0, [false, false])).toBeNull();
    expect(nextEnabledTab('ArrowRight', 0, [])).toBeNull();
  });
});

describe('Tabs', () => {
  it('exposes tablist, tabs and the selected panel', () => {
    render(<Harness />);
    const tablist = screen.getByRole('tablist', { name: 'Test tabs' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    // One tab stop: the selected tab.
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    const panel = screen.getByRole('tabpanel');
    // One panel element with a stable id: every tab controls it, the selected one labels it.
    expect(panel.id).not.toBe('');
    expect(tabs.map((t) => t.getAttribute('aria-controls'))).toEqual([panel.id, panel.id, panel.id, panel.id]);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    expect(panel.textContent).toBe('Panel a');
  });

  it('keeps the panel id and relabels the panel when the selection changes', () => {
    render(<Harness />);
    const panelId = screen.getByRole('tabpanel').id;
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe(panelId);
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Beta' }).id);
    expect(screen.getAllByRole('tab').every((t) => t.getAttribute('aria-controls') === panelId)).toBe(true);
  });

  it('selects and focuses with the arrow keys, skipping disabled tabs', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const tab = (name: string) => screen.getByRole('tab', { name });
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
    expect(document.activeElement).toBe(tab('Beta'));
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel b');
    fireEvent.keyDown(tab('Beta'), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('d');
    expect(document.activeElement).toBe(tab('Delta'));
    fireEvent.keyDown(tab('Delta'), { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(tab('Alpha'), { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('d');
    fireEvent.keyDown(tab('Delta'), { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    expect(tab('Gamma')).toHaveProperty('disabled', true);
  });

  it('selects on click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Delta' }));
    expect(screen.getByRole('tab', { name: 'Delta' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel d');
  });
});

describe('SidePanel', () => {
  function Panel({ initial = 'available' as SidePanelTabId }) {
    const [tab, setTab] = useState<SidePanelTabId>(initial);
    return (
      <SidePanel
        activeTab={tab}
        onTabChange={setTab}
        available={<p>available content</p>}
        questLog={<p>quest log content</p>}
        details={<p>details content</p>}
        validation={<p>validation content</p>}
        counts={{ available: 42, questLog: { used: 12, capacity: 20 }, validation: { error: 2, warning: 1, info: 0 } }}
      />
    );
  }

  it('has the four tabs in order with counts spoken in words', () => {
    render(<Panel />);
    const names = screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label') ?? t.textContent);
    expect(names).toEqual(['Available (42 available)', 'Quest log (12 of 20 quests)', 'Details', 'Validation (2 errors, 1 warning)']);
    // The visual badge shows the worst severity's icon and the total.
    const validation = screen.getByRole('tab', { name: 'Validation (2 errors, 1 warning)' });
    expect(validation.textContent).toBe('Validation3');
    expect(validation.querySelector('[data-severity="error"]')).not.toBeNull();
  });

  it('mounts only the active panel', () => {
    render(<Panel />);
    expect(screen.getByRole('tabpanel').textContent).toBe('available content');
    fireEvent.click(screen.getByRole('tab', { name: /^Validation/ }));
    expect(screen.getByRole('tabpanel').textContent).toBe('validation content');
    expect(screen.queryByText('available content')).toBeNull();
  });
});

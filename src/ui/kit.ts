/**
 * The UI kit: presentational components and their view-model types (docs/UI.md). Components
 * take typed props and callbacks and never read the store; src/ui/App.tsx wires them up.
 */

// Helpers
export { cx } from './lib/cx';
export {
  formatDuration,
  formatDurationLong,
  formatInteger,
  formatLevel,
  formatPercent,
  plural,
} from './lib/format';
export {
  NO_ISSUES,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  countIssues,
  describeIssueCounts,
  totalIssues,
  worstSeverity,
  type IssueCounts,
} from './lib/issues';
export { knownReadout, readoutFromEstimate, unknownReadout, type Readout, type ReadoutFlags } from './lib/readout';
export {
  THEME_LABELS,
  THEME_PREFERENCES,
  applyThemePreference,
  isThemePreference,
  nextThemePreference,
  type ThemePreference,
} from './lib/theme';

// Primitives
export { Badge, PlaceholderTag, VisuallyHidden, type BadgeProps, type BadgeTone, type PlaceholderTagProps } from './primitives/Badge';
export { Button, type ButtonProps, type ButtonVariant, type ControlSize } from './primitives/Button';
export { Checkbox, type CheckboxProps } from './primitives/Checkbox';
export { Icon, type IconName, type IconProps } from './primitives/Icon';
export { IconButton, type IconButtonProps } from './primitives/IconButton';
export { PanelHeader, type PanelHeaderProps } from './primitives/PanelHeader';
export { Select, type SelectOption, type SelectOptionGroup, type SelectProps } from './primitives/Select';
export { TextInput, type TextInputProps } from './primitives/TextInput';
export { Toolbar, ToolbarSeparator, type ToolbarProps } from './primitives/Toolbar';

// Markers
export { AssumedMarker, type AssumedMarkerProps, type AssumedReason } from './markers/AssumedMarker';
export {
  DIFFICULTY_COLOUR_NAMES,
  DIFFICULTY_RANK,
  DIFFICULTY_TEXT,
  DifficultyLabel,
  describeDifficulty,
  type DifficultyLabelProps,
} from './markers/DifficultyLabel';
export { ProvenanceBadge, type ProvenanceBadgeProps } from './markers/ProvenanceBadge';
export {
  UNKNOWN_FOREVER_PROVENANCE,
  describeForeverProvenance,
  foreverProvenanceOf,
  type ForeverProvenance,
} from './markers/provenance';
export { ReadoutValue, type ReadoutValueProps } from './markers/ReadoutValue';
export { SeverityIcon, type SeverityIconProps } from './markers/SeverityIcon';
export { STEP_KIND_LABELS, StepTypeGlyph, type StepTypeGlyphProps } from './markers/StepTypeGlyph';

// Route list
export { RouteList, type RouteListProps } from './route/RouteList';
export { GroupRow, StepRow, describeStepRow, type GroupRowProps, type StepRowProps } from './route/StepRow';
export type { GroupRowModel, RouteRowModel, StepRowModel } from './route/rows';
export { DEFAULT_OVERSCAN, ROUTE_ROW_HEIGHT, type SelectionMode } from './route/virtual';

// Shell
export {
  AboutDialog,
  DATA_LICENCE_CARVE_OUT,
  DEFAULT_COPYRIGHT,
  NON_AFFILIATION,
  NO_WARRANTY,
  REPOSITORY_URL,
  type AboutDialogProps,
} from './shell/AboutDialog';
export {
  LoadErrorScreen,
  LoadingScreen,
  NO_RETRY_TEXT,
  formatMegabytes,
  loadingText,
  type BootProgress,
  type LoadErrorScreenProps,
  type LoadingScreenProps,
  type LoadRemedy,
} from './shell/BootScreen';
export { AppShell, LEFT_PANEL_DEFAULT, LEFT_PANEL_MAX, LEFT_PANEL_MIN, clampLeftWidth, type AppShellProps } from './shell/AppShell';
export {
  LayerPanel,
  MAP_CHOICE_WIDTH,
  MapFrame,
  MapHoverText,
  mapChoicePosition,
  type LayerPanelProps,
  type MapChoiceProps,
  type MapCommand,
  type MapEngineState,
  type MapFrameProps,
  type MapLayerRow,
} from './shell/MapFrame';
export { MAP_GRID_NOTE, MAP_KEY, MapGlyph, MapLegend, type MapGlyphKind, type MapGlyphProps, type MapKeyEntry, type MapKeySection } from './shell/MapLegend';
export { MapPlaceholder, PLANNED_MAP_LAYERS, type MapLayerStub, type MapPlaceholderProps } from './shell/MapPlaceholder';
export {
  DetailList,
  EmptyState,
  IssueList,
  PanelSection,
  QuestListItem,
  type DetailItem,
  type EmptyStateProps,
  type IssueListItem,
  type IssueListProps,
  type PanelSectionProps,
  type QuestListItemProps,
} from './shell/PanelContent';
export {
  SIDE_PANEL_TAB_LABELS,
  SIDE_PANEL_TAB_ORDER,
  SidePanel,
  type SidePanelCounts,
  type SidePanelProps,
  type SidePanelTabId,
} from './shell/SidePanel';
export { StatusBar, optimizerText, type OptimizerStatus, type StatusBarProps } from './shell/StatusBar';
export { Tabs, nextEnabledTab, type TabDefinition, type TabsProps } from './shell/Tabs';
export { BrandMark, PRODUCT_NAME, TopBar, type TopBarProps } from './shell/TopBar';
export { XpBar, xpBarState, type XpBarProps, type XpBarState } from './shell/XpBar';

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
export { RULE_LABELS, assumptionList, assumptionWords, type RuleParameter } from './lib/rule-labels';
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
export { Button, buttonLook, type ButtonProps, type ButtonVariant, type ControlSize } from './primitives/Button';
export { Checkbox, type CheckboxProps } from './primitives/Checkbox';
export type { ExternalLinkProps } from './primitives/ExternalLink';
export { Icon, type IconName, type IconProps } from './primitives/Icon';
export { IconButton, type IconButtonProps } from './primitives/IconButton';
export { PanelHeader, type PanelHeaderProps } from './primitives/PanelHeader';
export { SearchField, type SearchFieldProps } from './primitives/SearchField';
export type { SegmentedControlProps, SegmentedOption } from './primitives/SegmentedControl';
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
export {
  PENDING_CHECKING_TEXT,
  PENDING_TRAVEL_TEXT,
  PENDING_TRAVEL_TEXTS,
  PendingMarker,
  type PendingMarkerProps,
  type PendingTravel,
} from './markers/PendingMarker';
export {
  QUEST_MARK_COLOUR_MIN_PX,
  QUEST_MARK_GLYPHS,
  QUEST_MARK_PX,
  QUEST_MARK_STATE_ORDER,
  QuestMark,
  questMarkColour,
  type QuestMarkProps,
  type QuestMarkSize,
  type QuestMarkState,
} from './markers/QuestMark';
export { ReadoutValue, type ReadoutValueProps } from './markers/ReadoutValue';
export { SeverityIcon, type SeverityIconProps } from './markers/SeverityIcon';
export { StepMark, type StepMarkKind } from './markers/StepMark';
export { STEP_KIND_LABELS, StepTypeGlyph, type StepTypeGlyphProps } from './markers/StepTypeGlyph';

// Route list
export { RouteList, type RouteListProps } from './route/RouteList';
export { GroupRow, StepRow, describeStepRow, formatXpGained, type GroupRowProps, type StepRowProps } from './route/StepRow';
export {
  ESTIMATE_COLUMN_LABELS,
  ESTIMATE_COLUMNS,
  TOP_NUMBERS,
  type EstimateColumn,
  type GroupRowModel,
  type RouteRowModel,
  type RowIssue,
  type RowMarkState,
  type StepRowModel,
  type TopNumber,
} from './route/rows';
export { DEFAULT_OVERSCAN, ROUTE_ROW_HEIGHT, ROUTE_ROW_HEIGHT_TWO_LINE, ROW_DENSITIES, routeRowHeight, type RowDensity, type SelectionMode } from './route/virtual';

// Shell
// The About dialog is a lazy part (src/ui/app/lazy-parts.ts): a value export here would keep it in
// the entry chunk, so only its props type is exported; import the dialog from shell/AboutDialog.
export type { AboutDialogProps } from './shell/AboutDialog';
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
export {
  AppShell,
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  LEFT_PANEL_MIN,
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  clampLeftWidth,
  clampRightWidth,
  type AppShellProps,
  type ShellLayout,
} from './shell/AppShell';
export {
  MapFrame,
  MapHoverText,
  useMapRegionDocking,
  DRAWER_DOCK_MIN_PX,
  type MapCommand,
  type MapDrawerFrameProps,
  type MapEngineState,
  type MapFrameProps,
} from './shell/MapFrame';
// The Map layers drawer, its key and the map popover are lazy parts (src/ui/app/lazy-parts.ts): types only here.
export type { MapPopoverActionView, MapPopoverProps, MapPopoverQuestView, MapPopoverSectionView } from './shell/MapPopover';
export type { DrawerGroup, DrawerIcon, DrawerResult, DrawerRow, MapCategoryDrawerProps } from './shell/MapCategoryDrawer';
export type { MapKeyProps } from './shell/MapKey';
export { MapPlaceholder, PLANNED_MAP_LAYERS, type MapLayerStub, type MapPlaceholderProps } from './shell/MapPlaceholder';
// Parts used only by the lazy parts (Details, Validation, View, the drawer) are imported from their
// files: a value export here would keep them in the entry chunk (ui-refresh.md §10.3).
export type { DetailItem, IssueListItem, IssueListProps } from './shell/DetailParts';
export {
  EmptyState,
  PanelSection,
  QUEST_GRID_KEYS,
  QuestGrid,
  QuestGroupHeader,
  QuestListItem,
  QuestObjectiveRow,
  gridKeyTarget,
  type EmptyStateProps,
  type PanelSectionProps,
  type QuestGridProps,
  type QuestGroupHeaderProps,
  type QuestListItemProps,
  type QuestObjectiveRowProps,
  type QuestRowAction,
} from './shell/PanelContent';
export {
  SIDE_PANEL_TAB_LABELS,
  SIDE_PANEL_TAB_ORDER,
  SidePanel,
  type SidePanelCounts,
  type SidePanelProps,
  type SidePanelTabId,
} from './shell/SidePanel';
export { RouteSummary, type RouteSummaryProps, type RouteSummaryRow } from './shell/RouteSummary';
export { SimulationStatus, simulationStatusText, type SimulationStatusModel, type SimulationStatusProps } from './shell/SimulationStatus';
export { StatusBar, optimizerText, type OptimizerStatus, type StatusBarProps } from './shell/StatusBar';
export { Tabs, nextEnabledTab, type TabDefinition, type TabsProps } from './shell/Tabs';
export { BrandMark, PRODUCT_NAME, TopBar, type TopBarProps } from './shell/TopBar';
export { XpBar, xpBarState, type XpBarProps, type XpBarState } from './shell/XpBar';

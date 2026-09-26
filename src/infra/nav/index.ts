/** `infra/nav`: locates and loads the navigation manifest (terrain-navigation.md §9.6); the worker loads the rest. */
export { describeNavManifest, loadNavManifest, NAV_MANIFEST_PATH, navRevisionInput, type NavManifestLoaderOptions, type NavManifestState, type NavUnavailableReason } from './manifest';

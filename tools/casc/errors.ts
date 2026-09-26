/**
 * The one error type of the CASC reader. Every failure is closed: the reader never guesses, never
 * falls back to the CDN and never returns partly decoded data without saying so.
 *
 * - `format`: bytes that do not follow the documented layout (wrong magic, version, sizes);
 * - `missing`: a file, key or index entry that is not in the local storage;
 * - `encrypted`: an encrypted (BLTE `E`) block where the caller did not allow zero-filling;
 * - `integrity`: a checksum (MD5 of a file, a BLTE chunk or an encoding page) that does not match;
 * - `pin`: the installed build is not the pinned one;
 * - `path`: a path outside `.build.info` and `Data/{config,data}` was requested;
 * - `layout`: a DB2 whose layout hash or field structure differs from the layout supplied.
 */
export type CascErrorCode = 'format' | 'missing' | 'encrypted' | 'integrity' | 'pin' | 'path' | 'layout';

export class CascError extends Error {
  override readonly name = 'CascError';
  readonly code: CascErrorCode;

  constructor(code: CascErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

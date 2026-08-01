import type { TestCase } from '../core/types.js';

/**
 * A report parser turns one test-runner output file into flakesieve's test cases.
 *
 * Adding support for a new format means adding one file that exports a Parser
 * and registering it in `src/parsers/index.ts`. Nothing else in the codebase
 * needs to know the format exists.
 */
export interface Parser {
  /** Stable identifier, e.g. `junit`. Used in config and error messages. */
  name: string;

  /** Glob patterns this parser conventionally matches, for docs and defaults. */
  defaultGlobs: string[];

  /**
   * Cheap check on file contents to decide whether this parser applies.
   * Should not throw on unrelated input — return false instead.
   */
  canParse(content: string, filename: string): boolean;

  /** Parse file contents into test cases. Throws only on genuinely malformed input. */
  parse(content: string, filename: string): TestCase[];
}

import { junitParser } from './junit.js';
import type { Parser } from './types.js';

/**
 * Registry of known report formats.
 *
 * To add a format: implement `Parser` in its own file and add it here. Order
 * matters only in that the first parser whose `canParse` returns true wins.
 */
export const parsers: Parser[] = [junitParser];

export function parserFor(content: string, filename: string): Parser | undefined {
  return parsers.find((p) => p.canParse(content, filename));
}

export type { Parser } from './types.js';
export { junitParser } from './junit.js';

import * as fs from 'fs';
import * as path from 'path';

type TsEstreeModule = typeof import('@typescript-eslint/typescript-estree');

export interface TestInfo {
  name: string;
  file: string;
  line: number;
  endLine: number;
  signature: string;
  body: string;
  rawBody: string;
}

export interface MatchingBlock {
  lines1: { start: number; end: number };
  lines2: { start: number; end: number };
  content: string;
}

export interface DuplicatePair {
  test1: TestInfo;
  test2: TestInfo;
  similarity: number;
  matchingBlocks: MatchingBlock[];
}

/**
 * Suppress the noisy warning from @typescript-eslint/typescript-estree
 * about "unsupported" TypeScript versions while still allowing other
 * warnings through.
 */
function withTsVersionWarningSuppressed<T>(fn: () => T): T {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (
      typeof first === 'string' &&
      first.includes(
        'You are currently running a version of TypeScript which is not officially supported by @typescript-eslint/typescript-estree',
      )
    ) {
      // Ignore just this specific warning
      return;
    }
    // Forward all other warnings
    // eslint-disable-next-line no-console
    originalWarn(...(args as []));
  };

  try {
    return fn();
  } finally {
    console.warn = originalWarn;
  }
}

let tsParser: TsEstreeModule | null = null;

function getTsParser(): TsEstreeModule {
  if (!tsParser) {
    withTsVersionWarningSuppressed(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      tsParser = require('@typescript-eslint/typescript-estree') as TsEstreeModule;
    });
  }
  return tsParser!;
}

function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 100;
  if (str1.length === 0 || str2.length === 0) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLen = Math.max(str1.length, str2.length);
  return Math.round((1 - distance / maxLen) * 100);
}

function normalizeCode(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/['"`].*?['"`]/g, 'STR')
    .replace(/\d+/g, 'NUM')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSignature(body: string): string {
  const methodCalls = body.match(/\.(click|fill|type|goto|navigate|expect|locator|getBy\w+)\s*\(/g) || [];
  return methodCalls.join(' -> ');
}

function findMatchingBlocks(
  body1: string,
  body2: string,
  startLine1: number,
  startLine2: number,
): MatchingBlock[] {
  const lines1 = body1
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const lines2 = body2
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: MatchingBlock[] = [];
  const usedLines2 = new Set<number>();

  let i = 0;
  while (i < lines1.length) {
    let bestMatchStart = -1;
    let bestMatchLength = 0;

    for (let j = 0; j < lines2.length; j++) {
      if (usedLines2.has(j)) continue;

      if (normalizeCode(lines1[i]) === normalizeCode(lines2[j])) {
        let matchLength = 1;
        while (
          i + matchLength < lines1.length &&
          j + matchLength < lines2.length &&
          !usedLines2.has(j + matchLength) &&
          normalizeCode(lines1[i + matchLength]) === normalizeCode(lines2[j + matchLength])
        ) {
          matchLength++;
        }

        if (matchLength > bestMatchLength) {
          bestMatchStart = j;
          bestMatchLength = matchLength;
        }
      }
    }

    if (bestMatchLength >= 2) {
      const matchContent = lines1.slice(i, i + bestMatchLength).join('\n');
      blocks.push({
        lines1: { start: startLine1 + i, end: startLine1 + i + bestMatchLength - 1 },
        lines2: { start: startLine2 + bestMatchStart, end: startLine2 + bestMatchStart + bestMatchLength - 1 },
        content: matchContent,
      });

      for (let k = 0; k < bestMatchLength; k++) {
        usedLines2.add(bestMatchStart + k);
      }

      i += bestMatchLength;
    } else {
      i++;
    }
  }

  return blocks;
}

export function parseTestFile(filePath: string): TestInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const tests: TestInfo[] = [];

  try {
    const { parse } = getTsParser();
    const ast = withTsVersionWarningSuppressed(() =>
      parse(content, {
        loc: true,
        range: true,
        jsx: true,
      }),
    );

    function walk(node: any) {
      if (!node || typeof node !== 'object') return;

      if (
        node.type === 'CallExpression' &&
        ((node.callee?.name === 'test' || node.callee?.name === 'it') ||
          (node.callee?.object?.name === 'test' && node.callee?.property?.name !== 'describe'))
      ) {
        const args = node.arguments || [];
        const nameArg = args[0];
        const fnArg = args.find(
          (a: any) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
        );

        if (nameArg && fnArg) {
          const testName = nameArg.value || nameArg.raw || 'unnamed';
          const bodyStart = fnArg.body?.range?.[0] || 0;
          const bodyEnd = fnArg.body?.range?.[1] || content.length;
          const rawBody = content.slice(bodyStart, bodyEnd);
          const normalizedBody = normalizeCode(rawBody);

          tests.push({
            name: testName,
            file: filePath,
            line: node.loc?.start?.line || 0,
            endLine: node.loc?.end?.line || 0,
            signature: extractSignature(rawBody),
            body: normalizedBody,
            rawBody,
          });
        }
      }

      for (const key of Object.keys(node)) {
        const child = (node as any)[key];
        if (Array.isArray(child)) {
          child.forEach(walk);
        } else if (child && typeof child === 'object') {
          walk(child);
        }
      }
    }

    walk(ast);
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, (error as Error).message);
  }

  return tests;
}

export function findTestFiles(dir: string, patterns: string[] = ['.spec.ts', '.test.ts']): string[] {
  const files: string[] = [];

  function walkDir(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const isTestFile = patterns.some((ext) => fullPath.endsWith(ext));
        if (isTestFile) {
          files.push(fullPath);
        }
      }
    }
  }

  walkDir(dir);
  return files;
}

export function findDuplicates(tests: TestInfo[], threshold: number): DuplicatePair[] {
  const duplicates: DuplicatePair[] = [];

  for (let i = 0; i < tests.length; i++) {
    for (let j = i + 1; j < tests.length; j++) {
      const test1 = tests[i];
      const test2 = tests[j];

      const bodySimilarity = calculateSimilarity(test1.body, test2.body);
      const sigSimilarity = calculateSimilarity(test1.signature, test2.signature);
      const similarity = Math.round(bodySimilarity * 0.7 + sigSimilarity * 0.3);

      if (similarity >= threshold) {
        const matchingBlocks = findMatchingBlocks(test1.rawBody, test2.rawBody, test1.line, test2.line);
        duplicates.push({ test1, test2, similarity, matchingBlocks });
      }
    }
  }

  return duplicates.sort((a, b) => b.similarity - a.similarity);
}

export function analyzeDuplicates(directory: string, threshold: number): { tests: TestInfo[]; duplicates: DuplicatePair[] } {
  const files = findTestFiles(directory);
  const allTests: TestInfo[] = [];

  for (const file of files) {
    const tests = parseTestFile(file);
    allTests.push(...tests);
  }

  const duplicates = findDuplicates(allTests, threshold);
  return { tests: allTests, duplicates };
}


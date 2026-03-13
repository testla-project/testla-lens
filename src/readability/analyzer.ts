import * as fs from 'fs';
import * as path from 'path';

type TsEstreeModule = typeof import('@typescript-eslint/typescript-estree');

export interface TestMetrics {
  name: string;
  line: number;
  nameScore: number;
  assertionScore: number;
  nestingScore: number;
  lengthScore: number;
  screenplayScore: number;
  overallScore: number;
  suggestions: string[];
}

export interface FileMetrics {
  file: string;
  tests: TestMetrics[];
  fileScore: number;
  lineCount: number;
  testCount: number;
  suggestions: string[];
}

export interface AnalysisResult {
  files: FileMetrics[];
  overallScore: number;
  totalTests: number;
  totalFiles: number;
}

/**
 * Suppress the specific "@typescript-eslint/typescript-estree" warning
 * about unsupported TypeScript versions, while allowing all other
 * warnings to pass through unchanged.
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
      return;
    }
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

function scoreTestName(name: string): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];
  let score = 100;

  if (name.length < 10) {
    score -= 25;
    suggestions.push('Test name is too short – describe the Screenplay behaviour (Actor, goal, context).');
  } else if (name.length > 100) {
    score -= 15;
    suggestions.push('Test name is very long – focus on the core behaviour under test.');
  }

  const actionVerbs = [
    'should',
    'displays',
    'shows',
    'renders',
    'returns',
    'throws',
    'handles',
    'validates',
    'creates',
    'updates',
    'deletes',
    'navigates',
    'clicks',
    'submits',
  ];
  const hasActionVerb = actionVerbs.some((verb) => name.toLowerCase().includes(verb));
  if (!hasActionVerb) {
    suggestions.push('Consider using action verbs (should, displays, handles, etc.).');
    score -= 20;
  }

  const vagueTerms = ['test1', 'test2', 'works', 'basic', 'simple', 'misc'];
  const hasVagueTerm = vagueTerms.some((term) => name.toLowerCase().includes(term));
  if (hasVagueTerm) {
    suggestions.push('Avoid vague names – describe the specific Screenplay scenario and outcome.');
    score -= 30;
  }

  return { score: Math.max(0, score), suggestions };
}

function scoreAssertions(body: string): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];

  const assertionPatterns = [/expect\s*\(/g, /\.toBe/g, /\.toEqual/g, /\.toHave/g, /\.toContain/g, /\.toMatch/g];
  let assertionCount = 0;
  for (const pattern of assertionPatterns) {
    const matches = body.match(pattern);
    if (matches) assertionCount += matches.length;
  }

  let score = 100;

  if (assertionCount === 0) {
    score = 30;
    suggestions.push('No assertions found – Screenplay tests should verify observable outcomes.');
  } else if (assertionCount > 10) {
    score = 60;
    suggestions.push('Too many assertions – split into smaller, focused Screenplay scenarios.');
  } else if (assertionCount > 5) {
    score = 80;
    suggestions.push('Many assertions – verify the test still focuses on a single behaviour.');
  }

  return { score, suggestions };
}

function scoreNesting(body: string): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];

  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of body) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth--;
    }
  }

  let score = 100;

  if (maxDepth > 6) {
    score = 40;
    suggestions.push('Very deep nesting – Screenplay Tasks should encapsulate complexity instead.');
  } else if (maxDepth > 4) {
    score = 70;
    suggestions.push('Consider extracting nested logic into reusable Screenplay Tasks or Questions.');
  }

  return { score, suggestions };
}

function scoreLength(lineCount: number): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];
  let score = 100;

  if (lineCount > 50) {
    score = 50;
    suggestions.push('Test is very long (>50 lines) – break into multiple Screenplay scenarios.');
  } else if (lineCount > 30) {
    score = 70;
    suggestions.push('Test is getting long – consider moving detail into Screenplay Tasks.');
  } else if (lineCount < 3) {
    score = 80;
    suggestions.push('Very short test – ensure it documents a meaningful business behaviour.');
  }

  return { score, suggestions };
}

/**
 * Screenplay-specific heuristics based on Testla best practices.
 * We reward:
 *  - use of Actor/Tasks/Questions (test reads like a screenplay)
 *  - tests that avoid low-level page.* calls in favour of Screenplay abstractions
 */
function scoreScreenplayUsage(body: string): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];
  const lower = body.toLowerCase();

  const usesActorApi =
    /Actor\./.test(body) ||
    /actor\./.test(body) ||
    /\.attemptsTo\(/.test(body) ||
    /\.asks\(/.test(body) ||
    /\.should\(/.test(body) ||
    /@testla\/screenplay-playwright/.test(body);

  const pageUsageMatches = body.match(/page\./g);
  const pageUsageCount = pageUsageMatches ? pageUsageMatches.length : 0;

  let score = 100;

  if (!usesActorApi && pageUsageCount > 0) {
    score = 60;
    suggestions.push(
      'Tests use raw Playwright calls – prefer Screenplay elements (Actor, Tasks, Questions) as in the Testla docs.',
    );
  }

  if (!usesActorApi && pageUsageCount === 0) {
    score = 80;
    suggestions.push(
      'Consider structuring the test with explicit Screenplay roles (Actor, Tasks, Questions) to document behaviour.',
    );
  }

  if (usesActorApi && pageUsageCount > 10) {
    score = 80;
    suggestions.push(
      'Screenplay is used, but there is still a lot of direct page.* interaction – move details into Tasks.',
    );
  }

  if (usesActorApi && pageUsageCount === 0) {
    score = 100;
  }

  if (lower.includes('page object')) {
    score -= 20;
    suggestions.push(
      'Avoid mixing Page Object Model terminology – Screenplay focuses on behaviours and domain language.',
    );
  }

  return { score: Math.max(0, score), suggestions };
}

export function analyzeFile(filePath: string): FileMetrics {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const tests: TestMetrics[] = [];
  const fileSuggestions: string[] = [];

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
          const startLine = fnArg.loc?.start?.line || 0;
          const endLine = fnArg.loc?.end?.line || 0;
          const testLineCount = endLine - startLine + 1;

          const bodyStart = fnArg.body?.range?.[0] || 0;
          const bodyEnd = fnArg.body?.range?.[1] || content.length;
          const body = content.slice(bodyStart, bodyEnd);

          const nameResult = scoreTestName(testName);
          const assertionResult = scoreAssertions(body);
          const nestingResult = scoreNesting(body);
          const lengthResult = scoreLength(testLineCount);
          const screenplayResult = scoreScreenplayUsage(body);

          const overallScore = Math.round(
            nameResult.score * 0.22 +
              assertionResult.score * 0.25 +
              nestingResult.score * 0.18 +
              lengthResult.score * 0.20 +
              screenplayResult.score * 0.15,
          );

          const suggestions = [
            ...nameResult.suggestions,
            ...assertionResult.suggestions,
            ...nestingResult.suggestions,
            ...lengthResult.suggestions,
            ...screenplayResult.suggestions,
          ];

          tests.push({
            name: testName,
            line: node.loc?.start?.line || 0,
            nameScore: nameResult.score,
            assertionScore: assertionResult.score,
            nestingScore: nestingResult.score,
            lengthScore: lengthResult.score,
            screenplayScore: screenplayResult.score,
            overallScore,
            suggestions,
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
    fileSuggestions.push(`Parse error: ${(error as Error).message}`);
  }

  if (lines.length > 500) {
    fileSuggestions.push('File is very long – split into multiple Screenplay feature files.');
  }

  if (tests.length > 20) {
    fileSuggestions.push(
      'Many tests in one file – group Screenplay scenarios by feature or domain concept.',
    );
  }

  const fileScore =
    tests.length > 0
      ? Math.round(tests.reduce((sum, t) => sum + t.overallScore, 0) / tests.length)
      : 0;

  return {
    file: filePath,
    tests,
    fileScore,
    lineCount: lines.length,
    testCount: tests.length,
    suggestions: fileSuggestions,
  };
}

export function findTestFiles(dir: string): string[] {
  const files: string[] = [];

  function walkDir(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walkDir(fullPath);
      } else if (
        entry.isFile() &&
        (fullPath.endsWith('.spec.ts') || fullPath.endsWith('.test.ts'))
      ) {
        files.push(fullPath);
      }
    }
  }

  walkDir(dir);
  return files;
}

export function analyzeReadability(directory: string): AnalysisResult {
  const files = findTestFiles(directory);
  const fileMetrics: FileMetrics[] = [];

  for (const file of files) {
    fileMetrics.push(analyzeFile(file));
  }

  const totalTests = fileMetrics.reduce((sum, f) => sum + f.testCount, 0);
  const overallScore =
    fileMetrics.length > 0
      ? Math.round(fileMetrics.reduce((sum, f) => sum + f.fileScore, 0) / fileMetrics.length)
      : 0;

  return {
    files: fileMetrics,
    overallScore,
    totalTests,
    totalFiles: fileMetrics.length,
  };
}


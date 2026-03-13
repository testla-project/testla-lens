import * as path from 'path';
import { TestInfo, DuplicatePair, MatchingBlock } from './analyzer';

export interface DuplicateReportOptions {
  format: 'text' | 'json';
  verbose: boolean;
  baseDir: string;
  threshold?: number;
}

function relativePath(filePath: string, baseDir: string): string {
  return path.relative(baseDir, filePath);
}

function generateTextReport(
  tests: TestInfo[],
  duplicates: DuplicatePair[],
  options: DuplicateReportOptions,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(' DUPLICATE TEST DETECTOR (testla-lens) ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  lines.push('📊 Summary');
  lines.push(` Tests analyzed: ${tests.length}`);
  lines.push(` Potential duplicates: ${duplicates.length}`);
  lines.push('');

  if (duplicates.length === 0) {
    lines.push('✅ No duplicate tests found above threshold!');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('🔍 Potential Duplicates:');
  lines.push('');

  duplicates.forEach((dup, index) => {
    const file1 = relativePath(dup.test1.file, options.baseDir);
    const file2 = relativePath(dup.test2.file, options.baseDir);

    lines.push(`┌─ Pair ${index + 1} ─────────────────────────────────────────────`);
    lines.push('│');
    lines.push(`│ Similarity: ${dup.similarity}%`);
    lines.push('│');
    lines.push(`│ Test 1: "${dup.test1.name}"`);
    lines.push(`│ ${file1}:${dup.test1.line}`);
    lines.push('│');
    lines.push(`│ Test 2: "${dup.test2.name}"`);
    lines.push(`│ ${file2}:${dup.test2.line}`);

    if (options.verbose && dup.test1.signature) {
      lines.push('│');
      lines.push(
        `│ Signature 1: ${dup.test1.signature || '(no method calls detected)'}`,
      );
      lines.push(
        `│ Signature 2: ${dup.test2.signature || '(no method calls detected)'}`,
      );
    }

    lines.push('│');
    lines.push('└─────────────────────────────────────────────────────────────');
    lines.push('');
  });

  lines.push('💡 Recommendations:');
  lines.push('');
  lines.push(' For each duplicate pair, consider:');
  lines.push(' 1. Merge tests if they cover the same Screenplay scenario');
  lines.push(' 2. Parameterize via Screenplay Tasks if they differ only in data');
  lines.push(' 3. Delete one if truly redundant');
  lines.push(' 4. Clarify domain intent in test names');
  lines.push('');

  return lines.join('\n');
}

function generateJsonReport(
  tests: TestInfo[],
  duplicates: DuplicatePair[],
  options: DuplicateReportOptions,
): string {
  const report = {
    summary: {
      testsAnalyzed: tests.length,
      duplicatesFound: duplicates.length,
      threshold: options.threshold,
      analyzedAt: new Date().toISOString(),
    },
    duplicates: duplicates.map((dup) => ({
      similarity: dup.similarity,
      matchingLinesCount: dup.matchingBlocks.reduce(
        (sum: number, b: MatchingBlock) => sum + (b.lines1.end - b.lines1.start + 1),
        0,
      ),
      test1: {
        name: dup.test1.name,
        file: relativePath(dup.test1.file, options.baseDir),
        line: dup.test1.line,
        endLine: dup.test1.endLine,
        signature: dup.test1.signature,
      },
      test2: {
        name: dup.test2.name,
        file: relativePath(dup.test2.file, options.baseDir),
        line: dup.test2.line,
        endLine: dup.test2.endLine,
        signature: dup.test2.signature,
      },
      matchingBlocks: dup.matchingBlocks.map((block) => ({
        lines1: block.lines1,
        lines2: block.lines2,
        content: block.content,
      })),
    })),
  };

  return JSON.stringify(report, null, 2);
}

export function generateDuplicateReport(
  tests: TestInfo[],
  duplicates: DuplicatePair[],
  options: DuplicateReportOptions,
): string {
  if (options.format === 'json') {
    return generateJsonReport(tests, duplicates, options);
  }
  return generateTextReport(tests, duplicates, options);
}

